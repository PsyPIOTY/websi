import type { Draft } from "../drafts";
import { previewKey } from "../preview";
import type { ChangeRequest, SiteProfile } from "../types";
import {
	type AgentAdapter,
	type AgentContext,
	type AgentUpdate,
	briefing,
	type DispatchResult,
	type Job,
	jobMeta,
	jobTitle,
} from "./adapter";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface GhComment {
	html_url: string;
	created_at: string;
	body: string;
	user: { login: string; type: string } | null;
}

interface GhPull {
	number: number;
	html_url: string;
	state: string;
	merged_at: string | null;
	body: string | null;
	head: { ref: string; sha?: string };
}

interface GhCheckRuns {
	check_runs: {
		details_url: string | null;
		output: {
			title: string | null;
			summary: string | null;
			text: string | null;
		};
	}[];
}

/**
 * KI über Peters Abo: Jeder Auftrag wird ein GitHub-Issue im Repo der
 * Website. Der WEBSI-Worker (oder die Claude-Action bzw. Routine) reagiert
 * darauf und legt einen Branch bzw. Pull Request an. WEBSI liest das zurück.
 */
export class GitHubClaudeAdapter implements AgentAdapter {
	readonly id = "github-claude";
	readonly label = "WEBSI-Worker über GitHub";

	constructor(
		private readonly token: string | undefined,
		private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
	) {}

	ready() {
		return Boolean(this.token);
	}

	private async gh<T>(path: string, init: RequestInit = {}): Promise<T> {
		const res = await this.fetcher(`https://api.github.com${path}`, {
			...init,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${this.token}`,
				"user-agent": "websi",
				"x-github-api-version": "2022-11-28",
				...(init.body ? { "content-type": "application/json" } : {}),
				...(init.headers ?? {}),
			},
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`GitHub ${res.status} bei ${path}: ${text.slice(0, 200)}`,
			);
		}
		if (res.status === 204) return undefined as T;
		return (await res.json()) as T;
	}

	private repoPath(ctx: AgentContext) {
		return `/repos/${ctx.site.repo.owner}/${ctx.site.repo.name}`;
	}

	async dispatch(job: Job): Promise<DispatchResult> {
		const body = [
			// Die offizielle Claude-Action reagiert auf @claude, der WEBSI-Worker auf das Label.
			job.engine === "claude" ? "@claude" : "",
			"",
			briefing(job),
			"",
			`<!-- websi:${JSON.stringify(jobMeta(job))} -->`,
		].join("\n");
		const repo = `/repos/${job.site.repo.owner}/${job.site.repo.name}`;
		const issue = await this.gh<{ number: number; html_url: string }>(
			`${repo}/issues`,
			{
				method: "POST",
				body: JSON.stringify({
					title: jobTitle(job),
					body: body.trimStart(),
					labels: [job.site.agent.label],
				}),
			},
		);
		return { id: String(issue.number), url: issue.html_url };
	}

	async sync(request: ChangeRequest, ctx: AgentContext): Promise<AgentUpdate> {
		const n = request.external?.id;
		if (!n) return { status: "unveraendert", messages: [] };
		const repo = this.repoPath(ctx);
		const comments = await this.gh<GhComment[]>(
			`${repo}/issues/${n}/comments?per_page=100`,
		);
		const agentComments = comments.filter((c) => isAgent(c));
		const messages = agentComments.map((c) => {
			const meta = workerMeta(c.body);
			return {
				at: c.created_at,
				text: cleanComment(c.body),
				url: c.html_url,
				usage:
					meta?.engine && typeof meta.seconds === "number"
						? {
								engine: meta.engine,
								seconds: meta.seconds,
								where: meta.where ?? "github",
								...(meta.runs && meta.runs > 1 ? { runs: meta.runs } : {}),
							}
						: undefined,
			};
		});
		const fromWorker = agentComments
			.map((c) => workerMeta(c.body)?.preview)
			.filter(Boolean)
			.at(-1);

		// Mehrere Entwürfe: bis Peter wählt, zählen nur diese.
		const draftMeta = agentComments
			.map((c) => workerMeta(c.body)?.drafts)
			.filter(Boolean)
			.at(-1);
		if (draftMeta?.length && !request.external?.chosen) {
			const drafts: Draft[] = [];
			for (const d of draftMeta)
				drafts.push({
					name: d.name,
					branch: d.branch,
					proposalUrl: d.url,
					previewUrl:
						d.preview ?? (await this.cloudflarePreview(repo, ctx, d.branch)),
				});
			return { status: "vorschlag", messages, drafts };
		}

		const pull = await this.findPull(repo, n, request.external?.chosen);
		if (pull) {
			return {
				status: "vorschlag",
				messages,
				proposalUrl: pull.html_url,
				previewUrl:
					fromWorker ??
					(await this.cloudflarePreview(
						repo,
						ctx,
						pull.head.sha ?? pull.head.ref,
						pull.number,
					)),
				branch: pull.head.ref,
			};
		}
		const branch = await this.findBranch(repo, n);
		if (branch) {
			const base = ctx.site.repo.baseBranch;
			return {
				status: "vorschlag",
				messages,
				branch,
				previewUrl:
					fromWorker ?? (await this.cloudflarePreview(repo, ctx, branch)),
				proposalUrl: `https://github.com/${ctx.site.repo.owner}/${ctx.site.repo.name}/compare/${base}...${branch}`,
			};
		}
		return { status: messages.length ? "in_arbeit" : "unveraendert", messages };
	}

	/**
	 * Vorschau ohne eigenes Token: Ist das Repo in Cloudflare mit „Workers Builds“
	 * verbunden, baut Cloudflare jeden Branch selbst und meldet die Vorschau-Adresse
	 * als Prüfung (Check) am Commit oder als Kommentar am Pull Request. WEBSI sucht
	 * dort nach einer Adresse derselben Website. Fehler hier halten nichts auf.
	 */
	private async cloudflarePreview(
		repo: string,
		ctx: AgentContext,
		ref: string,
		pullNumber?: number,
	) {
		const texts: string[] = [];
		const safe = async <T>(path: string) => {
			try {
				return await this.gh<T>(path);
			} catch {
				return null;
			}
		};
		const checks = await safe<GhCheckRuns>(
			`${repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=50`,
		);
		for (const c of checks?.check_runs ?? []) {
			texts.push(
				c.details_url ?? "",
				c.output.title ?? "",
				c.output.summary ?? "",
				c.output.text ?? "",
			);
		}
		const statuses = await safe<
			{ target_url: string | null; description: string | null }[]
		>(`${repo}/commits/${encodeURIComponent(ref)}/statuses?per_page=50`);
		for (const st of statuses ?? [])
			texts.push(st.target_url ?? "", st.description ?? "");
		if (pullNumber) {
			const prComments = await safe<GhComment[]>(
				`${repo}/issues/${pullNumber}/comments?per_page=100`,
			);
			for (const c of prComments ?? []) texts.push(c.body);
		}
		return pickPreviewUrl(texts.join("\n"), ctx.site);
	}

	private async pulls(repo: string) {
		return this.gh<GhPull[]>(
			`${repo}/pulls?state=all&per_page=50&sort=created&direction=desc`,
		);
	}

	/** Pull Request des Vorschlags; nach einer Entwurfswahl der des gewählten Entwurfs. */
	private async findPull(repo: string, n: string, prefer?: string) {
		const pulls = await this.pulls(repo);
		const ref = new RegExp(`(^|\\D)#${n}(\\D|$)`);
		return (
			(prefer ? pulls.find((p) => p.head.ref === prefer) : undefined) ??
			pulls.find((p) => isProposalBranch(p.head.ref, n)) ??
			pulls.find((p) => p.body !== null && ref.test(p.body))
		);
	}

	private async findBranch(repo: string, n: string) {
		const branches = await this.gh<{ name: string }[]>(
			`${repo}/branches?per_page=100`,
		);
		return branches.find((b) => isProposalBranch(b.name, n))?.name;
	}

	async followUp(request: ChangeRequest, ctx: AgentContext, text: string) {
		const n = request.external?.id;
		if (!n) throw new Error("Auftrag wurde noch nicht gesendet");
		await this.gh(`${this.repoPath(ctx)}/issues/${n}/comments`, {
			method: "POST",
			body: JSON.stringify({
				body:
					(request.engine ?? "claude") === "claude" ? `@claude ${text}` : text,
			}),
		});
	}

	async publish(request: ChangeRequest, ctx: AgentContext) {
		const n = request.external?.id;
		if (!n) throw new Error("Auftrag wurde noch nicht gesendet");
		const repo = this.repoPath(ctx);
		let pull = await this.findPull(repo, n, request.external?.chosen);
		if (!pull) {
			const branch =
				request.external?.branch ?? (await this.findBranch(repo, n));
			if (!branch) throw new Error("Kein Vorschlag gefunden");
			pull = await this.gh<GhPull>(`${repo}/pulls`, {
				method: "POST",
				body: JSON.stringify({
					title: `WEBSI: ${ctx.section.label} (${ctx.site.name})`,
					head: branch,
					base: ctx.site.repo.baseBranch,
					body: `Closes #${n}\n\nVon Peter in WEBSI freigegeben.`,
				}),
			});
		}
		if (!pull.merged_at) {
			await this.gh(`${repo}/pulls/${pull.number}/merge`, {
				method: "PUT",
				body: JSON.stringify({ merge_method: "squash" }),
			});
		}
		return { url: pull.html_url };
	}

	async discard(request: ChangeRequest, ctx: AgentContext) {
		const n = request.external?.id;
		if (!n) return;
		const repo = this.repoPath(ctx);
		// Alle offenen Vorschläge zum Auftrag schließen, auch Entwürfe.
		for (const pull of await this.pulls(repo)) {
			if (pull.state === "open" && isProposalBranch(pull.head.ref, n))
				await this.closePull(repo, pull);
		}
		await this.gh(`${repo}/issues/${n}`, {
			method: "PATCH",
			body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
		});
	}

	private async closePull(repo: string, pull: GhPull) {
		await this.gh(`${repo}/pulls/${pull.number}`, {
			method: "PATCH",
			body: JSON.stringify({ state: "closed" }),
		});
	}

	/**
	 * Entwurf wählen: die anderen Pull Requests schließen und ihre Branches
	 * löschen. Danach gibt es nur noch einen Vorschlag; Nachbessern und
	 * Veröffentlichen laufen wie gewohnt darauf.
	 */
	async choose(request: ChangeRequest, ctx: AgentContext, draft: Draft) {
		const n = request.external?.id;
		if (!n) throw new Error("Auftrag wurde noch nicht gesendet");
		const repo = this.repoPath(ctx);
		const others = (request.external?.drafts ?? []).filter(
			(d) => d.branch !== draft.branch && isProposalBranch(d.branch, n),
		);
		const pulls = await this.pulls(repo);
		for (const d of others) {
			const pull = pulls.find(
				(p) => p.head.ref === d.branch && p.state === "open",
			);
			if (pull) await this.closePull(repo, pull);
			await this.gh(
				`${repo}/git/refs/heads/${d.branch.split("/").map(encodeURIComponent).join("/")}`,
				{ method: "DELETE" },
			).catch(() => {});
		}
		// Mit Worker-Markierung, damit der Worker die Wahl nicht als Nachbesserung liest.
		await this.gh(`${repo}/issues/${n}/comments`, {
			method: "POST",
			body: JSON.stringify({
				body: `<!-- websi-worker ${JSON.stringify({ chosen: draft.branch })} -->\nPeter hat den Entwurf „${draft.name}“ gewählt. Die anderen sind verworfen.`,
			}),
		});
	}
}

/** Branch-Präfixe: eigener WEBSI-Worker sowie Claude-Action und Routine. */
const PROPOSAL_PREFIXES = ["websi/issue-", "claude/issue-"];

function isProposalBranch(name: string, n: string) {
	return PROPOSAL_PREFIXES.some((p) => name.startsWith(`${p}${n}-`));
}

function isAgent(c: GhComment) {
	const login = c.user?.login.toLowerCase() ?? "";
	// Der Worker kommentiert lokal unter Peters Konto, erkennbar an seiner Markierung.
	return (
		c.user?.type === "Bot" ||
		login.includes("claude") ||
		c.body.includes("<!-- websi-worker")
	);
}

/**
 * Sucht in Texten (Checks, Kommentare) die Vorschau-Adresse derselben Website,
 * z. B. https://websi-12-konzeptstudio.x.workers.dev. Eine Adresse mit
 * Branch-Namen (bleibt gleich) geht vor einer mit Versionsnummer (8 Zeichen hex).
 */
export function pickPreviewUrl(text: string, site: SiteProfile) {
	const urls = (
		text.match(/https:\/\/[a-z0-9.-]+\.workers\.dev[^\s"'<>)\]]*/gi) ?? []
	)
		.map((u) => u.replace(/[.,;]+$/, ""))
		.filter((u) => {
			const key = previewKey(site, u);
			return key !== null && key !== site.id;
		});
	const alias = (u: string) => new URL(u).host.split(".")[0];
	const byBranch = urls.filter((u) => !/^[0-9a-f]{8}-/.test(alias(u)));
	return (byBranch.at(-1) ?? urls.at(-1)) || undefined;
}

interface WorkerMeta {
	engine?: string;
	seconds?: number;
	where?: string;
	preview?: string;
	runs?: number;
	drafts?: { name: string; branch: string; url: string; preview?: string }[];
}

/** Liest die Steuerdaten aus einem Worker-Kommentar: <!-- websi-worker {...} -->. */
export function workerMeta(body: string): WorkerMeta | null {
	const m = body.match(/<!-- websi-worker (\{.*?\}) -->/);
	if (!m) return null;
	try {
		const data = JSON.parse(m[1]) as WorkerMeta;
		if (data.preview && !/^https:\/\//.test(data.preview))
			data.preview = undefined;
		if (data.drafts !== undefined) {
			data.drafts = Array.isArray(data.drafts)
				? data.drafts
						.filter(
							(d) =>
								d &&
								typeof d.name === "string" &&
								typeof d.branch === "string" &&
								typeof d.url === "string" &&
								/^https:\/\//.test(d.url),
						)
						.map((d) => ({
							name: d.name.slice(0, 40),
							branch: d.branch,
							url: d.url,
							preview:
								typeof d.preview === "string" && /^https:\/\//.test(d.preview)
									? d.preview
									: undefined,
						}))
				: undefined;
		}
		return data;
	} catch {
		return null;
	}
}

/** Entfernt Steuerzeilen der Action, damit im Editor nur die Antwort steht. */
export function cleanComment(body: string) {
	return body
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^---$[\s\S]*$/m, "")
		.replace(/\[View job run\]\([^)]*\)/g, "")
		.trim()
		.slice(0, 2000);
}
