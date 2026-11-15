import { describe, expect, it } from "vitest";
import { type Idea, ideaToWish, validateIdea } from "../core/ideen";
import type { ChangeRequest, VisibilityReport } from "../core/types";
import { siteProfiles } from "../sites";
import { createApi } from "../worker/api";
import { handleMcp } from "../worker/mcp";
import { MemoryStore } from "../worker/storage";

const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function setup() {
	let n = 0;
	const store = new MemoryStore();
	const api = createApi({
		store,
		sites: siteProfiles,
		env: { AGENT_MODE: "test" },
		uuid: () => `id${++n}`,
		scan: async (site): Promise<VisibilityReport> => ({
			siteId: site.id,
			scannedAt: "2026-11-15T21:00:00Z",
			score: 50,
			checks: [],
			keywords: [],
			errors: [],
		}),
	});
	const call = async (method: string, path: string, body?: unknown) =>
		(await api.handle(
			new Request(`https://websi.test/api/websi/${path}`, {
				method,
				headers: body ? { "content-type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined,
			}),
		)) as Response;
	return { store, api, call };
}

describe("Ideen von fremden Websites", () => {
	it("prüft Text, Link und Foto", () => {
		const idee = validateIdea({
			text: "Idee: so ein Menü https://beispiel.example/a.",
		});
		expect(idee.link).toBe("https://beispiel.example/a");
		expect(validateIdea({ bild: PNG }).bild?.type).toBe("image/png");
		expect(() => validateIdea({})).toThrow("ohne Text");
		expect(() =>
			validateIdea({ text: "x", bild: "data:text/html;base64,PGI+" }),
		).toThrow("JPEG, PNG");
		expect(
			validateIdea({
				text: "Idee javascript:alert(1)",
				link: "javascript:alert(1)",
			}).link,
		).toBe(undefined);
	});

	it("legt ab, kommt mit gleicher Quelle nur einmal, zeigt das Foto", async () => {
		const { call } = setup();
		const res = await call("POST", "ideen", {
			text: "Idee https://beispiel.example",
			bild: PNG,
			quelle: "telegram-websi-7.jpg",
		});
		expect(res.status).toBe(201);
		const idee = (await res.json()) as Idea;
		expect(idee).toMatchObject({
			status: "neu",
			bild: "image/png",
			link: "https://beispiel.example/",
		});
		const zweit = await (
			await call("POST", "ideen", {
				text: "anders",
				quelle: "telegram-websi-7.jpg",
			})
		).json();
		expect(zweit).toMatchObject({ id: idee.id, schonDa: true });
		expect(await (await call("GET", "ideen")).json()).toHaveLength(1);
		const bild = await call("GET", `ideen/${idee.id}/bild`);
		expect(bild.headers.get("content-type")).toBe("image/png");
		expect(new Uint8Array(await bild.arrayBuffer()).slice(1, 4)).toEqual(
			new Uint8Array([80, 78, 71]),
		);
	});

	it("wird als gesammelter Wunsch übernommen oder als erledigt weggelegt", async () => {
		const { call, store } = setup();
		const site = siteProfiles[0];
		const idee = (await (
			await call("POST", "ideen", {
				text: "Idee: Termine als Kacheln https://x.example",
			})
		).json()) as Idea;
		const { idea, request } = (await (
			await call("POST", `ideen/${idee.id}/uebernehmen`, { siteId: site.id })
		).json()) as { idea: Idea; request: ChangeRequest };
		expect(idea).toMatchObject({
			status: "uebernommen",
			siteId: site.id,
			requestId: request.id,
		});
		expect(request).toMatchObject({
			siteId: site.id,
			sectionId: "ganze-seite",
			status: "offen",
		});
		expect(request.external).toBeUndefined(); // nur gesammelt, nichts losgeschickt
		expect(request.text).toContain("Nur als Anregung");
		expect((await store.listRequests(site.id)).map((r) => r.id)).toContain(
			request.id,
		);
		expect(
			(
				await call("POST", `ideen/${idee.id}/uebernehmen`, {
					siteId: "gibtsnicht",
				})
			).status,
		).toBe(404);
		await call("POST", `ideen/${idee.id}/erledigt`);
		expect(await (await call("GET", "ideen")).json()).toHaveLength(0);
	});

	it("Wunschtext bleibt unter der Höchstlänge", () => {
		const lang = ideaToWish({
			id: "a",
			text: "x".repeat(4000),
			link: "https://y.example/",
			bild: "image/jpeg",
			status: "neu",
			createdAt: "",
			updatedAt: "",
		});
		expect(lang.length).toBeLessThanOrEqual(4000);
	});

	it("über die MCP-Brücke", async () => {
		const { api } = setup();
		const res = await handleMcp(
			new Request("https://websi.test/api/websi/mcp", {
				method: "POST",
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: {
						name: "websi_idee_ablegen",
						arguments: { text: "Idee https://z.example", quelle: "q1" },
					},
				}),
			}),
			api.handle,
		);
		const out = (await res.json()) as {
			result: { isError: boolean; content: { text: string }[] };
		};
		expect(out.result.isError).toBe(false);
		expect(JSON.parse(out.result.content[0].text)).toMatchObject({
			quelle: "q1",
			status: "neu",
		});
	});
});
