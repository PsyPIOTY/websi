import { describe, expect, it } from "vitest";
import type { ChangeRequest, VisibilityReport } from "../core/types";
import { cloudflareRows, costStop, type UsageSummary } from "../core/usage";
import { siteProfiles } from "../sites";
import { createApi } from "../worker/api";
import { cloudflareUsage } from "../worker/costs";
import { MemoryStore } from "../worker/storage";

const at = "2026-10-31T12:00:00Z";

function setup(cloudflare?: Parameters<typeof createApi>[0]["cloudflare"]) {
	const store = new MemoryStore();
	let n = 0;
	const api = createApi({
		store,
		sites: siteProfiles,
		env: { AGENT_MODE: "test" },
		uuid: () => `r${++n}`,
		now: () => new Date(at),
		cloudflare,
		scan: async (site): Promise<VisibilityReport> => ({
			siteId: site.id,
			scannedAt: at,
			score: 50,
			checks: [],
			keywords: [],
			errors: [],
		}),
	});
	const call = async <T = ChangeRequest & { error?: string }>(
		method: string,
		path: string,
		body?: unknown,
	) => {
		const res = await api.handle(
			new Request(`https://websi.test/api/websi/${path}`, {
				method,
				body: body ? JSON.stringify(body) : undefined,
			}),
		);
		if (!res) throw new Error("keine Antwort");
		return { status: res.status, data: (await res.json()) as T };
	};
	return { store, call };
}

const wish = (text: string, extra = {}) => ({
	siteId: "praxis",
	sectionId: "faq",
	text,
	pagePath: "/",
	...extra,
});

describe("Kostenwächter", () => {
	it("stoppt, bevor ein Auftrag den Tagesrichtwert überschreitet, auch bei Entwürfen", async () => {
		const { call } = setup();
		await call("PUT", "usage/limits", { claude: 3 });
		expect((await call("POST", "requests", wish("A"))).status).toBe(201);
		const tooMany = await call(
			"POST",
			"requests",
			wish("B", { drafts: ["knapp", "mutig", "ausführlich"] }),
		);
		expect(tooMany.status).toBe(429);
		expect(tooMany.data.error).toContain("dieser Auftrag bräuchte 3");
		expect(
			(
				await call(
					"POST",
					"requests",
					wish("C", { drafts: ["knapp", "mutig"] }),
				)
			).status,
		).toBe(201);
		const stop = await call("POST", "requests", wish("D"));
		expect(stop.status).toBe(429);
		expect(stop.data.error).toContain("3 von 3");
		// Sammeln geht weiter, nur das Losschicken stoppt.
		expect(
			(await call("POST", "requests", wish("E", { send: false }))).status,
		).toBe(201);
		expect((await call("POST", "batches", { siteId: "praxis" })).status).toBe(
			429,
		);
	});

	it("stoppt bei erreichter freier Grenze von Cloudflare und zeigt den Verbrauch", async () => {
		const usage = {
			day: "2026-10-31",
			requests: 100_000,
			rowsRead: 10,
			rowsWritten: 5,
		};
		const { call } = setup(async () => ({ at, data: usage }));
		const res = await call("POST", "requests", wish("A"));
		expect(res.status).toBe(429);
		expect(res.data.error).toContain("Aufrufe aller Worker");
		const summary = await call<UsageSummary>("GET", "usage");
		const cf = summary.data.cloudflare;
		expect(cf && "rows" in cf && cf.rows[0]).toMatchObject({
			id: "requests",
			level: "erreicht",
		});
	});

	it("bewertet Cloudflare ab 80 % als knapp", () => {
		const rows = cloudflareRows({
			day: "d",
			requests: 80_000,
			rowsRead: 0,
			rowsWritten: 0,
		});
		expect(rows.map((r) => r.level)).toEqual(["knapp", "ok", "ok"]);
		const summary: UsageSummary = {
			engines: [],
			github: { minutesMonth: 0, free: 2000, level: "ok" },
			cloudflare: { at, rows },
		};
		expect(costStop(summary, "claude")).toBeNull();
	});
});

describe("Cloudflare-Verbrauch", () => {
	const env = { CF_ACCOUNT_ID: "acc", CF_ANALYTICS_TOKEN: "t" };

	it("summiert Worker und Datenbank und fragt höchstens alle 15 Minuten", async () => {
		const store = new MemoryStore();
		let calls = 0;
		const fetcher = async (_url: string, init?: RequestInit) => {
			calls++;
			const body = JSON.parse(String(init?.body));
			expect(body.variables).toEqual({ account: "acc", day: "2026-10-31" });
			return new Response(
				JSON.stringify({
					data: {
						viewer: {
							accounts: [
								{
									workers: [
										{ sum: { requests: 40 } },
										{ sum: { requests: 2 } },
									],
									d1: [{ sum: { rowsRead: 900, rowsWritten: 12 } }],
								},
							],
						},
					},
				}),
			);
		};
		const first = await cloudflareUsage({
			store,
			env,
			fetcher,
			now: new Date(at),
		});
		expect(first).toEqual({
			at: new Date(at).toISOString(),
			data: { day: "2026-10-31", requests: 42, rowsRead: 900, rowsWritten: 12 },
		});
		await cloudflareUsage({
			store,
			env,
			fetcher,
			now: new Date("2026-10-31T12:10:00Z"),
		});
		expect(calls).toBe(1);
		await cloudflareUsage({
			store,
			env,
			fetcher,
			now: new Date("2026-10-31T12:20:00Z"),
		});
		expect(calls).toBe(2);
	});

	it("meldet Fehler, ohne Schlüssel bleibt es still", async () => {
		const store = new MemoryStore();
		expect(await cloudflareUsage({ store, env: {} })).toBeNull();
		const failing = async () =>
			new Response(JSON.stringify({ errors: [{ message: "kein Recht" }] }), {
				status: 403,
			});
		expect(
			await cloudflareUsage({
				store,
				env,
				fetcher: failing,
				now: new Date(at),
			}),
		).toEqual({ error: "Cloudflare-Verbrauch: kein Recht" });
	});
});
