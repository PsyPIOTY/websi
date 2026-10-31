import type { AgentContext, AgentUpdate, Job } from "../core/agent/adapter";
import {
	type AgentEnv,
	adapterById,
	listAdapters,
	resolveAdapter,
} from "../core/agent/registry";
import { normalizeDrafts } from "../core/drafts";
import {
	DEFAULT_ENGINE,
	ENGINES,
	type EngineId,
	isEngine,
} from "../core/engines";
import {
	addEvent,
	createRequest,
	RequestError,
	validateNewRequest,
	withStatus,
} from "../core/requests";
import {
	ALL_SITES,
	type ChangeRequest,
	type DirectoryStatus,
	type SiteProfile,
	type StyleRule,
	type VisibilityReport,
	WHOLE_PAGE,
} from "../core/types";
import { DEFAULT_LIMITS, type Limits, summarizeUsage } from "../core/usage";
import { monitorState, openNotices } from "./monitor";
import type { Store } from "./storage";

export interface ApiDeps {
	store: Store;
	sites: SiteProfile[];
	env: AgentEnv;
	now?: () => Date;
	uuid?: () => string;
	scan: (site: SiteProfile) => Promise<VisibilityReport>;
	/** Stil-Regeln für alle Websites, die WEBSI beim ersten Start einmal anlegt. */
	startStyle?: string[];
	/** Monatsprüfung sofort ausführen (sonst täglich per Cron). */
	runMonitor?: () => Promise<unknown>;
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		},
	});

const fail = (message: string, status = 400) =>
	json({ error: message }, status);

export function createApi(deps: ApiDeps) {
	const now = () => (deps.now ? deps.now() : new Date()).toISOString();
	const uuid = deps.uuid ?? (() => crypto.randomUUID());
	const site = (id: string) => deps.sites.find((s) => s.id === id);

	function context(r: ChangeRequest): AgentContext {
		const s = site(r.siteId);
		if (!s) throw new RequestError("Website unbekannt");
		const section = s.sections.find((x) => x.id === r.sectionId) ?? WHOLE_PAGE;
		return {
			site: s,
			section,
			pageUrl: new URL(r.pagePath || s.editorPath, s.url).toString(),
		};
	}

	const adapterFor = (r: ChangeRequest) =>
		r.external
			? adapterById(r.external.adapter, deps.env)
			: resolveAdapter(site(r.siteId)?.agent.adapter ?? "", deps.env);

	const engineOf = (r: ChangeRequest): EngineId =>
		r.engine ?? site(r.siteId)?.agent.engine ?? DEFAULT_ENGINE;

	/** Legt die Start-Regeln einmal an. Was Peter löscht, bleibt gelöscht. */
	async function seedStyle() {
		if (!deps.startStyle?.length) return;
		if (await deps.store.getSetting("stil-start")) return;
		for (const text of deps.startStyle)
			await remember(ALL_SITES, text, "peter");
		await deps.store.putSetting("stil-start", now());
	}

	async function styleFor(siteId: string) {
		await seedStyle();
		return (await deps.store.listStyle(siteId))
			.filter((x) => x.active)
			.map((x) => x.text);
	}

	/** Alle Wünsche desselben Sammelauftrags (inklusive r). */
	async function group(r: ChangeRequest) {
		if (!r.batchId) return [r];
		const all = await deps.store.listRequests(r.siteId);
		const rest = all.filter((x) => x.batchId === r.batchId && x.id !== r.id);
		return [r, ...rest];
	}

	/** Schickt einen oder mehrere Wünsche als einen Auftrag los. */
	async function send(
		requests: ChangeRequest[],
		engine?: EngineId,
		drafts: string[] = [],
	) {
		const first = requests[0];
		const s = site(first.siteId);
		if (!s) throw new RequestError("Website unbekannt");
		const chosen = engine ?? engineOf(first);
		const items = requests.map((r) => {
			const ctx = context(r);
			return { request: r, section: ctx.section, pageUrl: ctx.pageUrl };
		});
		const job: Job = {
			site: s,
			items,
			engine: chosen,
			style: await styleFor(s.id),
			...(drafts.length ? { drafts } : {}),
		};
		const adapter = adapterFor(first);
		const batch = requests.length > 1;
		try {
			const result = await adapter.dispatch(job);
			const batchId = batch ? `${adapter.id}-${result.id}` : undefined;
			return requests.map((r) => {
				const next = withStatus({ ...r, engine: chosen }, "in_arbeit", now(), {
					kind: "gesendet",
					text:
						(adapter.id === "testmodus"
							? "An den Testmodus gegeben"
							: `An ${adapter.label} gegeben`) +
						` · ${ENGINES.find((e) => e.id === chosen)?.label}` +
						(batch ? ` · Sammelauftrag mit ${requests.length} Wünschen` : "") +
						(drafts.length ? ` · ${drafts.length} Entwürfe` : ""),
					by: adapter.id,
					url: result.url || undefined,
				});
				next.external = { adapter: adapter.id, id: result.id, url: result.url };
				next.batchId = batchId;
				next.drafts = drafts.length ? drafts : undefined;
				return next;
			});
		} catch (e) {
			return requests.map((r) =>
				addEvent(r, now(), {
					kind: "fehler",
					text: (e as Error).message,
					by: "websi",
				}),
			);
		}
	}

	function applyUpdate(r: ChangeRequest, update: AgentUpdate) {
		if (
			!r.external ||
			r.status === "veroeffentlicht" ||
			r.status === "verworfen"
		)
			return r;
		let next = r;
		const known = new Set(r.events.map((e) => e.url ?? `${e.at}|${e.text}`));
		for (const m of update.messages) {
			if (known.has(m.url ?? `${m.at}|${m.text}`)) continue;
			next = addEvent(next, now(), {
				kind: "antwort",
				text: m.text,
				by: r.external.adapter,
				url: m.url,
				usage: m.usage,
			});
		}
		if (update.status === "vorschlag" && next.status === "in_arbeit") {
			next = withStatus(next, "vorschlag", now(), {
				kind: "vorschlag",
				text: update.drafts?.length
					? `${update.drafts.length} Entwürfe liegen bereit`
					: "Vorschlag liegt bereit",
				by: r.external.adapter,
				url: update.proposalUrl,
			});
		}
		if (
			update.proposalUrl ||
			update.branch ||
			update.previewUrl ||
			update.drafts
		) {
			next = {
				...next,
				external: {
					...r.external,
					proposalUrl: update.proposalUrl ?? r.external.proposalUrl,
					previewUrl: update.previewUrl ?? r.external.previewUrl,
					branch: update.branch ?? r.external.branch,
					drafts: update.drafts ?? r.external.drafts,
				},
			};
		}
		return next;
	}

	async function sync(r: ChangeRequest) {
		if (
			!r.external ||
			r.status === "veroeffentlicht" ||
			r.status === "verworfen"
		)
			return [r];
		const update = await adapterFor(r).sync(r, context(r));
		return (await group(r)).map((x) => applyUpdate(x, update));
	}

	async function saveAll(list: ChangeRequest[]) {
		for (const r of list) await deps.store.putRequest(r);
	}

	/** Antwort einer Aktion: der Auftrag selbst plus alle mitgeänderten. */
	/** Mehrere Entwürfe liegen bereit, Peter hat noch keinen gewählt. */
	const pickPending = (r: ChangeRequest) =>
		Boolean(r.external?.drafts?.length && !r.external.chosen);

	const withRelated = (list: ChangeRequest[], status = 200) =>
		json({ ...list[0], related: list.slice(1) }, status);

	async function remember(
		siteId: string,
		text: string,
		source: StyleRule["source"],
	) {
		const existing = (await deps.store.listStyle(siteId)).find(
			(x) => x.text === text,
		);
		if (existing) return existing;
		const rule: StyleRule = {
			id: uuid(),
			siteId,
			text,
			source,
			active: true,
			createdAt: now(),
		};
		await deps.store.putStyle(rule);
		return rule;
	}

	async function handle(request: Request): Promise<Response | null> {
		const url = new URL(request.url);
		if (!url.pathname.startsWith("/api/websi/")) return null;
		const parts = url.pathname
			.slice("/api/websi/".length)
			.split("/")
			.filter(Boolean);
		const method = request.method;
		const body = async () => {
			try {
				return (await request.json()) as Record<string, unknown>;
			} catch {
				return {};
			}
		};

		try {
			if (parts[0] === "status" && method === "GET") {
				return json({
					adapters: listAdapters(deps.env),
					engines: ENGINES,
					mode: deps.env.AGENT_MODE ?? "auto",
				});
			}

			if (parts[0] === "sites" && parts.length === 1 && method === "GET") {
				return json(
					deps.sites.map((s) => ({
						id: s.id,
						name: s.name,
						url: s.url,
						sections: s.sections.length,
					})),
				);
			}

			if (parts[0] === "sites" && parts.length === 2 && method === "GET") {
				const s = site(parts[1]);
				if (!s) return fail("Website unbekannt", 404);
				const [requests, report, history, dirs] = await Promise.all([
					deps.store.listRequests(s.id),
					deps.store.latestReport(s.id),
					deps.store.reportHistory(s.id, 20),
					deps.store.listDirectories(s.id),
				]);
				const adapter = resolveAdapter(s.agent.adapter, deps.env);
				return json({
					profile: s,
					requests,
					report,
					history,
					directories: s.directories.map((d) => ({
						...d,
						status: dirs.find((x) => x.directoryId === d.id)?.status ?? "offen",
						note: dirs.find((x) => x.directoryId === d.id)?.note ?? "",
					})),
					adapter: { id: adapter.id, label: adapter.label },
				});
			}

			if (parts[0] === "requests" && parts.length === 1) {
				if (method === "GET")
					return json(
						await deps.store.listRequests(
							url.searchParams.get("site") ?? undefined,
						),
					);
				if (method === "POST") {
					const raw = await body();
					const input = validateNewRequest(raw);
					const s = site(input.siteId);
					if (!s) return fail("Website unbekannt", 404);
					if (
						input.sectionId !== WHOLE_PAGE.id &&
						!s.sections.some((x) => x.id === input.sectionId)
					) {
						return fail("Abschnitt unbekannt", 404);
					}
					let r = createRequest(input, uuid(), now());
					if (raw.send !== false)
						[r] = await send([r], undefined, normalizeDrafts(raw.drafts));
					await deps.store.putRequest(r);
					return json(r, 201);
				}
			}

			if (parts[0] === "requests" && parts.length === 3 && method === "POST") {
				const r = await deps.store.getRequest(parts[1]);
				if (!r) return fail("Auftrag unbekannt", 404);
				const action = parts[2];
				let list: ChangeRequest[];
				if (action === "send") {
					if (r.status !== "offen")
						return fail("Auftrag ist schon unterwegs", 409);
					const raw = await body();
					list = await send(
						[r],
						isEngine(raw.engine) ? raw.engine : undefined,
						normalizeDrafts(raw.drafts),
					);
				} else if (action === "choose") {
					const raw = await body();
					const draft = r.external?.drafts?.find(
						(d) => d.branch === raw.branch,
					);
					if (!r.external || r.external.chosen || !draft)
						return fail("Entwurf unbekannt", 409);
					const ext = r.external;
					await adapterFor(r).choose(r, context(r), draft);
					list = (await group(r)).map((x) => {
						const next = addEvent(x, now(), {
							kind: "status",
							text: `Entwurf „${draft.name}“ gewählt`,
							by: "peter",
							url: draft.proposalUrl,
						});
						next.external = {
							...(x.external ?? ext),
							chosen: draft.branch,
							branch: draft.branch,
							proposalUrl: draft.proposalUrl,
							previewUrl: draft.previewUrl,
							drafts: undefined,
						};
						return next;
					});
				} else if (action === "sync") {
					list = await sync(r);
				} else if (
					pickPending(r) &&
					(action === "followup" || action === "publish")
				) {
					return fail("Erst einen Entwurf wählen", 409);
				} else if (action === "followup") {
					const raw = await body();
					const text = String(raw.text ?? "").trim();
					if (!text) return fail("Nachricht fehlt");
					if (!r.external)
						return fail("Auftrag wurde noch nicht gesendet", 409);
					await adapterFor(r).followUp(r, context(r), text);
					if (raw.remember === true)
						await remember(r.siteId, text, "nachbessern");
					list = (await group(r)).map((x) =>
						withStatus(x, "in_arbeit", now(), {
							kind: "nachbessern",
							text,
							by: "peter",
						}),
					);
				} else if (action === "publish") {
					if (r.status !== "vorschlag")
						return fail("Es liegt noch kein Vorschlag vor", 409);
					const result = await adapterFor(r).publish(r, context(r));
					list = (await group(r)).map((x) =>
						withStatus(x, "veroeffentlicht", now(), {
							kind: "status",
							text: x.batchId
								? "Mit dem Sammelauftrag veröffentlicht"
								: "Von Peter veröffentlicht",
							by: "peter",
							url: result.url,
						}),
					);
				} else if (action === "discard") {
					const raw = await body();
					const reason = String(raw.reason ?? "").trim();
					if (r.external) await adapterFor(r).discard(r, context(r));
					if (reason && raw.remember === true)
						await remember(r.siteId, reason, "verworfen");
					list = (r.external ? await group(r) : [r]).map((x) =>
						withStatus(x, "verworfen", now(), {
							kind: "status",
							text: reason ? `Verworfen: ${reason}` : "Verworfen",
							by: "peter",
						}),
					);
				} else if (action === "reopen") {
					const next = withStatus(r, "offen", now(), {
						kind: "status",
						text: "Wieder geöffnet",
						by: "peter",
					});
					next.external = undefined;
					next.batchId = undefined;
					list = [next];
				} else {
					return fail("Unbekannte Aktion", 404);
				}
				await saveAll(list);
				return withRelated(list);
			}

			// Sammelauftrag: alle gesammelten (oder die genannten) Wünsche einer Website in einem Durchgang.
			if (parts[0] === "batches" && parts.length === 1 && method === "POST") {
				const raw = await body();
				const s = site(String(raw.siteId ?? ""));
				if (!s) return fail("Website unbekannt", 404);
				const ids = Array.isArray(raw.requestIds)
					? raw.requestIds.map(String)
					: null;
				const pending = (await deps.store.listRequests(s.id)).filter(
					(x) =>
						x.status === "offen" &&
						!x.external &&
						(ids ? ids.includes(x.id) : true),
				);
				if (!pending.length) return fail("Nichts gesammelt", 409);
				if (raw.engine !== undefined && !isEngine(raw.engine))
					return fail("Modell unbekannt");
				const ordered = [...pending].sort((a, b) =>
					a.createdAt.localeCompare(b.createdAt),
				);
				const list = await send(
					ordered,
					isEngine(raw.engine) ? raw.engine : undefined,
					normalizeDrafts(raw.drafts),
				);
				await saveAll(list);
				return json(list, 201);
			}

			if (parts[0] === "style" && parts.length === 2) {
				const s = site(parts[1]);
				if (!s) return fail("Website unbekannt", 404);
				await seedStyle();
				if (method === "GET") {
					const rules = await deps.store.listStyle(s.id);
					// Vorschläge: Nachbesserungen und Gründe fürs Verwerfen, die noch keine Regel sind.
					const known = new Set(rules.map((x) => x.text));
					const suggestions = (await deps.store.listRequests(s.id))
						.flatMap((r) =>
							r.events
								.filter(
									(e) =>
										e.kind === "nachbessern" ||
										(e.kind === "status" && e.text.startsWith("Verworfen: ")),
								)
								.map((e) => ({
									text: e.text.replace(/^Verworfen: /, ""),
									source:
										e.kind === "nachbessern" ? "nachbessern" : "verworfen",
									at: e.at,
								})),
						)
						.filter(
							(x, i, all) =>
								!known.has(x.text) &&
								all.findIndex((y) => y.text === x.text) === i,
						)
						.slice(0, 12);
					return json({ rules, suggestions });
				}
				if (method === "POST") {
					const raw = await body();
					const text = String(raw.text ?? "")
						.trim()
						.slice(0, 300);
					if (!text) return fail("Regel fehlt");
					const scope = raw.scope === ALL_SITES ? ALL_SITES : s.id;
					const source =
						raw.source === "nachbessern" || raw.source === "verworfen"
							? raw.source
							: "peter";
					return json(await remember(scope, text, source), 201);
				}
			}

			if (parts[0] === "style" && parts.length === 3) {
				const rule = await deps.store.getStyle(parts[2]);
				if (!rule) return fail("Regel unbekannt", 404);
				if (method === "DELETE") {
					await deps.store.deleteStyle(rule.id);
					return json({ ok: true });
				}
				if (method === "PATCH") {
					const raw = await body();
					const next: StyleRule = {
						...rule,
						active: typeof raw.active === "boolean" ? raw.active : rule.active,
						text:
							typeof raw.text === "string" && raw.text.trim()
								? raw.text.trim().slice(0, 300)
								: rule.text,
						siteId:
							raw.scope === ALL_SITES
								? ALL_SITES
								: raw.scope === parts[1]
									? parts[1]
									: rule.siteId,
					};
					await deps.store.putStyle(next);
					return json(next);
				}
			}

			if (parts[0] === "usage" && method === "GET") {
				const limits =
					(await deps.store.getSetting<Limits>("limits")) ?? DEFAULT_LIMITS;
				return json(
					summarizeUsage(
						await deps.store.listRequests(),
						deps.now ? deps.now() : new Date(),
						{ ...DEFAULT_LIMITS, ...limits },
					),
				);
			}

			if (parts[0] === "usage" && parts[1] === "limits" && method === "PUT") {
				const raw = await body();
				const limits: Limits = {};
				for (const e of ENGINES) {
					const v = raw[e.id];
					limits[e.id] =
						typeof v === "number" && v > 0
							? Math.round(v)
							: v === null
								? null
								: (DEFAULT_LIMITS[e.id] ?? null);
				}
				await deps.store.putSetting("limits", limits);
				return json(limits);
			}

			if (
				parts[0] === "visibility" &&
				parts[2] === "scan" &&
				method === "POST"
			) {
				const s = site(parts[1]);
				if (!s) return fail("Website unbekannt", 404);
				const report = await deps.scan(s);
				await deps.store.saveReport(report);
				return json(report);
			}

			// Monatsprüfung: offene Hinweise, je mit vorbereitetem Auftrag und Link zum Öffnen.
			if (parts[0] === "hinweise" && parts.length === 1 && method === "GET") {
				const hinweise = (await openNotices(deps.store)).map((n) => ({
					...n,
					site: site(n.siteId)?.name ?? n.siteId,
					link: `${url.origin}/#site=${n.siteId}&tab=auftraege&auftrag=${n.requestId}`,
				}));
				return json({ hinweise, pruefung: await monitorState(deps.store) });
			}

			if (
				parts[0] === "hinweise" &&
				parts[1] === "pruefen" &&
				method === "POST"
			) {
				if (!deps.runMonitor) return fail("Monatsprüfung fehlt", 501);
				return json(await deps.runMonitor());
			}

			if (
				parts[0] === "directories" &&
				parts.length === 3 &&
				method === "PUT"
			) {
				const s = site(parts[1]);
				const dir = s?.directories.find((d) => d.id === parts[2]);
				if (!s || !dir) return fail("Verzeichnis unbekannt", 404);
				const raw = await body();
				const status = raw.status as DirectoryStatus;
				if (!["offen", "beantragt", "aktiv"].includes(status))
					return fail("Status ungültig");
				const entry = {
					siteId: s.id,
					directoryId: dir.id,
					status,
					note: String(raw.note ?? "").slice(0, 500),
					updatedAt: now(),
				};
				await deps.store.putDirectory(entry);
				return json(entry);
			}

			return fail("Nicht gefunden", 404);
		} catch (e) {
			if (e instanceof RequestError) return fail(e.message, 400);
			return fail((e as Error).message || "Fehler", 502);
		}
	}

	return { handle };
}
