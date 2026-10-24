import {
	type BrokenLink,
	extractLinks,
	googleNotice,
	isBroken,
	isoDay,
	lastTwoMonths,
	linkNotice,
	type Month,
	type NoticeDraft,
	type PageLink,
	PRUEFTAG,
	type QueryRow,
	rankDrops,
	SCHWELLEN,
	visitDrop,
	visitNotice,
} from "../core/monitor";
import { createRequest, withStatus } from "../core/requests";
import {
	type ChangeRequest,
	type Notice,
	type SiteProfile,
	WHOLE_PAGE,
} from "../core/types";
import type { Store } from "./storage";

export interface MonitorEnv {
	CF_ACCOUNT_ID?: string;
	/** Cloudflare-Token nur mit „Account Analytics: Read“. */
	CF_ANALYTICS_TOKEN?: string;
	/** JSON-Schlüssel eines Google-Dienstkontos, in Search Console mit Leserecht eingetragen. */
	GSC_SERVICE_ACCOUNT?: string;
}

export interface MonitorDeps {
	store: Store;
	sites: SiteProfile[];
	env: MonitorEnv;
	now?: Date;
	fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
	uuid?: () => string;
}

/** Was die Läufe zuletzt getan haben. Fehler sind für Paco, nicht für Peter. */
export interface MonitorState {
	tag?: { at: string; fehler: string[] };
	monat?: { key: string; at: string; hinweise: number; fehler: string[] };
}

const NOTICES = "hinweise";
const STATE = "pruefung";
const countsKey = (siteId: string) => `aufrufe/${siteId}`;
const DAY = 86_400_000;
const UA = { "user-agent": "WEBSI-Linkpruefung (+Monatspruefung)" };

/** Wartet auf Peter: vorbereitet und noch nicht losgeschickt. */
const isWaiting = (r: ChangeRequest) => r.status === "offen" && !r.external;

class OutOfBudget extends Error {
	constructor() {
		super("Abruf-Grenze erreicht, der Rest folgt im nächsten Lauf");
	}
}

/**
 * Der kostenlose Cloudflare-Plan erlaubt 50 Abrufe je Lauf. Lieber weniger
 * prüfen als einen Link fälschlich als kaputt melden.
 */
function limited(fetcher: NonNullable<MonitorDeps["fetcher"]>, budget = 45) {
	return async (url: string, init?: RequestInit) => {
		if (budget <= 0) throw new OutOfBudget();
		budget--;
		return fetcher(url, init);
	};
}
type Net = ReturnType<typeof limited>;

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

/** Aufrufe je Tag aus Cloudflare Web Analytics, ein Abruf für alle Tage. */
async function dailyCounts(
	env: MonitorEnv,
	siteTag: string,
	days: string[],
	net: Net,
) {
	const variables: Record<string, string> = {
		account: env.CF_ACCOUNT_ID ?? "",
		site: siteTag,
	};
	const fields = days.map((d, i) => {
		variables[`s${i}`] = `${d}T00:00:00Z`;
		variables[`e${i}`] = `${isoDay(new Date(Date.parse(d) + DAY))}T00:00:00Z`;
		return `d${i}: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { siteTag: $site, datetime_geq: $s${i}, datetime_lt: $e${i} }) { count }`;
	});
	const params = days.map((_, i) => `, $s${i}: Time!, $e${i}: Time!`).join("");
	const query = `query ($account: String!, $site: String!${params}) { viewer { accounts(filter: { accountTag: $account }) { ${fields.join(" ")} } } }`;
	const res = await net(GRAPHQL, {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});
	const body = (await res.json().catch(() => ({}))) as {
		data?: { viewer?: { accounts?: Record<string, { count: number }[]>[] } };
		errors?: { message: string }[] | null;
	};
	const account = body.data?.viewer?.accounts?.[0];
	if (!res.ok || body.errors?.length || !account)
		throw new Error(
			`Cloudflare-Statistik: ${body.errors?.[0]?.message ?? `Antwort ${res.status}`}`,
		);
	return Object.fromEntries(
		days.map((d, i) => [d, account[`d${i}`]?.[0]?.count ?? 0]),
	);
}

/** Zählt die Aufrufe der letzten Tage, die noch fehlen (bis zu 7, falls ein Lauf ausfiel). */
async function countVisits(
	site: SiteProfile,
	deps: MonitorDeps,
	net: Net,
	now: Date,
) {
	const tag = site.seo.statistik?.cloudflareSiteTag;
	if (!tag || !deps.env.CF_ACCOUNT_ID || !deps.env.CF_ANALYTICS_TOKEN) return;
	const known =
		(await deps.store.getSetting<Record<string, number>>(countsKey(site.id))) ??
		{};
	const missing = Array.from({ length: 7 }, (_, i) =>
		isoDay(new Date(now.getTime() - (i + 1) * DAY)),
	).filter((d) => !(d in known));
	if (!missing.length) return;
	const fresh = await dailyCounts(deps.env, tag, missing, net);
	// 100 Tage reichen für den Vergleich zweier Monate.
	const keep = isoDay(new Date(now.getTime() - 100 * DAY));
	const all = Object.entries({ ...known, ...fresh })
		.filter(([d]) => d >= keep)
		.sort(([a], [b]) => a.localeCompare(b));
	await deps.store.putSetting(countsKey(site.id), Object.fromEntries(all));
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const utf8 = (s: string) => new TextEncoder().encode(s);
const base64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

/** Anmeldung als Google-Dienstkonto (signiertes JWT), nur Leserecht für Search Console. */
async function googleToken(serviceAccount: string, net: Net, now: Date) {
	const sa = JSON.parse(serviceAccount) as {
		client_email: string;
		private_key: string;
	};
	const iat = Math.floor(now.getTime() / 1000);
	const part = (o: unknown) => base64url(utf8(JSON.stringify(o)));
	const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
		iss: sa.client_email,
		scope: "https://www.googleapis.com/auth/webmasters.readonly",
		aud: TOKEN_URL,
		iat,
		exp: iat + 3600,
	})}`;
	const der = Uint8Array.from(
		atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")),
		(c) => c.charCodeAt(0),
	);
	const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
	const key = await crypto.subtle.importKey("pkcs8", der, algorithm, false, [
		"sign",
	]);
	const signature = await crypto.subtle.sign(algorithm, key, utf8(unsigned));
	const res = await net(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
		}),
	});
	if (!res.ok) throw new Error(`Google-Anmeldung: Antwort ${res.status}`);
	return ((await res.json()) as { access_token: string }).access_token;
}

async function searchRows(
	property: string,
	token: string,
	m: Month,
	net: Net,
): Promise<QueryRow[]> {
	const res = await net(
		`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
		{
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				startDate: m.start,
				endDate: m.end,
				dimensions: ["query"],
				rowLimit: 1000,
			}),
		},
	);
	if (!res.ok) throw new Error(`Search Console: Antwort ${res.status}`);
	const data = (await res.json()) as {
		rows?: { keys: string[]; position: number; impressions: number }[];
	};
	return (data.rows ?? []).map((r) => ({
		query: r.keys[0] ?? "",
		position: r.position,
		impressions: r.impressions,
	}));
}

async function linkStatus(url: string, net: Net) {
	try {
		const res = await net(url, {
			method: "HEAD",
			redirect: "follow",
			headers: UA,
			signal: AbortSignal.timeout(8000),
		});
		if (!isBroken(res.status) && res.status !== 405) return res.status;
	} catch (e) {
		if (e instanceof OutOfBudget) throw e;
	}
	// Zweiter Versuch mit GET: Manche Server können kein HEAD oder waren kurz weg.
	try {
		const res = await net(url, {
			redirect: "follow",
			headers: UA,
			signal: AbortSignal.timeout(8000),
		});
		await res.body?.cancel();
		return res.status;
	} catch (e) {
		if (e instanceof OutOfBudget) throw e;
		return 0;
	}
}

async function brokenLinks(site: SiteProfile, net: Net) {
	const pages = new Set<string>();
	const links = new Map<string, PageLink>();
	for (const path of site.pages) {
		const url = new URL(path, site.url).toString();
		const res = await net(url, { redirect: "follow", headers: UA });
		// Ist die Seite selbst weg, ist das ein Fall für Paco, kein Auftrag.
		if (!res.ok) throw new Error(`${path} antwortet mit ${res.status}`);
		pages.add(url);
		for (const link of extractLinks(await res.text(), url))
			if (!links.has(link.url)) links.set(link.url, link);
	}
	const broken: BrokenLink[] = [];
	const todo = [...links.values()].filter((l) => !pages.has(l.url));
	for (const link of todo.slice(0, SCHWELLEN.maxLinks)) {
		const status = await linkStatus(link.url, net);
		if (isBroken(status)) broken.push({ ...link, status });
	}
	return broken;
}

type Results = Partial<Record<Notice["kind"], NoticeDraft | null>>;

/** Prüft eine Website. Was sich nicht prüfen ließ, fehlt im Ergebnis. */
async function checkSite(
	site: SiteProfile,
	deps: MonitorDeps,
	net: Net,
	now: Date,
	fehler: string[],
) {
	const { last, before } = lastTwoMonths(now);
	const results: Results = {};
	const attempt = async (
		kind: Notice["kind"],
		run: () => Promise<NoticeDraft | null>,
	) => {
		try {
			results[kind] = await run();
		} catch (e) {
			fehler.push(`${site.id} ${kind}: ${(e as Error).message}`);
		}
	};
	const property = site.seo.statistik?.searchConsole;
	const account = deps.env.GSC_SERVICE_ACCOUNT;
	if (property && account)
		await attempt("google", async () => {
			const token = await googleToken(account, net, now);
			const b = await searchRows(property, token, before, net);
			const l = await searchRows(property, token, last, net);
			return googleNotice(site, rankDrops(site.seo.keywords, b, l), last);
		});
	if (site.seo.statistik?.cloudflareSiteTag)
		await attempt("besuche", async () => {
			const counts =
				(await deps.store.getSetting<Record<string, number>>(
					countsKey(site.id),
				)) ?? {};
			return visitNotice(site, visitDrop(counts, before, last), before, last);
		});
	await attempt("links", async () =>
		linkNotice(site, await brokenLinks(site, net)),
	);
	return results;
}

const lastBy = (r: ChangeRequest) => r.events.at(-1)?.by;

/** Übernimmt die Ergebnisse: höchstens ein offener Hinweis je Art und Website. */
async function apply(
	site: SiteProfile,
	results: Results,
	deps: MonitorDeps,
	now: string,
	uuid: () => string,
) {
	const notices = (await deps.store.getSetting<Notice[]>(NOTICES)) ?? [];
	let created = 0;
	for (const [kind, draft] of Object.entries(results) as [
		Notice["kind"],
		NoticeDraft | null,
	][]) {
		const mine = notices.filter((n) => n.siteId === site.id && n.kind === kind);
		const requests = await Promise.all(
			mine.map((n) => deps.store.getRequest(n.requestId)),
		);
		const i = requests.findIndex((r) => r && isWaiting(r));
		const open = i >= 0 ? mine[i] : null;
		const openRequest = i >= 0 ? requests[i] : null;
		if (!draft) {
			// Nur Links erledigen sich von selbst. Ein gefallener Platz bleibt, bis Peter entscheidet.
			if (openRequest && kind === "links")
				await deps.store.putRequest(
					withStatus(openRequest, "verworfen", now, {
						kind: "status",
						text: "Hat sich erledigt: Die Links gehen wieder",
						by: "websi",
					}),
				);
			continue;
		}
		// Schon in Arbeit oder von Peter verworfen: nicht noch einmal melden.
		const known = mine.some((n, j) => {
			const r = requests[j];
			if (n.key !== draft.key || !r) return false;
			if (r.status === "verworfen") return lastBy(r) === "peter";
			return r.status !== "veroeffentlicht";
		});
		if (known) continue;
		if (open && openRequest) {
			Object.assign(open, {
				key: draft.key,
				title: draft.title,
				detail: draft.detail,
			});
			await deps.store.putRequest({
				...openRequest,
				text: draft.text,
				updatedAt: now,
				events: [
					...openRequest.events,
					{
						at: now,
						kind: "status",
						text: `Von WEBSI aktualisiert: ${draft.text}`,
						by: "websi",
					},
				],
			});
			continue;
		}
		const request = createRequest(
			{
				siteId: site.id,
				sectionId: WHOLE_PAGE.id,
				text: draft.text,
				pagePath: site.editorPath,
			},
			uuid(),
			now,
			"websi",
		);
		await deps.store.putRequest(request);
		notices.push({
			id: uuid(),
			siteId: site.id,
			kind,
			key: draft.key,
			title: draft.title,
			detail: draft.detail,
			requestId: request.id,
			createdAt: now,
		});
		created++;
	}
	await deps.store.putSetting(NOTICES, notices.slice(-50));
	return created;
}

/** Offene Hinweise: deren vorbereiteter Auftrag noch auf Peter wartet. */
export async function openNotices(store: Store) {
	const notices = (await store.getSetting<Notice[]>(NOTICES)) ?? [];
	const open: Notice[] = [];
	for (const n of notices) {
		const r = await store.getRequest(n.requestId);
		if (r && isWaiting(r)) open.push(n);
	}
	return open;
}

export const monitorState = (store: Store) =>
	store.getSetting<MonitorState>(STATE);

/**
 * Täglich per Cron: Aufrufe zählen. Ab dem 4. einmal im Monat prüfen.
 * Nur Websites mit stage „live“; force prüft sofort (Test nach dem Online-Gang).
 */
export async function runMonitor(deps: MonitorDeps, force = false) {
	const now = deps.now ?? new Date();
	const live = deps.sites.filter((s) => s.stage === "live");
	const state = (await monitorState(deps.store)) ?? {};
	if (!live.length) return state;
	const net = limited(deps.fetcher ?? ((url, init) => fetch(url, init)));
	const uuid = deps.uuid ?? (() => crypto.randomUUID());

	const tag: string[] = [];
	for (const site of live) {
		try {
			await countVisits(site, deps, net, now);
		} catch (e) {
			tag.push(`${site.id} besuche: ${(e as Error).message}`);
		}
	}
	state.tag = { at: now.toISOString(), fehler: tag };

	const { last } = lastTwoMonths(now);
	const due = now.getUTCDate() >= PRUEFTAG && state.monat?.key !== last.key;
	if (force || due) {
		const fehler: string[] = [];
		let hinweise = 0;
		for (const site of live) {
			const results = await checkSite(site, deps, net, now, fehler);
			hinweise += await apply(site, results, deps, now.toISOString(), uuid);
		}
		state.monat = { key: last.key, at: now.toISOString(), hinweise, fehler };
	}
	await deps.store.putSetting(STATE, state);
	return state;
}
