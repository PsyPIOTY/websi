import { describe, expect, it } from "vitest";
import type { ChangeRequest, VisibilityReport } from "../core/types";
import type { UsageSummary } from "../core/usage";
import { siteProfiles } from "../sites";
import { createApi } from "../worker/api";
import { MemoryStore } from "../worker/storage";

function setup(at = "2026-10-21T21:00:00Z", startStyle?: string[]) {
	const store = new MemoryStore();
	let n = 0;
	const api = createApi({
		store,
		sites: siteProfiles,
		env: { AGENT_MODE: "test" },
		uuid: () => `r${++n}`,
		now: () => new Date(at),
		startStyle,
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

	it("legt die Start-Regeln einmal für alle an, gelöschte kommen nicht wieder", async () => {
		const { call, store } = setup(undefined, [
			"Sie statt Du",
			"Keine KI-Bilder",
		]);
		await call("POST", "requests", {
			siteId: "praxis",
			sectionId: "hero",
			text: "A",
			pagePath: "/",
		});
		const got = await call<{ rules: { id: string; siteId: string }[] }>(
			"GET",
			"style/humansource",
		);
		expect(got.data.rules.map((r) => r.siteId)).toEqual(["alle", "alle"]);
		expect((await store.listStyle("praxis")).map((r) => r.text)).toEqual([
			"Sie statt Du",
			"Keine KI-Bilder",
		]);
		await call("DELETE", `style/praxis/${got.data.rules[0].id}`);
		const again = await call<{ rules: { text: string }[] }>(
			"GET",
			"style/praxis",
		);
		expect(again.data.rules.map((r) => r.text)).toEqual(["Keine KI-Bilder"]);
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

describe("Drei Entwürfe zur Auswahl", () => {
	it("liefert Entwürfe, sperrt Nachbessern bis zur Wahl und zählt jeden Entwurf", async () => {
		const { call, collect } = setup();
		await collect("hero", "Ruhiger");
		await collect("faq", "Kürzer");
		const sent = await call<ChangeRequest[]>("POST", "batches", {
			siteId: "praxis",
			drafts: ["knapp", "ausführlich", "mutig", "knapp"],
		});
		expect(sent.data[0].drafts).toEqual(["knapp", "ausführlich", "mutig"]);
		expect(sent.data[0].events.at(-1)?.text).toContain("3 Entwürfe");

		const id = sent.data[0].id;
		const synced = await call("POST", `requests/${id}/sync`);
		expect(synced.data.status).toBe("vorschlag");
		const drafts = synced.data.external?.drafts ?? [];
		expect(drafts.map((d) => d.name)).toEqual([
			"knapp",
			"ausführlich",
			"mutig",
		]);
		expect(synced.data.related[0].external?.drafts).toHaveLength(3);

		expect(
			(await call("POST", `requests/${id}/followup`, { text: "x" })).status,
		).toBe(409);
		expect((await call("POST", `requests/${id}/publish`)).status).toBe(409);
		expect(
			(await call("POST", `requests/${id}/choose`, { branch: "gibt-es-nicht" }))
				.status,
		).toBe(409);

		const chosen = await call("POST", `requests/${id}/choose`, {
			branch: drafts[2].branch,
		});
		expect(chosen.status).toBe(200);
		expect(chosen.data.external?.chosen).toBe(drafts[2].branch);
		expect(chosen.data.external?.drafts).toBeUndefined();
		expect(chosen.data.related[0].external?.chosen).toBe(drafts[2].branch);
		expect(chosen.data.events.at(-1)?.text).toBe("Entwurf „mutig“ gewählt");

		const usage = await call<UsageSummary>("GET", "usage");
		expect(usage.data.engines.find((e) => e.id === "claude")?.today).toBe(3);

		expect((await call("POST", `requests/${id}/publish`)).status).toBe(200);
	});

	it("bleibt bei einer einzigen Richtung ein normaler Vorschlag", async () => {
		const { call, collect } = setup();
		const r = (await collect("hero", "Ruhiger")).data;
		const sent = await call("POST", `requests/${r.id}/send`, {
			drafts: ["knapp"],
		});
		expect(sent.data.drafts).toBeUndefined();
		const synced = await call("POST", `requests/${r.id}/sync`);
		expect(synced.data.external?.drafts).toBeUndefined();
		expect(synced.data.external?.previewUrl).toBeTruthy();
	});
});
