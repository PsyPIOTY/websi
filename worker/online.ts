import {
	type BuildState,
	ONLINE_LABEL,
	type OnlineStatus,
	orderBody,
	readOrder,
	readResult,
	resultText,
	signOrder,
} from "../core/online";
import { RequestError } from "../core/requests";
import type { SiteProfile } from "../core/types";

export interface OnlineEnv {
	GITHUB_TOKEN?: string;
	/** Derselbe Schlüssel wie für Paco; der Mac mini hat ihn im Schlüsselbund „PACO-WEBSI“. */
	MCP_TOKEN?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface GhIssue {
	number: number;
	html_url: string;
	state: "open" | "closed";
	created_at: string;
	body: string | null;
	pull_request?: unknown;
}

interface GhComment {
	body: string;
	created_at: string;
}

const BUILD = "Workers Builds";
/** So viele frühere Aufträge je Seite liest WEBSI höchstens nach. */
const LOOKBACK = 5;

export function createOnline(
	env: OnlineEnv,
	fetcher: FetchLike = (input, init) => fetch(input, init),
	now: () => Date = () => new Date(),
) {
	async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
		const res = await fetcher(`https://api.github.com${path}`, {
			...init,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${env.GITHUB_TOKEN}`,
				"user-agent": "websi",
				"x-github-api-version": "2022-11-28",
				...(init.body ? { "content-type": "application/json" } : {}),
			},
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`GitHub ${res.status} bei ${path}: ${text.slice(0, 200)}`,
			);
		}
		return (await res.json()) as T;
	}

	const repo = (s: SiteProfile) => `/repos/${s.repo.owner}/${s.repo.name}`;

	function setupGap(s: SiteProfile) {
		if (!s.online)
			return "Für diese Website gibt es keinen Knopf „Online stellen“.";
		if (!env.GITHUB_TOKEN) return "WEBSI hat keinen GitHub-Zugang.";
		if (!env.MCP_TOKEN)
			return "Noch nicht eingerichtet: Mac mini und WEBSI brauchen ihren gemeinsamen Schlüssel (gemeinsame Sitzung).";
		return undefined;
	}

	async function stand(s: SiteProfile): Promise<OnlineStatus["stand"]> {
		const head = await gh<{
			sha: string;
			commit: { message: string; committer: { date: string } };
		}>(`${repo(s)}/commits/${s.repo.baseBranch}`);
		// Beide Websites teilen sich die Werkstatt: angezeigt wird die letzte Änderung an
		// dieser Website (Peter 4.11.2026, „da ist noch irgendwas vermischt“), hochgeladen
		// wird immer der neueste Stand von main.
		let eigene = head;
		if (s.repo.path) {
			try {
				const liste = await gh<(typeof head)[]>(
					`${repo(s)}/commits?sha=${s.repo.baseBranch}&path=${encodeURIComponent(s.repo.path)}&per_page=1`,
				);
				if (liste[0]) eigene = liste[0];
			} catch {
				// Ohne Verlauf bleibt die letzte Änderung der Werkstatt stehen.
			}
		}
		let build: BuildState = "unbekannt";
		try {
			const { check_runs } = await gh<{
				check_runs: {
					name: string;
					status: string;
					conclusion: string | null;
				}[];
			}>(`${repo(s)}/commits/${head.sha}/check-runs?per_page=50`);
			const runs = check_runs.filter((r) => r.name.startsWith(BUILD));
			if (runs.length)
				build = runs.some((r) => r.status !== "completed")
					? "laeuft"
					: runs.every((r) => r.conclusion === "success")
						? "fertig"
						: "fehler";
		} catch {
			// Ohne Leserecht auf die Prüfungen bleibt der Bau „unbekannt“; der Mac mini wartet ohnehin.
		}
		return {
			commit: head.sha,
			at: eigene.commit.committer.date,
			message: eigene.commit.message.split("\n")[0].slice(0, 140),
			build,
		};
	}

	async function orders(s: SiteProfile) {
		const list = await gh<GhIssue[]>(
			`${repo(s)}/issues?labels=${ONLINE_LABEL}&state=all&sort=created&direction=desc&per_page=30`,
		);
		return list.filter(
			(i) => !i.pull_request && readOrder(i.body)?.site === s.id,
		);
	}

	async function history(s: SiteProfile, list: GhIssue[]) {
		let last: OnlineStatus["last"] = null;
		let lastOnline: OnlineStatus["lastOnline"] = null;
		for (const issue of list
			.filter((i) => i.state === "closed")
			.slice(0, LOOKBACK)) {
			const comments = await gh<GhComment[]>(
				`${repo(s)}/issues/${issue.number}/comments?per_page=30`,
			);
			const hit = comments
				.map((c) => ({ c, r: readResult(c.body) }))
				.filter((x) => x.r)
				.at(-1);
			if (!hit?.r) continue;
			const at = hit.r.zeit || hit.c.created_at;
			last ??= {
				ok: hit.r.ok,
				at,
				text: resultText(hit.c.body),
				url: issue.html_url,
			};
			if (hit.r.ok) {
				lastOnline = { at, commit: hit.r.commit };
				break;
			}
		}
		return { last, lastOnline };
	}

	async function status(s: SiteProfile): Promise<OnlineStatus> {
		const domain = s.online?.domain ?? "";
		const gap = setupGap(s);
		const empty: OnlineStatus = {
			domain,
			ready: false,
			reason: gap,
			stand: null,
			pending: null,
			last: null,
			lastOnline: null,
		};
		if (!s.online || !env.GITHUB_TOKEN) return empty;
		const [current, list] = await Promise.all([stand(s), orders(s)]);
		const open = list.find((i) => i.state === "open");
		return {
			...empty,
			ready: !gap,
			stand: current,
			pending: open ? { at: open.created_at, url: open.html_url } : null,
			...(await history(s, list)),
		};
	}

	/** Peters Klick: Auftrag an den Mac mini. Liegt schon einer da, kein zweiter. */
	async function start(s: SiteProfile): Promise<OnlineStatus> {
		const gap = setupGap(s);
		if (gap || !s.online || !env.MCP_TOKEN)
			throw new RequestError(gap ?? "Nicht eingerichtet");
		const before = await status(s);
		if (before.pending || !before.stand) return before;
		const zeit = now().toISOString();
		const order = {
			site: s.id,
			commit: before.stand.commit,
			zeit,
			sig: await signOrder(env.MCP_TOKEN, s.id, before.stand.commit, zeit),
		};
		const issue = await gh<GhIssue>(`${repo(s)}/issues`, {
			method: "POST",
			body: JSON.stringify({
				title: `Online stellen: ${s.online.domain}`,
				body: orderBody(
					order,
					s.online.domain,
					`${before.stand.commit.slice(0, 7)} · ${before.stand.message}`,
				),
				labels: [ONLINE_LABEL],
			}),
		});
		return { ...before, pending: { at: zeit, url: issue.html_url } };
	}

	return { status, start };
}
