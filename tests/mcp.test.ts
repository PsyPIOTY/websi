import { describe, expect, it } from "vitest";
import type { VisibilityReport } from "../core/types";
import { siteProfiles } from "../sites";
import { createApi } from "../worker/api";
import { handleMcp, TOOLS } from "../worker/mcp";
import { MemoryStore } from "../worker/storage";

function setup() {
	let n = 0;
	const api = createApi({
		store: new MemoryStore(),
		sites: siteProfiles,
		env: { AGENT_MODE: "test" },
		uuid: () => `r${++n}`,
		scan: async (site): Promise<VisibilityReport> => ({
			siteId: site.id,
			scannedAt: "2026-10-21T21:00:00Z",
			score: 50,
			checks: [],
			keywords: [],
			errors: [],
		}),
	});
	let id = 0;
	const rpc = async (method: string, params?: unknown) => {
		const res = await handleMcp(
			new Request("https://websi.test/api/websi/mcp", {
				method: "POST",
				body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
			}),
			api.handle,
		);
		return (await res.json()) as {
			result?: Record<string, unknown> & {
				content?: { text: string }[];
				isError?: boolean;
			};
			error?: { message: string };
		};
	};
	return { rpc };
}

describe("MCP-Brücke", () => {
	it("meldet sich an und listet Werkzeuge, ohne Veröffentlichen", async () => {
		const { rpc } = setup();
		const init = await rpc("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "paco", version: "1" },
		});
		expect(init.result?.serverInfo).toMatchObject({ name: "websi" });
		const tools = await rpc("tools/list");
		const names = (tools.result?.tools as { name: string }[]).map(
			(t) => t.name,
		);
		expect(names).toContain("websi_create_request");
		expect(names).toContain("websi_send_batch");
		expect(names.some((n) => /publish|veroeffentlich|discard/.test(n))).toBe(
			false,
		);
	});

	it("legt Wünsche an, sammelt sie und schickt sie zusammen los", async () => {
		const { rpc } = setup();
		for (const text of ["Ruhiger", "Kürzer"]) {
			const r = await rpc("tools/call", {
				name: "websi_create_request",
				arguments: { siteId: "praxis", sectionId: "hero", text },
			});
			expect(r.result?.isError).toBe(false);
			expect(JSON.parse(r.result?.content?.[0].text ?? "{}").status).toBe(
				"offen",
			);
		}
		const sent = await rpc("tools/call", {
			name: "websi_send_batch",
			arguments: { siteId: "praxis" },
		});
		const list = JSON.parse(sent.result?.content?.[0].text ?? "[]");
		expect(list).toHaveLength(2);
		expect(list[0].status).toBe("in_arbeit");
	});

	it("meldet Fehler sauber zurück", async () => {
		const { rpc } = setup();
		const bad = await rpc("tools/call", {
			name: "websi_site",
			arguments: { siteId: "gibtsnicht" },
		});
		expect(bad.result?.isError).toBe(true);
		expect(
			(await rpc("tools/call", { name: "nope" })).error?.message,
		).toContain("Unbekanntes Werkzeug");
		expect(TOOLS.length).toBeGreaterThanOrEqual(10);
	});
});
