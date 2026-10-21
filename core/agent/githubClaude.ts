import type { ChangeRequest } from "../types";
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
	head: { ref: string };
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
							}
						: undefined,
			};
		});
		const previewUrl = agentComments
			.map((c) => workerMeta(c.body)?.preview)
			.filter(Boolean)
			.at(-1);

		const pull = await this.findPull(repo, n);
		if (pull) {
			return {
				status: "vorschlag",
				messages,
				proposalUrl: pull.html_url,
				previewUrl,
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
				previewUrl,
				proposalUrl: `https://github.com/${ctx.site.repo.owner}/${ctx.site.repo.name}/compare/${base}...${branch}`,
			};
		}
		return { status: messages.length ? "in_arbeit" : "unveraendert", messages };
	}

	private async findPull(repo: string, n: string) {
		const pulls = await this.gh<GhPull[]>(
			`${repo}/pulls?state=all&per_page=50&sort=created&direction=desc`,
		);
		const ref = new RegExp(`(^|\\D)#${n}(\\D|$)`);
		return (
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
		let pull = await this.findPull(repo, n);
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
		const pull = await this.findPull(repo, n);
		if (pull && pull.state === "open") {
			await this.gh(`${repo}/pulls/${pull.number}`, {
				method: "PATCH",
				body: JSON.stringify({ state: "closed" }),
			});
		}
		await this.gh(`${repo}/issues/${n}`, {
			method: "PATCH",
			body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
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

interface WorkerMeta {
	engine?: string;
	seconds?: number;
	where?: string;
	preview?: string;
}

/** Liest die Steuerdaten aus einem Worker-Kommentar: <!-- websi-worker {...} -->. */
export function workerMeta(body: string): WorkerMeta | null {
	const m = body.match(/<!-- websi-worker (\{.*?\}) -->/);
	if (!m) return null;
	try {
		const data = JSON.parse(m[1]) as WorkerMeta;
		if (data.preview && !/^https:\/\//.test(data.preview))
			data.preview = undefined;
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
