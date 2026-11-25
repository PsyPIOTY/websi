import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeRequest, VisibilityReport } from "../core/types";
import { siteProfiles } from "../sites";
import { createApi } from "../worker/api";
import { MemoryStore } from "../worker/storage";

function setup() {
	const store = new MemoryStore();
	let n = 0;
	const api = createApi({
		store,
		sites: siteProfiles,
		env: { AGENT_MODE: "test" },
		uuid: () => `r${++n}`,
		now: () => new Date("2026-10-21T21:00:00Z"),
		scan: async (site): Promise<VisibilityReport> => ({
			siteId: site.id,
			scannedAt: "2026-10-21T21:00:00Z",
			score: 50,
			checks: [],
			keywords: [],
			errors: [],
		}),
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
			data: (await res.json()) as Record<string, unknown> & ChangeRequest,
		};
	};
	return { store, call };
}

describe("API", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("setzt einen auf GitHub gemergten Sammelauftrag beim Abgleich auf Live (Peter 25.11.)", async () => {
		const { store, call } = setup();
		const base = {
			siteId: "praxis",
			text: "x",
			pagePath: "/praxis",
			status: "vorschlag" as const,
			createdAt: "t",
			updatedAt: "t",
			events: [],
			batchId: "b8",
			external: {
				adapter: "github-claude",
				id: "8",
				url: "",
				drafts: [{ name: "a", branch: "websi/issue-8-a", proposalUrl: "u" }],
				chosen: "websi/issue-8-a",
			},
		};
		await store.putRequest({ ...base, id: "a1", sectionId: "about" });
		await store.putRequest({ ...base, id: "a2", sectionId: "offers" });
		vi.stubGlobal("fetch", async (url: string) => {
			const path = new URL(url).pathname;
			if (path.endsWith("/issues/8/comments")) return Response.json([]);
			if (path.endsWith("/pulls"))
				return Response.json([
					{
						number: 11,
						html_url: "https://github.com/x/pull/11",
						state: "closed",
						merged_at: "2026-11-16T19:31:07Z",
						body: null,
						head: { ref: "websi/issue-8-praxis" },
					},
				]);
			return new Response("nicht gefunden", { status: 404 });
		});
		const res = await call("POST", "requests/a1/sync");
		expect(res.data.status).toBe("veroeffentlicht");
		expect(res.data.external?.drafts).toBeUndefined();
		const related = res.data.related as ChangeRequest[];
		expect(related.map((r) => r.status)).toEqual(["veroeffentlicht"]);
		expect(res.data.events.at(-1)?.url).toBe("https://github.com/x/pull/11");
	});

	it("führt einen Auftrag vom Wunsch bis zur Veröffentlichung", async () => {
		const { call } = setup();
		const created = await call("POST", "requests", {
			siteId: "humansource",
			sectionId: "situation",
			text: "Kürzer",
			pagePath: "/",
		});
		expect(created.status).toBe(201);
		expect(created.data.status).toBe("in_arbeit");
		expect(created.data.external?.adapter).toBe("testmodus");

		const early = await call("POST", "requests/r1/publish");
		expect(early.status).toBe(409);

		const synced = await call("POST", "requests/r1/sync");
		expect(synced.data.status).toBe("vorschlag");
		const again = await call("POST", "requests/r1/sync");
		expect(again.data.events.filter((e) => e.kind === "antwort")).toHaveLength(
			1,
		);

		const published = await call("POST", "requests/r1/publish");
		expect(published.data.status).toBe("veroeffentlicht");
	});

	it("lädt beim Wechsel alle Daten genau einer Website", async () => {
		const { call } = setup();
		await call("POST", "requests", {
			siteId: "praxis",
			sectionId: "faq",
			text: "a",
			pagePath: "/",
		});
		await call("POST", "requests", {
			siteId: "humansource",
			sectionId: "fragen",
			text: "b",
			pagePath: "/",
		});
		const site = await call("GET", "sites/praxis");
		const data = site.data as unknown as {
			profile: { id: string };
			requests: ChangeRequest[];
			directories: unknown[];
		};
		expect(data.profile.id).toBe("praxis");
		expect(data.requests.map((r) => r.text)).toEqual(["a"]);
		expect(data.directories.length).toBeGreaterThan(0);
	});

	it("lehnt unbekannte Abschnitte und leere Wünsche ab", async () => {
		const { call } = setup();
		expect(
			(
				await call("POST", "requests", {
					siteId: "praxis",
					sectionId: "gibtsnicht",
					text: "x",
				})
			).status,
		).toBe(404);
		expect(
			(
				await call("POST", "requests", {
					siteId: "praxis",
					sectionId: "faq",
					text: "",
				})
			).status,
		).toBe(400);
		expect(
			(
				await call("POST", "requests", {
					siteId: "praxis",
					sectionId: "ganze-seite",
					text: "Titel",
					pagePath: "/",
				})
			).status,
		).toBe(201);
	});

	it("speichert Verzeichnis-Status und Berichte", async () => {
		const { call, store } = setup();
		expect(
			(await call("PUT", "directories/praxis/google", { status: "beantragt" }))
				.status,
		).toBe(200);
		expect((await store.listDirectories("praxis"))[0].status).toBe("beantragt");
		expect(
			(await call("PUT", "directories/praxis/google", { status: "quatsch" }))
				.status,
		).toBe(400);
		await call("POST", "visibility/praxis/scan");
		expect((await store.latestReport("praxis"))?.score).toBe(50);
	});
});
