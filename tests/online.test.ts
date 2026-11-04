import { describe, expect, it } from "vitest";
import {
	type OnlineStatus,
	orderBody,
	readOrder,
	readResult,
	resultText,
	signOrder,
} from "../core/online";
import type { VisibilityReport } from "../core/types";
import { siteProfiles } from "../sites";
import { createApi } from "../worker/api";
import { TOOLS } from "../worker/mcp";
import { createOnline } from "../worker/online";
import { MemoryStore } from "../worker/storage";

const praxis = siteProfiles.find((s) => s.id === "praxis");
const humansource = siteProfiles.find((s) => s.id === "humansource");
if (!humansource) throw new Error("humansource fehlt");
if (!praxis) throw new Error("praxis fehlt");
const REPO = "https://api.github.com/repos/PsyPIOTY/psychologe-konzeptstudio";
const NOW = new Date("2026-11-03T18:00:00.000Z");

const ergebnis = (ok: boolean, zeit: string, text: string) =>
	`${ok ? "✅ Online" : "⚠️ Nicht online gestellt"}: ${text}\n\n<!-- websi-online-ergebnis:${JSON.stringify({ ok, zeit, site: "praxis", commit: "abc1234" })} -->`;

/** GitHub im Speicher: main, Prüfungen, Issues mit Kommentaren. Merkt sich jede Anfrage. */
function github(
	issues: Record<string, unknown>[] = [],
	comments: Record<number, { body: string; created_at: string }[]> = {},
	build = { status: "completed", conclusion: "success" },
) {
	const calls: {
		method: string;
		url: string;
		body?: Record<string, unknown>;
	}[] = [];
	const fetcher = async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ method, url, body });
		const ok = (data: unknown, status = 200) =>
			new Response(JSON.stringify(data), { status });
		if (url === `${REPO}/commits/main`)
			return ok({
				sha: "abc1234def5678",
				commit: {
					message: "Beide Seiten fertig\n\nlanger Text",
					committer: { date: "2026-11-03T17:36:00Z" },
				},
			});
		if (url.startsWith(`${REPO}/commits?sha=main&path=`))
			return ok(
				url.includes("studio%2Fframes")
					? [
							{
								sha: "praxis111",
								commit: {
									message: "Praxis: Foto in der Einleitung",
									committer: { date: "2026-11-03T12:00:00Z" },
								},
							},
						]
					: [],
			);
		if (url.startsWith(`${REPO}/commits/abc1234def5678/check-runs`))
			return ok({
				check_runs: [{ name: "Workers Builds: konzeptstudio", ...build }],
			});
		if (url.startsWith(`${REPO}/issues?labels=online-stellen`))
			return ok(issues);
		const c = url.match(/\/issues\/(\d+)\/comments/);
		if (c) return ok(comments[Number(c[1])] ?? []);
		if (url === `${REPO}/issues` && method === "POST")
			return ok(
				{ number: 99, html_url: "https://github.com/x/issues/99" },
				201,
			);
		return ok({ message: "Not Found" }, 404);
	};
	return { fetcher, calls };
}

const order = (site: string, n: number, state: "open" | "closed") => ({
	number: n,
	html_url: `https://github.com/x/issues/${n}`,
	state,
	created_at: "2026-11-03T17:00:00Z",
	body: `Text\n\n<!-- websi-online:${JSON.stringify({ site, commit: "abc", zeit: "z", sig: "s" })} -->`,
});

describe("Online stellen: Unterschrift und Angaben", () => {
	it("rechnet die Unterschrift wie der Mac mini (KIAPP test_unterschrift_wie_in_websi)", async () => {
		expect(
			await signOrder("k", "praxis", "abc", "2026-11-03T17:00:00.000Z"),
		).toBe("79c1d6180b71c7a2669300ce9aab90b41b26c5d53d0e9725238467d58c1a4bab");
	});

	it("schreibt den Auftrag lesbar und versteckt die Angaben", () => {
		const body = orderBody(
			{ site: "praxis", commit: "abc", zeit: "z", sig: "s" },
			"peterjarek.de",
			"abc · Text",
		);
		expect(body).toContain("peterjarek.de");
		expect(readOrder(body)).toEqual({
			site: "praxis",
			commit: "abc",
			zeit: "z",
			sig: "s",
		});
		expect(readOrder("kein Auftrag")).toBeNull();
	});

	it("liest die Rückmeldung des Mac mini", () => {
		const body = ergebnis(
			false,
			"2026-11-03T18:05:00+01:00",
			"FTP fehlt noch.",
		);
		expect(readResult(body)?.ok).toBe(false);
		expect(resultText(body)).toBe("FTP fehlt noch.");
	});
});

describe("Online stellen: Stand und Auftrag", () => {
	const env = { GITHUB_TOKEN: "gh", MCP_TOKEN: "geheim" };

	it("zeigt die neueste Fassung, aber ohne WEBSI-Schlüssel keinen nutzbaren Knopf", async () => {
		const { fetcher } = github();
		const st = await createOnline(
			{ GITHUB_TOKEN: "gh" },
			fetcher,
			() => NOW,
		).status(praxis);
		expect(st.ready).toBe(false);
		expect(st.reason).toContain("gemeinsamen Schlüssel");
		// Hochgeladen wird main (commit), gezeigt wird die letzte Änderung an dieser Website.
		expect(st.stand).toEqual({
			commit: "abc1234def5678",
			at: "2026-11-03T12:00:00Z",
			message: "Praxis: Foto in der Einleitung",
			build: "fertig",
		});
	});

	it("ohne eigene Änderung bleibt die letzte Änderung der Werkstatt stehen", async () => {
		const { fetcher } = github();
		const st = await createOnline(env, fetcher, () => NOW).status(humansource);
		expect(st.stand?.message).toBe("Beide Seiten fertig");
		expect(st.stand?.commit).toBe("abc1234def5678");
	});

	it("meldet einen offenen Auftrag nur für diese Website", async () => {
		const { fetcher } = github([
			order("humansource", 7, "open"),
			order("praxis", 6, "open"),
		]);
		const st = await createOnline(env, fetcher, () => NOW).status(praxis);
		expect(st.pending?.url).toBe("https://github.com/x/issues/6");
	});

	it("zeigt den letzten Fehler und seit wann die Seite online ist", async () => {
		const { fetcher } = github(
			[order("praxis", 9, "closed"), order("praxis", 8, "closed")],
			{
				9: [
					{
						body: ergebnis(false, "2026-11-03T17:50:00Z", "FTP fehlt noch."),
						created_at: "x",
					},
				],
				8: [
					{
						body: ergebnis(
							true,
							"2026-11-02T10:00:00Z",
							"39 Dateien hochgeladen.",
						),
						created_at: "x",
					},
				],
			},
		);
		const st = await createOnline(env, fetcher, () => NOW).status(praxis);
		expect(st.last).toMatchObject({ ok: false, text: "FTP fehlt noch." });
		expect(st.lastOnline).toEqual({
			at: "2026-11-02T10:00:00Z",
			commit: "abc1234",
		});
	});

	it("legt beim Klick ein unterschriebenes Issue an", async () => {
		const { fetcher, calls } = github();
		const st = await createOnline(env, fetcher, () => NOW).start(praxis);
		const post = calls.find((c) => c.method === "POST");
		expect(post?.body?.labels).toEqual(["online-stellen"]);
		expect(post?.body?.title).toBe("Online stellen: peterjarek.de");
		const meta = readOrder(String(post?.body?.body));
		expect(meta).toMatchObject({
			site: "praxis",
			commit: "abc1234def5678",
			zeit: NOW.toISOString(),
		});
		expect(meta?.sig).toBe(
			await signOrder("geheim", "praxis", "abc1234def5678", NOW.toISOString()),
		);
		expect(st.pending?.url).toBe("https://github.com/x/issues/99");
	});

	it("legt keinen zweiten Auftrag an, solange einer offen ist", async () => {
		const { fetcher, calls } = github([order("praxis", 6, "open")]);
		await createOnline(env, fetcher, () => NOW).start(praxis);
		expect(calls.some((c) => c.method === "POST")).toBe(false);
	});

	it("ohne WEBSI-Schlüssel kein Auftrag", async () => {
		const { fetcher, calls } = github();
		await expect(
			createOnline({ GITHUB_TOKEN: "gh" }, fetcher).start(praxis),
		).rejects.toThrow("gemeinsamen Schlüssel");
		expect(calls).toHaveLength(0);
	});
});

describe("Online stellen: API", () => {
	const scan = async (site: { id: string }): Promise<VisibilityReport> => ({
		siteId: site.id,
		scannedAt: "2026-10-21T21:00:00Z",
		score: 50,
		checks: [],
		keywords: [],
		errors: [],
	});
	const call = async (
		api: ReturnType<typeof createApi>,
		method: string,
		path: string,
	) => {
		const res = await api.handle(
			new Request(`https://websi.test/api/websi/${path}`, { method }),
		);
		if (!res) throw new Error("keine Antwort");
		return { status: res.status, data: (await res.json()) as OnlineStatus };
	};

	it("ohne Einrichtung: Knopf sichtbar, aber nicht nutzbar", async () => {
		const api = createApi({
			store: new MemoryStore(),
			sites: siteProfiles,
			env: {},
			scan,
		});
		const res = await call(api, "GET", "sites/praxis/online");
		expect(res.data).toMatchObject({ domain: "peterjarek.de", ready: false });
		expect((await call(api, "GET", "sites/gibtsnicht/online")).status).toBe(
			404,
		);
	});

	it("GET zeigt den Stand, POST stellt online", async () => {
		const seen: string[] = [];
		const fake = (what: string) => async () => {
			seen.push(what);
			return {
				domain: "peterjarek.de",
				ready: true,
				stand: null,
				pending: null,
				last: null,
				lastOnline: null,
			};
		};
		const api = createApi({
			store: new MemoryStore(),
			sites: siteProfiles,
			env: {},
			scan,
			online: { status: fake("status"), start: fake("start") },
		});
		await call(api, "GET", "sites/humansource/online");
		await call(api, "POST", "sites/praxis/online");
		expect(seen).toEqual(["status", "start"]);
		expect((await call(api, "DELETE", "sites/praxis/online")).status).toBe(404);
	});

	it("Paco und andere MCP-Clients haben kein Werkzeug zum Online stellen", () => {
		expect(TOOLS.some((t) => /online/i.test(t.name))).toBe(false);
		for (const t of TOOLS) {
			const { path } = t.call({ siteId: "praxis", requestId: "r1", text: "x" });
			expect(path).not.toMatch(/online/);
		}
	});
});
