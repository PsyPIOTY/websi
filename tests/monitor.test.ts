import { describe, expect, it } from "vitest";
import {
	extractLinks,
	isBroken,
	lastTwoMonths,
	type QueryRow,
	rankDrops,
	visitDrop,
} from "../core/monitor";
import type { SiteProfile, VisibilityReport } from "../core/types";
import { praxis } from "../sites/praxis";
import { createApi } from "../worker/api";
import { tokenPath } from "../worker/index";
import { TOOLS } from "../worker/mcp";
import { type MonitorEnv, runMonitor } from "../worker/monitor";
import { MemoryStore } from "../worker/storage";

const live: SiteProfile = {
	...praxis,
	stage: "live",
	url: "https://peterjarek.de",
	editorPath: "/",
	pages: ["/"],
	seo: {
		...praxis.seo,
		statistik: {
			cloudflareSiteTag: "tag-praxis",
			searchConsole: "sc-domain:peterjarek.de",
		},
	},
};

const PAGE = `<html><body>
	<a href="#kontakt">Kontakt</a>
	<a href="mailto:praxis@peterjarek.de">Mail</a>
	<a href="tel:+491713830060">Anrufen</a>
	<a href="/impressum">Impressum</a>
	<a href="https://www.therapie.de/profil/jarek/">Profil bei therapie.de</a>
	<a href="https://www.therapie.de/profil/jarek/#bewertungen">nochmal</a>
	<a href="https://www.instagram.com/praxis">Instagram</a>
</body></html>`;

const days = (from: string, n: number, count: number) =>
	Object.fromEntries(
		Array.from({ length: n }, (_, i) => [
			new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10),
			count,
		]),
	);

async function serviceAccount() {
	const pair = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	const der = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", pair.privateKey),
	);
	const body = btoa(String.fromCharCode(...der)).replace(/.{64}/g, "$&\n");
	const json = JSON.stringify({
		client_email: "websi@praxis.iam.gserviceaccount.com",
		private_key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
	});
	return { json, publicKey: pair.publicKey };
}

interface Net {
	/** Antwort je Link; 0 = keine Antwort. */
	links?: Record<string, number>;
	/** Search Console je Monat (Startdatum). */
	ranks?: Record<string, QueryRow[]>;
	/** Aufrufe pro Tag laut Cloudflare. */
	perDay?: number;
	publicKey?: CryptoKey;
}

function network(net: Net = {}) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const jwt: Record<string, unknown>[] = [];
	const fetcher = async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		if (url === "https://peterjarek.de/") return new Response(PAGE);
		if (url === "https://oauth2.googleapis.com/token") {
			const assertion =
				new URLSearchParams(String(init?.body)).get("assertion") ?? "";
			const [head, claims, sig] = assertion.split(".");
			const bytes = (s: string) =>
				Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
					c.charCodeAt(0),
				);
			const valid =
				net.publicKey &&
				(await crypto.subtle.verify(
					"RSASSA-PKCS1-v1_5",
					net.publicKey,
					bytes(sig),
					new TextEncoder().encode(`${head}.${claims}`),
				));
			if (!valid) return new Response("{}", { status: 400 });
			jwt.push(JSON.parse(new TextDecoder().decode(bytes(claims))));
			return Response.json({ access_token: "google-token" });
		}
		if (url.includes("/sites/sc-domain%3Apeterjarek.de/searchAnalytics/")) {
			const { startDate } = JSON.parse(String(init?.body));
			const rows = (net.ranks?.[startDate] ?? []).map((r) => ({
				keys: [r.query],
				position: r.position,
				impressions: r.impressions,
			}));
			return Response.json({ rows });
		}
		if (url === "https://api.cloudflare.com/client/v4/graphql") {
			const { variables } = JSON.parse(String(init?.body));
			const account: Record<string, { count: number }[]> = {};
			for (let i = 0; `s${i}` in variables; i++)
				account[`d${i}`] = [{ count: net.perDay ?? 0 }];
			return Response.json({ data: { viewer: { accounts: [account] } } });
		}
		const status = net.links?.[url] ?? 200;
		if (status === 0) throw new TypeError("fetch failed");
		return new Response(null, { status });
	};
	return { fetcher, calls, jwt };
}

function setup(env: MonitorEnv = {}, site = live) {
	const store = new MemoryStore();
	let n = 0;
	const uuid = () => `id${++n}`;
	const run = (at: string, net: ReturnType<typeof network>, force = false) =>
		runMonitor(
			{
				store,
				sites: [site],
				env,
				now: new Date(at),
				fetcher: net.fetcher,
				uuid,
			},
			force,
		);
	const api = createApi({
		store,
		sites: [site],
		env: { AGENT_MODE: "test" },
		uuid,
		now: () => new Date("2026-11-04T05:00:00Z"),
		scan: async (): Promise<VisibilityReport> => {
			throw new Error("nicht gebraucht");
		},
		runMonitor: () => run("2026-11-04T05:00:00Z", network(), true),
	});
	const call = async (method: string, path: string, body?: unknown) => {
		const res = await api.handle(
			new Request(`https://websi.test/api/websi/${path}`, {
				method,
				body: body ? JSON.stringify(body) : undefined,
			}),
		);
		if (!res) throw new Error("keine Antwort");
		return {
			status: res.status,
			data: (await res.json()) as Record<string, never>,
		};
	};
	return { store, run, call };
}

const BROKEN = "https://www.therapie.de/profil/jarek/";

describe("Monatsprüfung, Logik", () => {
	it("nimmt nur echte Links, ohne Sprungmarken, Mail und Telefon", () => {
		const links = extractLinks(PAGE, "https://peterjarek.de/");
		expect(links.map((l) => l.url)).toEqual([
			"https://peterjarek.de/impressum",
			BROKEN,
			"https://www.instagram.com/praxis",
		]);
		expect(links[1].text).toBe("Profil bei therapie.de");
	});

	it("meldet nur fehlende Seiten, Serverfehler und Funkstille als kaputt", () => {
		expect([0, 404, 410, 500, 503].every(isBroken)).toBe(true);
		expect([200, 401, 403, 429, 999].some(isBroken)).toBe(false);
	});

	it("rechnet mit vollen Monaten, auch über den Jahreswechsel", () => {
		const nov = lastTwoMonths(new Date("2026-11-04T05:00:00Z"));
		expect(nov.last).toMatchObject({
			key: "2026-10",
			label: "Oktober",
			end: "2026-10-31",
			days: 31,
		});
		expect(nov.before).toMatchObject({ key: "2026-09", days: 30 });
		const jan = lastTwoMonths(new Date("2027-01-05T05:00:00Z"));
		expect(jan.last.key).toBe("2026-12");
		expect(jan.before.key).toBe("2026-11");
	});

	it("meldet Google erst ab drei Plätzen oder dem Rutsch von Seite 1", () => {
		const k = (phrase: string) => ({ phrase });
		const row = (query: string, position: number, impressions = 40) => ({
			query,
			position,
			impressions,
		});
		const drops = rankDrops(
			[
				k("Psychologe Bad Belzig"),
				k("Paartherapie Bad Belzig"),
				k("Beziehungsberatung"),
				k("Kommunikations-Coaching"),
			],
			[
				row("psychologe bad belzig", 6.2),
				row("paartherapie bad belzig", 9.4),
				row("beziehungsberatung", 4),
				row("kommunikations-coaching", 3, 4),
			],
			[
				row("psychologe bad belzig", 10.6),
				row("paartherapie bad belzig", 11.2),
				row("beziehungsberatung", 5.9),
				row("kommunikations-coaching", 30, 4),
			],
		);
		expect(drops).toEqual([
			{ phrase: "Psychologe Bad Belzig", from: 6, to: 11 },
			{ phrase: "Paartherapie Bad Belzig", from: 9, to: 11 },
		]);
	});

	it("meldet Besucher erst ab 40 % weniger und mit genug Zahlen", () => {
		const { last, before } = lastTwoMonths(new Date("2026-11-04T05:00:00Z"));
		const counts = (sep: number, oct: number, octDays = 31) => ({
			...days("2026-09-01", 30, sep),
			...days("2026-10-01", octDays, oct),
		});
		expect(visitDrop(counts(10, 5), before, last)).toEqual({
			before: 300,
			last: 155,
			percent: 50,
		});
		expect(visitDrop(counts(10, 7), before, last)).toBeNull();
		expect(visitDrop(counts(1, 0), before, last)).toBeNull();
		expect(visitDrop(counts(10, 0, 20), before, last)).toBeNull();
	});
});

describe("Monatsprüfung, Ablauf", () => {
	it("tut nichts, solange die Seite ein Entwurf ist", async () => {
		const { store, run } = setup({}, praxis);
		const net = network({ links: { [BROKEN]: 404 } });
		await run("2026-11-04T05:00:00Z", net, true);
		expect(net.calls).toHaveLength(0);
		expect(store.settings.size).toBe(0);
	});

	it("bereitet bei einem kaputten Link einen Auftrag vor und meldet ihn einmal", async () => {
		const { store, run, call } = setup();
		const state = await run(
			"2026-11-04T05:00:00Z",
			network({ links: { [BROKEN]: 404 } }),
		);
		expect(state.monat).toMatchObject({ key: "2026-10", hinweise: 1 });

		const { data } = await call("GET", "hinweise");
		const [hinweis] = data.hinweise as unknown as Record<string, string>[];
		expect(hinweis.title).toBe("Praxis Peter Jarek: ein Link geht ins Leere");
		expect(hinweis.detail).toContain("„Profil bei therapie.de“");
		expect(hinweis.link).toBe(
			`https://websi.test/#site=praxis&tab=auftraege&auftrag=${hinweis.requestId}`,
		);
		const request = await store.getRequest(hinweis.requestId);
		expect(request).toMatchObject({
			status: "offen",
			sectionId: "ganze-seite",
			pagePath: "/",
		});
		expect(request?.external).toBeUndefined();
		expect(request?.events[0].by).toBe("websi");
		expect(request?.text).toContain(`${BROKEN}, Antwort 404`);
		expect(request?.text).toContain("Therapie-Aussagen nicht ändern");

		// Nächster Monat, Link noch kaputt: kein zweiter Hinweis.
		await run("2026-12-04T05:00:00Z", network({ links: { [BROKEN]: 404 } }));
		expect((await call("GET", "hinweise")).data.hinweise).toHaveLength(1);
		expect(store.requests.size).toBe(1);
	});

	it("meldet Verworfenes nicht wieder und erledigt reparierte Links selbst", async () => {
		const { store, run, call } = setup();
		const broken = network({ links: { [BROKEN]: 0 } });
		await run("2026-11-04T05:00:00Z", broken);
		const [first] = (await call("GET", "hinweise")).data
			.hinweise as unknown as { requestId: string }[];
		expect((await store.getRequest(first.requestId))?.text).toContain(
			"keine Antwort",
		);

		await call("POST", `requests/${first.requestId}/discard`, {});
		await run("2026-12-04T05:00:00Z", network({ links: { [BROKEN]: 0 } }));
		expect((await call("GET", "hinweise")).data.hinweise).toHaveLength(0);

		// Ein anderer Link geht kaputt: neuer Hinweis. Danach geht er wieder.
		const other = "https://www.instagram.com/praxis";
		await run("2027-01-04T05:00:00Z", network({ links: { [other]: 410 } }));
		const [second] = (await call("GET", "hinweise")).data
			.hinweise as unknown as { requestId: string }[];
		expect(second.requestId).not.toBe(first.requestId);
		await run("2027-02-04T05:00:00Z", network());
		expect((await call("GET", "hinweise")).data.hinweise).toHaveLength(0);
		const closed = await store.getRequest(second.requestId);
		expect(closed?.status).toBe("verworfen");
		expect(closed?.events.at(-1)?.by).toBe("websi");
	});

	it("meldet einen deutlich gefallenen Google-Platz mit Peters Suchbegriff", async () => {
		const sa = await serviceAccount();
		const { store, run, call } = setup({ GSC_SERVICE_ACCOUNT: sa.json });
		const row = (position: number) => [
			{ query: "psychologe bad belzig", position, impressions: 40 },
		];
		const net = network({
			publicKey: sa.publicKey,
			ranks: { "2026-09-01": row(6.1), "2026-10-01": row(11.3) },
		});
		const state = await run("2026-11-04T05:00:00Z", net);
		expect(state.monat?.fehler).toEqual([]);
		expect(net.jwt[0]).toMatchObject({
			iss: "websi@praxis.iam.gserviceaccount.com",
			scope: "https://www.googleapis.com/auth/webmasters.readonly",
			aud: "https://oauth2.googleapis.com/token",
		});

		const [hinweis] = (await call("GET", "hinweise")).data
			.hinweise as unknown as Record<string, string>[];
		expect(hinweis.title).toBe("Praxis Peter Jarek bei Google gefallen");
		expect(hinweis.detail).toBe(
			"„Psychologe Bad Belzig“: Platz 6 → 11. WEBSI hat einen Auftrag vorbereitet.",
		);
		expect((await store.getRequest(hinweis.requestId))?.text).toContain(
			"im Oktober gefallen",
		);
	});

	it("zählt täglich die Aufrufe und meldet einen starken Rückgang am 4.", async () => {
		const env = { CF_ACCOUNT_ID: "konto", CF_ANALYTICS_TOKEN: "lesen" };
		const { store, run, call } = setup(env);
		const first = network({ perDay: 3 });
		const state = await run("2026-11-02T05:00:00Z", first);
		expect(state.monat).toBeUndefined();
		const graphql = first.calls.filter((c) => c.url.includes("graphql"));
		expect(graphql).toHaveLength(1);
		expect(graphql[0].init?.headers).toMatchObject({
			authorization: "Bearer lesen",
		});
		expect(
			Object.keys(JSON.parse(String(graphql[0].init?.body)).variables),
		).toContain("s6");
		expect(
			Object.keys((await store.getSetting("aufrufe/praxis")) ?? {}),
		).toHaveLength(7);

		// September 10 am Tag, Oktober 3 am Tag.
		await store.putSetting("aufrufe/praxis", {
			...days("2026-09-01", 30, 10),
			...days("2026-10-01", 31, 3),
		});
		const net = network({ perDay: 3 });
		await run("2026-11-04T05:00:00Z", net);
		const [hinweis] = (await call("GET", "hinweise")).data
			.hinweise as unknown as Record<string, string>[];
		expect(hinweis.title).toBe("Praxis Peter Jarek: deutlich weniger Besucher");
		expect(hinweis.detail).toContain(
			"Oktober rund 93 Aufrufe, September rund 300 (−70 %)",
		);
	});

	it("prüft einmal im Monat ab dem 4. und bleibt unter der Abruf-Grenze", async () => {
		const { run } = setup();
		const links = Object.fromEntries(
			Array.from({ length: 40 }, (_, i) => [`https://x.test/${i}`, 0]),
		);
		const page = `<html><body>${Object.keys(links)
			.map((u) => `<a href="${u}">${u}</a>`)
			.join("")}</body></html>`;
		const net = network({ links });
		const fetcher = net.fetcher;
		net.fetcher = (url, init) =>
			url === "https://peterjarek.de/"
				? Promise.resolve(new Response(page))
				: fetcher(url, init);

		expect((await run("2026-11-03T05:00:00Z", net)).monat).toBeUndefined();
		const state = await run("2026-11-04T05:00:00Z", net);
		expect(state.monat?.fehler[0]).toContain("Abruf-Grenze");
		expect(net.calls.length).toBeLessThanOrEqual(45);
		const again = await run("2026-11-05T05:00:00Z", network());
		expect(again.monat?.at).toBe(state.monat?.at);
	});

	it("ist über die MCP-Brücke erreichbar und lässt sich von Hand starten", async () => {
		const names = TOOLS.map((t) => t.name);
		expect(names).toContain("websi_hinweise");
		expect(names).toContain("websi_pruefen");
		const { call } = setup();
		const { data } = await call("POST", "hinweise/pruefen");
		expect(data.monat).toMatchObject({ key: "2026-10" });
	});

	it("lässt Pacos Dashboard die Hinweise mit Token nur lesen", () => {
		const at = (method: string, path: string) =>
			tokenPath(
				new Request(`https://websi.test/api/websi/${path}`, { method }),
			);
		expect(at("GET", "hinweise")).toBe(true);
		expect(at("POST", "mcp")).toBe(true);
		expect(at("POST", "hinweise/pruefen")).toBe(false);
		expect(at("POST", "hinweise")).toBe(false);
		expect(at("GET", "requests")).toBe(false);
	});
});
