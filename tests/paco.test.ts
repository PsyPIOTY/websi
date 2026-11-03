import { describe, expect, it } from "vitest";
import { pacoLink } from "../core/paco";
import type { VisibilityReport } from "../core/types";
import { siteProfiles } from "../sites";
import { createApi } from "../worker/api";
import { handleMcp } from "../worker/mcp";
import { markContact } from "../worker/paco";
import { MemoryStore } from "../worker/storage";

const now = new Date("2026-10-31T12:00:00Z");

describe("Verbindung zu Paco", () => {
	it("unterscheidet nicht eingerichtet, wartet, verbunden und getrennt", () => {
		expect(pacoLink(false, null, now).level).toBe("aus");
		expect(pacoLink(true, null, now).level).toBe("wartet");
		expect(
			pacoLink(true, { at: "2026-10-30T12:00:00Z", via: "mcp" }, now).level,
		).toBe("ok");
		const gone = pacoLink(
			true,
			{ at: "2026-10-30T08:00:00Z", via: "mcp" },
			now,
		);
		expect(gone.level).toBe("getrennt");
		expect(gone.text).toBe("Paco hat sich seit 28 Stunden nicht gemeldet");
		expect(
			pacoLink(true, { at: "2026-10-27T12:00:00Z", via: "mcp" }, now).text,
		).toBe("Paco hat sich seit 4 Tagen nicht gemeldet");
	});

	it("merkt sich Lebenszeichen höchstens alle 10 Minuten", async () => {
		const store = new MemoryStore();
		await markContact(store, "mcp", now);
		await markContact(store, "hinweise", new Date("2026-10-31T12:05:00Z"));
		expect(await store.getSetting("paco-kontakt")).toEqual({
			at: now.toISOString(),
			via: "mcp",
		});
		await markContact(store, "hinweise", new Date("2026-10-31T12:11:00Z"));
		expect(await store.getSetting("paco-kontakt")).toMatchObject({
			via: "hinweise",
		});
	});

	it("beantwortet den Verbindungstest über MCP und zeigt den Stand im Status", async () => {
		const store = new MemoryStore();
		const api = createApi({
			store,
			sites: siteProfiles,
			env: { AGENT_MODE: "test" },
			now: () => now,
			pacoConfigured: true,
			scan: async (site): Promise<VisibilityReport> => ({
				siteId: site.id,
				scannedAt: "",
				score: 0,
				checks: [],
				keywords: [],
				errors: [],
			}),
		});
		const status = async () =>
			(await (
				await api.handle(new Request("https://websi.test/api/websi/status"))
			)?.json()) as { paco: { level: string } };
		expect((await status()).paco.level).toBe("wartet");

		await markContact(store, "mcp", now);
		const res = await handleMcp(
			new Request("https://websi.test/api/websi/mcp", {
				method: "POST",
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "websi_verbindungstest", arguments: {} },
				}),
			}),
			api.handle,
		);
		const rpc = (await res.json()) as {
			result: { content: { text: string }[]; isError: boolean };
		};
		expect(rpc.result.isError).toBe(false);
		const body = JSON.parse(rpc.result.content[0].text);
		expect(body).toMatchObject({
			ok: true,
			websi: "erreichbar",
			paco: { level: "ok" },
			kostenwaechter: "im Rahmen",
		});
		expect((await status()).paco.level).toBe("ok");
	});
});
