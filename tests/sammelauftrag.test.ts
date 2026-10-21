import { describe, expect, it } from "vitest";
import type { ChangeRequest, VisibilityReport } from "../core/types";
import type { UsageSummary } from "../core/usage";
import { siteProfiles } from "../sites";
import { createApi } from "../worker/api";
import { MemoryStore } from "../worker/storage";

function setup(at = "2026-10-21T21:00:00Z") {
	const store = new MemoryStore();
	let n = 0;
	const api = createApi({
		store,
		sites: siteProfiles,
		env: { AGENT_MODE: "test" },
		uuid: () => `r${++n}`,
		now: () => new Date(at),
		scan: async (site): Promise<VisibilityReport> => ({
			siteId: site.id,
			scannedAt: at,
			score: 50,
			checks: [],
			keywords: [],
			errors: [],
		}),
	});
	const call = async <T = ChangeRequest & { related: ChangeRequest[] }>(
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
	const collect = (sectionId: string, text: string, extra = {}) =>
		call("POST", "requests", {
			siteId: "praxis",
			sectionId,
			text,
			pagePath: "/",
			send: false,
			...extra,
		});
	return { store, call, collect };
}

describe("Sammelauftrag", () => {
	it("sammelt Wünsche und schickt sie als einen Auftrag mit gewähltem Modell", async () => {
		const { call, collect } = setup();
		expect((await collect("hero", "Ruhiger")).data.status).toBe("offen");
		await collect("faq", "Kürzer");
		await collect("faq", "Neue Frage");
		const sent = await call<ChangeRequest[]>("POST", "batches", {
			siteId: "praxis",
			engine: "codex",
		});
		expect(sent.status).toBe(201);
		expect(sent.data).toHaveLength(3);
		const ids = new Set(sent.data.map((r) => r.external?.id));
		expect(ids.size).toBe(1);
		expect(new Set(sent.data.map((r) => r.batchId)).size).toBe(1);
		expect(sent.data.every((r) => r.engine === "codex")).toBe(true);
		expect(sent.data[0].events.at(-1)?.text).toContain(
			"Sammelauftrag mit 3 Wünschen",
		);
		expect((await call("POST", "batches", { siteId: "praxis" })).status).toBe(
			409,
		);
	});

	it("gleicht ab, bessert nach und veröffentlicht den ganzen Sammelauftrag", async () => {
		const { call, collect, store } = setup();
		await collect("hero", "A");
		await collect("faq", "B");
		await call("POST", "batches", { siteId: "praxis" });

		const synced = await call("POST", "requests/r1/sync");
		expect(synced.data.status).toBe("vorschlag");
		expect(synced.data.related.map((r) => r.status)).toEqual(["vorschlag"]);
		expect(synced.data.external?.previewUrl).toBe(siteProfiles[0].url);

		const follow = await call("POST", "requests/r2/followup", {
			text: "Keine Ausrufezeichen",
			remember: true,
		});
		expect(follow.data.related).toHaveLength(1);
		expect((await store.getRequest("r1"))?.status).toBe("in_arbeit");

		await call("POST", "requests/r1/sync");
		const pub = await call("POST", "requests/r1/publish");
		expect(pub.data.status).toBe("veroeffentlicht");
		expect((await store.getRequest("r2"))?.status).toBe("veroeffentlicht");
	});

	it("lehnt unbekannte Modelle ab", async () => {
		const { collect } = setup();
		expect((await collect("hero", "x", { engine: "gpt9" })).status).toBe(400);
	});
});

describe("Stil-Gedächtnis", () => {
	it("merkt Regeln je Website und für alle, und gibt sie jedem Auftrag mit", async () => {
		const { call } = setup();
		await call("POST", "style/praxis", { text: "Du statt Sie" });
		await call("POST", "style/humansource", {
			text: "Kurze Sätze",
			scope: "alle",
		});
		await call("POST", "style/humansource", { text: "Nur für HSB" });
		const got = await call<{ rules: { text: string }[] }>(
			"GET",
			"style/praxis",
		);
		expect(got.data.rules.map((r) => r.text)).toEqual([
			"Du statt Sie",
			"Kurze Sätze",
		]);
	});

	it("schlägt Nachbesserungen und Verwerf-Gründe als Regeln vor", async () => {
		const { call } = setup();
		await call("POST", "requests", {
			siteId: "praxis",
			sectionId: "hero",
			text: "A",
			pagePath: "/",
		});
		await call("POST", "requests/r1/followup", { text: "Wärmer formulieren" });
		await call("POST", "requests/r1/discard", {
			reason: "Zu werblich",
			remember: false,
		});
		const got = await call<{
			rules: unknown[];
			suggestions: { text: string; source: string }[];
		}>("GET", "style/praxis");
		expect(got.data.rules).toHaveLength(0);
		expect(got.data.suggestions.map((s) => s.text).sort()).toEqual([
			"Wärmer formulieren",
			"Zu werblich",
		]);
	});

	it("schaltet Regeln ab und löscht sie", async () => {
		const { call } = setup();
		const rule = await call<{ id: string }>("POST", "style/praxis", {
			text: "Keine Anglizismen",
		});
		const off = await call<{ active: boolean }>(
			"PATCH",
			`style/praxis/${rule.data.id}`,
			{ active: false },
		);
		expect(off.data.active).toBe(false);
		await call("DELETE", `style/praxis/${rule.data.id}`);
		const got = await call<{ rules: unknown[] }>("GET", "style/praxis");
		expect(got.data.rules).toHaveLength(0);
	});
});

describe("Kontingent", () => {
	it("zählt Läufe je Modell, Sammelaufträge nur einmal", async () => {
		const { call, collect } = setup();
		await collect("hero", "A");
		await collect("faq", "B");
		await call("POST", "batches", { siteId: "praxis" });
		await call("POST", "requests", {
			siteId: "praxis",
			sectionId: "hero",
			text: "C",
			pagePath: "/",
			engine: "ollama",
		});
		await call("PUT", "usage/limits", { claude: 2 });
		const usage = await call<UsageSummary>("GET", "usage");
		const claude = usage.data.engines.find((e) => e.id === "claude");
		const ollama = usage.data.engines.find((e) => e.id === "ollama");
		expect(claude).toMatchObject({ today: 1, limit: 2, level: "ok" });
		expect(ollama?.today).toBe(1);
		expect(usage.data.github.free).toBe(2000);
	});
});
