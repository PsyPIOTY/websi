/**
 * WEBSI-Worker: arbeitet WEBSI-Aufträge (Issues mit Label "websi") im Repo
 * einer Website ab. Auftrag lesen → Modell ändert die Dateien → Prüfung →
 * Branch, Pull Request und Kommentar. Veröffentlicht wird nie, das macht Peter.
 *
 * Das Modell ist austauschbar (WEBSI_ENGINE):
 *   claude  Claude Code über Peters Abo (Standard, CLAUDE_CODE_OAUTH_TOKEN oder `claude login`)
 *   codex   Codex über ein ChatGPT-Abo (`codex login`)
 *   ollama  lokales Modell, unabhängig von jedem Anbieter
 *
 * Eine Datei, keine Abhängigkeiten, Node 22.18 oder neuer.
 *   node websi-worker.ts                  in GitHub Actions (liest das Ereignis)
 *   node websi-worker.ts --issue 12       einen Auftrag lokal abarbeiten
 *   node websi-worker.ts --poll           alle offenen Aufträge einmal prüfen
 *   node websi-worker.ts --poll --every 10  dauerhaft, alle 10 Minuten
 *   node websi-worker.ts --poll --only ollama  lokal nur Aufträge fürs lokale Modell
 *   node websi-worker.ts --poll --older-than 24  nur Aufträge, die seit 24 Stunden warten
 *   node websi-worker.ts --due --older-than 24   nur zählen, was fällig ist (für GitHub)
 *
 * Das Modell wählt Peter pro Auftrag in WEBSI; es steht in den Steuerdaten des Issues.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

export const MARKER = "<!-- websi-worker -->";
export const LABEL = "websi";
/** Präfixe, unter denen ein Vorschlag zu Issue N liegen kann (eigener Worker, Claude-Action, Routine). */
export const BRANCH_PREFIXES = ["websi/issue-", "claude/issue-"];

export interface GhUser {
	login: string;
	type: string;
}
export interface GhIssue {
	number: number;
	title: string;
	body: string | null;
	state: string;
	labels: { name: string }[];
	pull_request?: unknown;
	created_at?: string;
}
export interface GhComment {
	body: string;
	created_at: string;
	user: GhUser | null;
}

export type Work =
	| { kind: "neu"; followUps: string[] }
	| { kind: "nachbessern"; branch: string; followUps: string[] }
	| { kind: "nichts"; reason: string };

// ---------- reine Logik (getestet) ----------

export function isWorkerComment(c: GhComment) {
	return c.body.includes("<!-- websi-worker");
}

/** Steuerdaten, die WEBSI in den Auftrag schreibt: <!-- websi:{...} -->. */
export function taskMeta(body: string | null): {
	engine?: string;
	requestIds?: string[];
} {
	const all = [...(body ?? "").matchAll(/<!-- websi:(\{.*?\}) -->/g)];
	const last = all.at(-1);
	if (!last) return {};
	try {
		return JSON.parse(last[1]);
	} catch {
		return {};
	}
}

export interface RunMeta {
	engine: string;
	seconds: number;
	where: string;
	preview?: string;
}

/** Markierung für Worker-Kommentare, mit Laufdaten für WEBSI (Kontingent, Vorschau). */
export function marker(meta?: RunMeta) {
	return meta ? `<!-- websi-worker ${JSON.stringify(meta)} -->` : MARKER;
}

/** Vorschau-Name je Auftrag, z. B. websi-12 (gültig für Cloudflare). */
export function previewAlias(n: number) {
	return `websi-${n}`;
}

/** Erste https-Adresse aus der Ausgabe des Vorschau-Befehls. */
export function findPreviewUrl(output: string) {
	const urls = output.match(/https:\/\/[^\s"'<>)]+/g) ?? [];
	return (
		urls.find((u) => u.includes("workers.dev") || u.includes("pages.dev")) ??
		urls[0]
	);
}

/** Peters Nachrichten seit der letzten Antwort des Workers. */
export function pendingFollowUps(comments: GhComment[]) {
	let last = -1;
	comments.forEach((c, i) => {
		if (isWorkerComment(c)) last = i;
	});
	return comments
		.slice(last + 1)
		.filter((c) => c.user?.type !== "Bot")
		.map((c) => stripTask(c.body))
		.filter(Boolean);
}

export function hasWorkerReply(comments: GhComment[]) {
	return comments.some(isWorkerComment);
}

/** Entscheidet, ob und wie ein Issue bearbeitet wird. */
export function decide(
	issue: GhIssue,
	comments: GhComment[],
	branch: string | undefined,
): Work {
	if (issue.state !== "open") return { kind: "nichts", reason: "geschlossen" };
	if (issue.pull_request) return { kind: "nichts", reason: "ist ein PR" };
	if (!issue.labels.some((l) => l.name === LABEL))
		return { kind: "nichts", reason: "kein WEBSI-Auftrag" };
	const followUps = pendingFollowUps(comments);
	if (branch) {
		return followUps.length
			? { kind: "nachbessern", branch, followUps }
			: { kind: "nichts", reason: "Vorschlag liegt schon vor" };
	}
	// Ohne Branch, aber mit Worker-Antwort: letzter Versuch ist gescheitert.
	// Erst ein neuer Kommentar von Peter startet ihn wieder.
	if (hasWorkerReply(comments) && !followUps.length)
		return { kind: "nichts", reason: "wartet auf Peter" };
	return { kind: "neu", followUps };
}

/**
 * Seit wann ein Wunsch auf den Worker wartet: Peters erste Nachricht nach der
 * letzten Antwort des Workers, sonst das Anlegen des Auftrags.
 */
export function waitingSince(issue: GhIssue, comments: GhComment[]) {
	let last = -1;
	comments.forEach((c, i) => {
		if (isWorkerComment(c)) last = i;
	});
	const first = comments
		.slice(last + 1)
		.find((c) => c.user?.type !== "Bot" && stripTask(c.body));
	if (first) return Date.parse(first.created_at);
	return last === -1 ? Date.parse(issue.created_at ?? "") || 0 : Date.now();
}

/** Entfernt Ansprache und Steuerdaten aus Issue- und Kommentartexten. */
export function stripTask(text: string) {
	return text
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^\s*@claude\b[ \t]*/gm, "")
		.trim();
}

export function slug(text: string) {
	return (
		text
			.replace(/^\[WEBSI\]\s*/i, "")
			.toLowerCase()
			.replace(/ä/g, "ae")
			.replace(/ö/g, "oe")
			.replace(/ü/g, "ue")
			.replace(/ß/g, "ss")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40)
			.replace(/-+$/, "") || "auftrag"
	);
}

export function branchFor(issue: GhIssue) {
	return `websi/issue-${issue.number}-${slug(issue.title)}`;
}

export function findBranch(names: string[], n: number) {
	return names.find((name) =>
		BRANCH_PREFIXES.some((p) => name.startsWith(`${p}${n}-`)),
	);
}

export function buildPrompt(
	issue: GhIssue,
	followUps: string[],
	check: string | null,
) {
	const parts = [
		"Du arbeitest im Repository dieser Website und setzt einen WEBSI-Auftrag von Peter um.",
		"",
		`# Auftrag #${issue.number}: ${issue.title}`,
		"",
		stripTask(issue.body ?? ""),
	];
	if (followUps.length) {
		parts.push(
			"",
			"# Nachbesserung von Peter (hat Vorrang)",
			...followUps.map((f) => `- ${f.replace(/\n/g, "\n  ")}`),
		);
	}
	parts.push(
		"",
		"# Arbeitsweise",
		"- Ändere die Dateien direkt. Kein git commit, kein push, kein Pull Request: das übernimmt der Worker.",
		check
			? `- Danach muss \`${check}\` fehlerfrei durchlaufen.`
			: "- Halte den Code lauffähig.",
		"- Antworte zum Schluss mit 2–4 Sätzen auf Deutsch, was du geändert hast.",
	);
	return parts.join("\n");
}

/** Suchbegriffe aus dem Abschnitts-Selektor, z. B. `[data-anchor-id="faq"]` → faq. */
export function selectorTokens(body: string) {
	const sel = body.match(/Abschnitt im Code:\s*`([^`]+)`/)?.[1] ?? "";
	const tokens = new Set<string>();
	for (const m of sel.matchAll(/="([^"]+)"|[#.]([\w-]+)/g)) {
		const t = m[1] ?? m[2];
		if (t && t.length >= 3) tokens.add(t);
	}
	const path = body.match(/Wahrscheinlicher Ort im Repo:\s*`([^`]+)`/)?.[1];
	return { tokens: [...tokens], path };
}

export interface FileBlock {
	path: string;
	content: string;
}

/** Liest die Antwort eines lokalen Modells: ganze Dateien zwischen Markierungen. */
export function parseFileBlocks(text: string) {
	const files: FileBlock[] = [];
	const re = /^=== DATEI: (.+?) ===\r?\n([\s\S]*?)^=== ENDE ===/gm;
	for (const m of text.matchAll(re)) {
		files.push({ path: m[1].trim(), content: m[2] });
	}
	const summary =
		text.match(/ZUSAMMENFASSUNG:\s*([\s\S]+)$/)?.[1].trim() ??
		"Änderung vorgenommen.";
	return { files, summary };
}

/** Nur Dateien, die dem Modell gezeigt wurden, dürfen überschrieben werden. */
export function safeBlocks(files: FileBlock[], allowed: string[]) {
	const ok = new Set(allowed.map((p) => normalize(p)));
	return files.filter((f) => ok.has(normalize(f.path)));
}

export function tail(text: string, max = 3000) {
	return text.length > max ? `…${text.slice(-max)}` : text;
}

// ---------- Modelle ----------

export interface EngineRun {
	prompt: string;
	cwd: string;
	issue: GhIssue;
}

export interface Engine {
	id: string;
	run(job: EngineRun): Promise<string>;
}

const MINUTES = 60_000;

function cli(cmd: string, args: string[], cwd: string) {
	const res = spawnSync(cmd, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		timeout: 40 * MINUTES,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (res.error) throw new Error(`${cmd} nicht startbar: ${res.error.message}`);
	if (res.status !== 0)
		throw new Error(
			`${cmd} endete mit ${res.status}: ${tail(res.stderr, 800)}`,
		);
	return res.stdout.trim();
}

export const engines: Record<string, (model?: string) => Engine> = {
	claude: (model) => ({
		id: "claude",
		async run({ prompt, cwd }) {
			const args = [
				"-p",
				prompt,
				"--permission-mode",
				"acceptEdits",
				"--allowedTools",
				"Read Edit Write Glob Grep Bash(npm *) Bash(npx *) Bash(node *)",
				"--output-format",
				"text",
			];
			if (model) args.push("--model", model);
			return cli("claude", args, cwd);
		},
	}),
	codex: (model) => ({
		id: "codex",
		async run({ prompt, cwd }) {
			const dir = mkdtempSync(join(tmpdir(), "websi-"));
			const out = join(dir, "antwort.txt");
			try {
				const args = ["exec", "--full-auto", "--output-last-message", out];
				if (model) args.push("--model", model);
				const stdout = cli("codex", [...args, prompt], cwd);
				return readText(out) || tail(stdout, 1500);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	}),
	ollama: (model = "qwen2.5-coder:14b") => ({
		id: "ollama",
		async run({ prompt, cwd, issue }) {
			const files = contextFiles(issue.body ?? "", cwd);
			if (!files.length)
				throw new Error("Keine passende Datei zum Abschnitt gefunden.");
			const shown = files
				.map(
					(f) => `=== DATEI: ${f} ===\n${readText(join(cwd, f))}=== ENDE ===`,
				)
				.join("\n\n");
			const ask = [
				prompt,
				"",
				"Hier sind die betroffenen Dateien:",
				"",
				shown,
				"",
				"Gib jede geänderte Datei vollständig zurück, genau in diesem Format:",
				"=== DATEI: <pfad> ===",
				"<kompletter neuer Inhalt>",
				"=== ENDE ===",
				"Danach eine Zeile: ZUSAMMENFASSUNG: <2–4 Sätze auf Deutsch>",
			].join("\n");
			const base = process.env.WEBSI_OLLAMA_URL ?? "http://localhost:11434";
			const res = await fetch(`${base}/api/chat`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model,
					stream: false,
					messages: [{ role: "user", content: ask }],
				}),
				signal: AbortSignal.timeout(40 * MINUTES),
			});
			if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
			const data = (await res.json()) as { message?: { content?: string } };
			const { files: blocks, summary } = parseFileBlocks(
				data.message?.content ?? "",
			);
			const apply = safeBlocks(blocks, files);
			if (!apply.length)
				throw new Error("Das Modell hat keine Datei geliefert.");
			for (const f of apply) writeFileSync(join(cwd, f.path), f.content);
			return summary;
		},
	}),
};

function readText(path: string) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

/** Dateien, in denen der Abschnitt vorkommt (höchstens vier, je bis 60 KB). */
function contextFiles(body: string, cwd: string) {
	const { tokens, path } = selectorTokens(body);
	const found = new Set<string>();
	if (path) found.add(path);
	for (const t of tokens) {
		const res = spawnSync("git", ["grep", "-l", "-F", t], {
			cwd,
			encoding: "utf8",
		});
		for (const f of res.stdout.split("\n").filter(Boolean)) found.add(f);
	}
	return [...found]
		.filter((f) => readText(join(cwd, f)).length > 0)
		.filter((f) => readText(join(cwd, f)).length < 60_000)
		.slice(0, 4);
}

// ---------- GitHub ----------

export class GitHub {
	private readonly token: string;
	readonly repo: string;
	private readonly fetcher: typeof fetch;

	constructor(token: string, repo: string, fetcher: typeof fetch = fetch) {
		this.token = token;
		this.repo = repo;
		this.fetcher = fetcher;
	}

	async call<T>(path: string, init: RequestInit = {}): Promise<T> {
		const res = await this.fetcher(
			`https://api.github.com/repos/${this.repo}${path}`,
			{
				...init,
				headers: {
					accept: "application/vnd.github+json",
					authorization: `Bearer ${this.token}`,
					"user-agent": "websi-worker",
					"x-github-api-version": "2022-11-28",
					...(init.body ? { "content-type": "application/json" } : {}),
				},
			},
		);
		if (!res.ok)
			throw new Error(
				`GitHub ${res.status} bei ${path}: ${(await res.text()).slice(0, 200)}`,
			);
		return (await res.json()) as T;
	}

	issue(n: number) {
		return this.call<GhIssue>(`/issues/${n}`);
	}
	comments(n: number) {
		return this.call<GhComment[]>(`/issues/${n}/comments?per_page=100`);
	}
	openTasks() {
		return this.call<GhIssue[]>(
			`/issues?state=open&labels=${LABEL}&per_page=50`,
		);
	}
	async branchNames() {
		const list = await this.call<{ name: string }[]>("/branches?per_page=100");
		return list.map((b) => b.name);
	}
	async defaultBranch() {
		return (await this.call<{ default_branch: string }>("")).default_branch;
	}
	comment(n: number, body: string, meta?: RunMeta) {
		return this.call(`/issues/${n}/comments`, {
			method: "POST",
			body: JSON.stringify({ body: `${marker(meta)}\n${body}` }),
		});
	}
	async ensurePull(branch: string, base: string, title: string, body: string) {
		const owner = this.repo.split("/")[0];
		const open = await this.call<{ html_url: string }[]>(
			`/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`,
		);
		if (open[0]) return open[0].html_url;
		const pr = await this.call<{ html_url: string }>("/pulls", {
			method: "POST",
			body: JSON.stringify({ title, head: branch, base, body }),
		});
		return pr.html_url;
	}
}

// ---------- Ablauf ----------

function git(args: string[], cwd: string) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function runCheck(cmd: string, cwd: string) {
	const res = spawnSync(cmd, {
		cwd,
		shell: true,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		timeout: 20 * MINUTES,
	});
	return { ok: res.status === 0, output: `${res.stdout}\n${res.stderr}` };
}

function checkCommand(cwd: string): string | null {
	const env = process.env.WEBSI_CHECK;
	if (env === "-") return null;
	if (env) return env;
	try {
		const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
		return pkg.scripts?.test ? "npm test" : null;
	} catch {
		return null;
	}
}

export interface Options {
	gh: GitHub;
	/** Festes Modell (Tests) oder Auswahl je Auftrag. */
	engine: Engine | ((id: string) => Engine);
	cwd: string;
	/** "github" oder "lokal": lokale Modelle laufen nur auf dem eigenen Rechner. */
	where?: string;
	/** Nur Aufträge mit diesem Modell abarbeiten (z. B. lokal nur "ollama"). */
	only?: string;
	/** Nur Aufträge, die mindestens so viele Stunden warten (GitHub als Ersatz für den Mac mini). */
	olderThanHours?: number;
	log?: (line: string) => void;
}

/** Prüft ein Issue, ohne etwas zu ändern: Ist es hier und jetzt dran? */
export async function assess(n: number, opts: Options) {
	const { gh } = opts;
	const where = opts.where ?? "lokal";
	const [issue, comments, names] = await Promise.all([
		gh.issue(n),
		gh.comments(n),
		gh.branchNames(),
	]);
	const work = decide(issue, comments, findBranch(names, n));
	const wanted =
		taskMeta(issue.body).engine ?? process.env.WEBSI_ENGINE ?? "claude";
	const skip = (reason: string) => ({
		issue,
		wanted,
		work: { kind: "nichts" as const, reason },
	});
	if (work.kind === "nichts") return skip(work.reason);
	if (opts.only && wanted !== opts.only)
		return skip(`Modell ${wanted}, hier nur ${opts.only}`);
	if (where === "github" && wanted === "ollama")
		return skip("lokales Modell läuft nur auf deinem Rechner");
	if (opts.olderThanHours) {
		const hours = (Date.now() - waitingSince(issue, comments)) / 3_600_000;
		if (hours < opts.olderThanHours)
			return skip(
				`wartet erst ${Math.floor(hours)} Std., hier erst ab ${opts.olderThanHours}`,
			);
	}
	return { issue, wanted, work };
}

/** Bearbeitet ein Issue vollständig. Gibt zurück, was passiert ist. */
export async function handleIssue(n: number, opts: Options) {
	const { gh, cwd } = opts;
	const where = opts.where ?? "lokal";
	const log = opts.log ?? console.log;
	const { issue, wanted, work } = await assess(n, opts);
	if (work.kind === "nichts") {
		log(`#${n}: übersprungen (${work.reason})`);
		return work;
	}
	const engine =
		typeof opts.engine === "function" ? opts.engine(wanted) : opts.engine;

	if (git(["status", "--porcelain"], cwd))
		throw new Error("Arbeitskopie hat ungespeicherte Änderungen.");
	const base = process.env.WEBSI_BASE ?? (await gh.defaultBranch());
	const branch = work.kind === "nachbessern" ? work.branch : branchFor(issue);
	const from = work.kind === "nachbessern" ? branch : base;
	git(["fetch", "origin", from], cwd);
	git(["checkout", "-B", branch, `origin/${from}`], cwd);
	log(`#${n}: ${work.kind} auf ${branch} mit ${engine.id}`);

	const started = Date.now();
	const meta = (preview?: string): RunMeta => ({
		engine: engine.id,
		seconds: Math.round((Date.now() - started) / 1000),
		where,
		...(preview ? { preview } : {}),
	});
	const check = checkCommand(cwd);
	try {
		let summary = await engine.run({
			prompt: buildPrompt(issue, work.followUps, check),
			cwd,
			issue,
		});
		if (!git(["status", "--porcelain"], cwd)) {
			await gh.comment(
				n,
				`**Keine Änderung nötig oder möglich.**\n\n${summary}\n\nSchreib hier eine Präzisierung, dann versuche ich es erneut.`,
				meta(),
			);
			return { kind: "ohne-aenderung" as const };
		}
		if (check) {
			let result = runCheck(check, cwd);
			if (!result.ok) {
				log(`#${n}: Prüfung rot, zweiter Versuch`);
				summary = await engine.run({
					prompt: `Die Prüfung \`${check}\` schlägt nach deiner Änderung fehl:\n\n${tail(result.output)}\n\nBehebe das, ohne den Auftrag zu verlassen. Antworte danach mit 2–4 Sätzen auf Deutsch.`,
					cwd,
					issue,
				});
				result = runCheck(check, cwd);
			}
			if (!result.ok) {
				await gh.comment(
					n,
					`**Kein Vorschlag:** \`${check}\` bleibt rot. Nichts wurde hochgeladen.\n\n\`\`\`\n${tail(result.output, 1500)}\n\`\`\`\n\nSchreib hier, wie es weitergehen soll, dann versuche ich es erneut.`,
					meta(),
				);
				git(["reset", "--hard"], cwd);
				git(["clean", "-fd"], cwd);
				return { kind: "pruefung-rot" as const };
			}
		}

		git(["add", "-A"], cwd);
		git(
			[
				"-c",
				`user.name=${process.env.WEBSI_GIT_NAME ?? "WEBSI-Worker"}`,
				"-c",
				`user.email=${process.env.WEBSI_GIT_EMAIL ?? "41898282+github-actions[bot]@users.noreply.github.com"}`,
				"commit",
				"-m",
				`WEBSI #${n}: ${issue.title.replace(/^\[WEBSI\]\s*/i, "")}`,
				"-m",
				summary,
			],
			cwd,
		);
		git(["push", "-u", "origin", branch], cwd);
		const preview = buildPreview(n, cwd, log);
		const url = await gh.ensurePull(
			branch,
			base,
			`WEBSI: ${issue.title.replace(/^\[WEBSI\]\s*/i, "")}`,
			`${summary}\n\n${preview ? `Vorschau: ${preview}\n\n` : ""}Closes #${n}\n\nVorschlag vom WEBSI-Worker (${engine.id}). Nicht mergen: Peter veröffentlicht in WEBSI.`,
		);
		await gh.comment(
			n,
			`**${work.kind === "nachbessern" ? "Nachgebessert" : "Vorschlag fertig"}.** ${summary}\n\nVorschlag: ${url}${preview ? `\nVorschau: ${preview}` : ""}`,
			meta(preview),
		);
		log(`#${n}: Vorschlag ${url}`);
		return { kind: "vorschlag" as const, url, preview };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await gh
			.comment(
				n,
				`**Abgebrochen:** ${msg}\n\nSchreib hier, dann versuche ich es erneut.`,
				meta(),
			)
			.catch(() => {});
		throw err;
	}
}

/**
 * Optionale Vorschau: WEBSI_PREVIEW_CMD baut eine Testversion der Website,
 * z. B. `npm run build && npx wrangler versions upload --preview-alias {alias}`.
 * Die ausgegebene Adresse landet im Vorschlag. Fehler hier halten nichts auf.
 */
function buildPreview(n: number, cwd: string, log: (line: string) => void) {
	const cmd = process.env.WEBSI_PREVIEW_CMD;
	if (!cmd) return undefined;
	const result = runCheck(cmd.replaceAll("{alias}", previewAlias(n)), cwd);
	const url = result.ok ? findPreviewUrl(result.output) : undefined;
	log(
		url
			? `#${n}: Vorschau ${url}`
			: `#${n}: keine Vorschau (${tail(result.output, 300)})`,
	);
	return url;
}

function arg(name: string) {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}

function repoFromRemote(cwd: string) {
	const url = git(["remote", "get-url", "origin"], cwd);
	return url.match(/github\.com[:/](.+?)(\.git)?$/)?.[1];
}

async function main() {
	const cwd = process.cwd();
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	const repo =
		arg("repo") ?? process.env.GITHUB_REPOSITORY ?? repoFromRemote(cwd);
	if (!token || !repo)
		throw new Error("GITHUB_TOKEN und Repository (--repo owner/name) nötig.");
	const pick = (id: string) => {
		const make = engines[id];
		if (!make) throw new Error(`Unbekanntes Modell: ${id}`);
		// WEBSI_MODEL gilt nur für das Standardmodell dieser Umgebung.
		const model =
			id === (process.env.WEBSI_ENGINE || "claude")
				? process.env.WEBSI_MODEL || undefined
				: undefined;
		return make(model);
	};
	const opts: Options = {
		gh: new GitHub(token, repo),
		engine: pick,
		cwd,
		where: process.env.GITHUB_ACTIONS === "true" ? "github" : "lokal",
		only: arg("only"),
		olderThanHours: Number(arg("older-than") ?? 0) || undefined,
	};

	if (process.argv.includes("--due")) {
		// Nur zählen. In GitHub entscheidet das, ob der teure Teil überhaupt startet.
		let due = 0;
		for (const issue of await opts.gh.openTasks()) {
			const { work } = await assess(issue.number, opts);
			if (work.kind === "nichts")
				console.log(`#${issue.number}: nicht fällig (${work.reason})`);
			else {
				console.log(`#${issue.number}: fällig`);
				due++;
			}
		}
		const out = process.env.GITHUB_OUTPUT;
		if (out) writeFileSync(out, `due=${due}\n`, { flag: "a" });
		return;
	}

	const poll = async () => {
		for (const issue of await opts.gh.openTasks()) {
			await handleIssue(issue.number, opts).catch((e) =>
				console.error(`#${issue.number}: ${e.message}`),
			);
		}
	};

	if (process.argv.includes("--poll")) {
		const every = Number(arg("every") ?? 0);
		await poll();
		while (every > 0) {
			await new Promise((r) => setTimeout(r, every * MINUTES));
			await poll();
		}
		return;
	}
	const single = arg("issue");
	if (single) {
		await handleIssue(Number(single), opts);
		return;
	}
	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath)
		throw new Error("Kein Ereignis: --issue N oder --poll angeben.");
	const event = JSON.parse(readFileSync(eventPath, "utf8"));
	if (!event.issue?.number) throw new Error("Ereignis ohne Issue.");
	await handleIssue(event.issue.number, opts);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	});
}
