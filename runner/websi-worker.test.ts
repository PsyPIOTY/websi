import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildPrompt,
	decide,
	type Engine,
	findBranch,
	findPreviewUrl,
	type GhComment,
	type GhIssue,
	GitHub,
	handleIssue,
	MARKER,
	parseFileBlocks,
	pendingFollowUps,
	safeBlocks,
	selectorTokens,
	slug,
	taskMeta,
} from "./websi-worker.ts";

const body = [
	"@claude",
	"",
	"Änderungswunsch für **Praxis**, Abschnitt **FAQ**.",
	"",
	"> Bitte die erste Frage kürzer.",
	"",
	'- Abschnitt im Code: `[data-anchor-id="faq"]`',
	"",
	'<!-- websi:{"requestId":"r1"} -->',
].join("\n");

const issue: GhIssue = {
	number: 7,
	title: "[WEBSI] Praxis · FAQ: Bitte die erste Frage kürzer",
	body,
	state: "open",
	labels: [{ name: "websi" }],
};
const peter = { login: "PsyPIOTY", type: "User" };
const bot = { login: "github-actions[bot]", type: "Bot" };
const c = (text: string, user = peter): GhComment => ({
	body: text,
	created_at: "2026-10-21T20:00:00Z",
	user,
});

describe("Entscheidung", () => {
	it("startet einen neuen Auftrag", () => {
		expect(decide(issue, [], undefined)).toEqual({
			kind: "neu",
			followUps: [],
		});
	});

	it("bessert nach, wenn Peter nach dem Vorschlag schreibt", () => {
		const comments = [
			c(`${MARKER}\nVorschlag fertig`, bot),
			c("@claude noch kürzer"),
		];
		expect(decide(issue, comments, "websi/issue-7-x")).toEqual({
			kind: "nachbessern",
			branch: "websi/issue-7-x",
			followUps: ["noch kürzer"],
		});
	});

	it("wartet, wenn der Vorschlag schon da ist", () => {
		const comments = [c(`${MARKER}\nfertig`, peter)];
		expect(decide(issue, comments, "websi/issue-7-x").kind).toBe("nichts");
	});

	it("versucht einen gescheiterten Auftrag erst nach Peters Antwort erneut", () => {
		const failed = [c(`${MARKER}\nAbgebrochen`, bot)];
		expect(decide(issue, failed, undefined).kind).toBe("nichts");
		expect(decide(issue, [...failed, c("bitte nochmal")], undefined)).toEqual({
			kind: "neu",
			followUps: ["bitte nochmal"],
		});
	});

	it("ignoriert fremde und geschlossene Issues", () => {
		expect(decide({ ...issue, labels: [] }, [], undefined).kind).toBe("nichts");
		expect(decide({ ...issue, state: "closed" }, [], undefined).kind).toBe(
			"nichts",
		);
	});

	it("zählt eigene Kommentare nicht als Nachbesserung, auch unter Peters Konto", () => {
		expect(pendingFollowUps([c("a"), c(`${MARKER} fertig`)])).toEqual([]);
	});
});

describe("Hilfsfunktionen", () => {
	it("baut lesbare Branch-Namen und findet alle Varianten", () => {
		expect(slug(issue.title)).toBe("praxis-faq-bitte-die-erste-frage-kuerzer");
		expect(findBranch(["main", "claude/issue-7-abc"], 7)).toBe(
			"claude/issue-7-abc",
		);
		expect(findBranch(["websi/issue-70-x"], 7)).toBeUndefined();
	});

	it("schreibt einen Auftrag ohne Steuerdaten", () => {
		const prompt = buildPrompt(issue, ["noch kürzer"], "npm test");
		expect(prompt).not.toContain("@claude");
		expect(prompt).not.toContain("websi:");
		expect(prompt).toContain("Nachbesserung von Peter");
		expect(prompt).toContain("`npm test`");
	});

	it("liest Steuerdaten und Vorschau-Adressen", () => {
		expect(
			taskMeta('x\n<!-- websi:{"engine":"codex","requestIds":["a","b"]} -->'),
		).toEqual({ engine: "codex", requestIds: ["a", "b"] });
		expect(taskMeta("ohne")).toEqual({});
		expect(
			findPreviewUrl(
				"See https://dash.cloudflare.com/x\nPreview URL: https://websi-3-praxis.p.workers.dev",
			),
		).toBe("https://websi-3-praxis.p.workers.dev");
	});

	it("liest Suchbegriffe aus dem Selektor", () => {
		expect(selectorTokens(body).tokens).toEqual(["faq"]);
		expect(
			selectorTokens("Abschnitt im Code: `#hsb-situation`").tokens,
		).toEqual(["hsb-situation"]);
	});

	it("übernimmt vom lokalen Modell nur gezeigte Dateien", () => {
		const { files, summary } = parseFileBlocks(
			"=== DATEI: app/page.tsx ===\nneu\n=== ENDE ===\n=== DATEI: ../geheim ===\nx\n=== ENDE ===\nZUSAMMENFASSUNG: Kürzer.",
		);
		expect(summary).toBe("Kürzer.");
		expect(safeBlocks(files, ["app/page.tsx"])).toEqual([
			{ path: "app/page.tsx", content: "neu\n" },
		]);
	});
});

describe("Ablauf mit echtem Git", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	function setup() {
		const root = mkdtempSync(join(tmpdir(), "websi-test-"));
		dirs.push(root);
		const remote = join(root, "remote.git");
		const work = join(root, "work");
		const g = (args: string[], cwd = root) =>
			execFileSync("git", args, { cwd, encoding: "utf8" });
		g(["init", "-q", "--bare", "-b", "main", remote]);
		g(["clone", "-q", remote, work]);
		writeFileSync(join(work, "faq.txt"), "Lange Frage\n");
		g(["add", "."], work);
		g(
			["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start"],
			work,
		);
		g(["push", "-q", "origin", "HEAD:main"], work);
		return { remote, work, g };
	}

	function fakeGitHub() {
		const posted: { path: string; body: Record<string, string> }[] = [];
		const fetcher = (async (url: string, init?: RequestInit) => {
			const path = url.replace(
				"https://api.github.com/repos/PsyPIOTY/site",
				"",
			);
			const method = init?.method ?? "GET";
			const json = (v: unknown) => new Response(JSON.stringify(v));
			if (method === "POST") {
				posted.push({ path, body: JSON.parse(String(init?.body)) });
				return json({ html_url: "https://github.com/PsyPIOTY/site/pull/8" });
			}
			if (path === "/issues/7") return json(issue);
			if (path.startsWith("/issues/7/comments")) return json([]);
			if (path.startsWith("/branches")) return json([{ name: "main" }]);
			if (path.startsWith("/pulls")) return json([]);
			if (path === "") return json({ default_branch: "main" });
			return new Response("?", { status: 404 });
		}) as typeof fetch;
		return { gh: new GitHub("t", "PsyPIOTY/site", fetcher), posted };
	}

	it("ändert, prüft, pusht den Branch und legt Pull Request und Kommentar an", async () => {
		const { remote, work, g } = setup();
		const { gh, posted } = fakeGitHub();
		const engine: Engine = {
			id: "fake",
			async run({ cwd, prompt }) {
				expect(prompt).toContain("erste Frage kürzer");
				writeFileSync(join(cwd, "faq.txt"), "Kurze Frage\n");
				return "Die erste Frage ist jetzt kürzer.";
			},
		};
		process.env.WEBSI_CHECK = "grep -q Kurze faq.txt";
		const result = await handleIssue(7, {
			gh,
			engine,
			cwd: work,
			log: () => {},
		});
		delete process.env.WEBSI_CHECK;

		expect(result).toEqual({
			kind: "vorschlag",
			url: "https://github.com/PsyPIOTY/site/pull/8",
		});
		const branch = "websi/issue-7-praxis-faq-bitte-die-erste-frage-kuerzer";
		expect(g(["show", `${branch}:faq.txt`], remote)).toBe("Kurze Frage\n");
		expect(g(["show", "main:faq.txt"], remote)).toBe("Lange Frage\n");
		expect(posted[0].path).toBe("/pulls");
		expect(posted[0].body.body).toContain("Closes #7");
		expect(posted[1].path).toBe("/issues/7/comments");
		expect(posted[1].body.body).toContain(
			'<!-- websi-worker {"engine":"fake","seconds":0,"where":"lokal"} -->',
		);
	});

	it("lädt nichts hoch, wenn die Prüfung rot bleibt", async () => {
		const { remote, work, g } = setup();
		const { gh, posted } = fakeGitHub();
		let runs = 0;
		const engine: Engine = {
			id: "fake",
			async run({ cwd }) {
				runs++;
				writeFileSync(join(cwd, "faq.txt"), "Kaputt\n");
				return "Versucht.";
			},
		};
		process.env.WEBSI_CHECK = "grep -q Kurze faq.txt";
		const result = await handleIssue(7, {
			gh,
			engine,
			cwd: work,
			log: () => {},
		});
		delete process.env.WEBSI_CHECK;

		expect(result.kind).toBe("pruefung-rot");
		expect(runs).toBe(2);
		expect(g(["branch", "-r"], work)).not.toContain("websi/");
		expect(g(["ls-remote", "--heads", remote])).not.toContain("websi/");
		expect(readFileSync(join(work, "faq.txt"), "utf8")).toBe("Lange Frage\n");
		expect(posted).toHaveLength(1);
		expect(posted[0].body.body).toContain("bleibt rot");
	});

	it("nimmt das Modell aus dem Auftrag, lässt lokale Modelle in GitHub liegen und baut eine Vorschau", async () => {
		const { work } = setup();
		const { gh, posted } = fakeGitHub();
		const withMeta = (engine: string) => {
			issue.body = `${body}\n<!-- websi:{"engine":"${engine}","requestIds":["r1"]} -->`;
		};
		const used: string[] = [];
		const pick = (id: string): Engine => ({
			id,
			async run({ cwd }) {
				used.push(id);
				writeFileSync(join(cwd, "faq.txt"), "Kurze Frage\n");
				return "Kürzer.";
			},
		});
		const original = issue.body;
		try {
			withMeta("ollama");
			const skipped = await handleIssue(7, {
				gh,
				engine: pick,
				cwd: work,
				where: "github",
				log: () => {},
			});
			expect(skipped.kind).toBe("nichts");
			expect(used).toEqual([]);

			withMeta("codex");
			process.env.WEBSI_CHECK = "-";
			process.env.WEBSI_PREVIEW_CMD =
				'echo "Uploaded. Preview: https://{alias}-site.peter.workers.dev"';
			const result = await handleIssue(7, {
				gh,
				engine: pick,
				cwd: work,
				where: "github",
				log: () => {},
			});
			expect(used).toEqual(["codex"]);
			expect(result).toMatchObject({
				kind: "vorschlag",
				preview: "https://websi-7-site.peter.workers.dev",
			});
			const comment = posted.find((p) => p.path === "/issues/7/comments");
			expect(comment?.body.body).toContain('"engine":"codex"');
			expect(comment?.body.body).toContain(
				'"preview":"https://websi-7-site.peter.workers.dev"',
			);
		} finally {
			issue.body = original;
			delete process.env.WEBSI_CHECK;
			delete process.env.WEBSI_PREVIEW_CMD;
		}
	});
});
