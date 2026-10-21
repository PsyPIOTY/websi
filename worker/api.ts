import type { AgentContext } from "../core/agent/adapter";
import {
	type AgentEnv,
	adapterById,
	listAdapters,
	resolveAdapter,
} from "../core/agent/registry";
import {
	addEvent,
	createRequest,
	RequestError,
	validateNewRequest,
	withStatus,
} from "../core/requests";
import {
	type ChangeRequest,
	type DirectoryStatus,
	type SiteProfile,
	type VisibilityReport,
	WHOLE_PAGE,
} from "../core/types";
import type { Store } from "./storage";

export interface ApiDeps {
	store: Store;
	sites: SiteProfile[];
	env: AgentEnv;
	now?: () => Date;
	uuid?: () => string;
	scan: (site: SiteProfile) => Promise<VisibilityReport>;
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

	async function send(r: ChangeRequest) {
		const adapter = adapterFor(r);
		try {
			const result = await adapter.dispatch(r, context(r));
			const next = withStatus(r, "in_arbeit", now(), {
				kind: "gesendet",
				text:
					adapter.id === "testmodus"
						? "An den Testmodus gegeben"
						: `An ${adapter.label} gegeben`,
				by: adapter.id,
				url: result.url || undefined,
			});
			next.external = { adapter: adapter.id, id: result.id, url: result.url };
			return next;
		} catch (e) {
			return addEvent(r, now(), {
				kind: "fehler",
				text: (e as Error).message,
				by: "websi",
			});
		}
	}

	async function sync(r: ChangeRequest) {
		if (
			!r.external ||
			r.status === "veroeffentlicht" ||
			r.status === "verworfen"
		)
			return r;
		const update = await adapterFor(r).sync(r, context(r));
		let next = r;
		const known = new Set(r.events.map((e) => e.url ?? `${e.at}|${e.text}`));
		for (const m of update.messages) {
			if (known.has(m.url ?? `${m.at}|${m.text}`)) continue;
			next = addEvent(next, now(), {
				kind: "antwort",
				text: m.text,
				by: r.external.adapter,
				url: m.url,
			});
		}
		if (update.status === "vorschlag" && next.status === "in_arbeit") {
			next = withStatus(next, "vorschlag", now(), {
				kind: "vorschlag",
				text: "Vorschlag liegt bereit",
				by: r.external.adapter,
				url: update.proposalUrl,
			});
		}
		if (update.proposalUrl || update.branch) {
			next = {
				...next,
				external: {
					...r.external,
					proposalUrl: update.proposalUrl,
					branch: update.branch,
				},
			};
		}
		return next;
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
					if (raw.send !== false) r = await send(r);
					await deps.store.putRequest(r);
					return json(r, 201);
				}
			}

			if (parts[0] === "requests" && parts.length === 3 && method === "POST") {
				const r = await deps.store.getRequest(parts[1]);
				if (!r) return fail("Auftrag unbekannt", 404);
				const action = parts[2];
				let next: ChangeRequest;
				if (action === "send") {
					if (r.status !== "offen")
						return fail("Auftrag ist schon unterwegs", 409);
					next = await send(r);
				} else if (action === "sync") {
					next = await sync(r);
				} else if (action === "followup") {
					const text = String((await body()).text ?? "").trim();
					if (!text) return fail("Nachricht fehlt");
					if (!r.external)
						return fail("Auftrag wurde noch nicht gesendet", 409);
					await adapterFor(r).followUp(r, context(r), text);
					next = withStatus(r, "in_arbeit", now(), {
						kind: "nachbessern",
						text,
						by: "peter",
					});
				} else if (action === "publish") {
					if (r.status !== "vorschlag")
						return fail("Es liegt noch kein Vorschlag vor", 409);
					const result = await adapterFor(r).publish(r, context(r));
					next = withStatus(r, "veroeffentlicht", now(), {
						kind: "status",
						text: "Von Peter veröffentlicht",
						by: "peter",
						url: result.url,
					});
				} else if (action === "discard") {
					await adapterFor(r).discard(r, context(r));
					next = withStatus(r, "verworfen", now(), {
						kind: "status",
						text: "Verworfen",
						by: "peter",
					});
				} else if (action === "reopen") {
					next = withStatus(r, "offen", now(), {
						kind: "status",
						text: "Wieder geöffnet",
						by: "peter",
					});
					next.external = undefined;
				} else {
					return fail("Unbekannte Aktion", 404);
				}
				await deps.store.putRequest(next);
				return json(next);
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
