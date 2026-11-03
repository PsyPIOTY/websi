import { describe, expect, it } from "vitest";
import {
	GitHubClaudeAdapter,
	pickPreviewUrl,
} from "../core/agent/githubClaude";
import { createRequest } from "../core/requests";
import { humansource } from "../sites/humansource";

type Call = { url: string; method: string; body?: unknown };

function fakeGitHub(routes: Record<string, unknown>) {
	const calls: Call[] = [];
	const fetcher = async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		calls.push({
			url,
			method,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		const key = `${method} ${url.replace("https://api.github.com", "").split("?")[0]}`;
		if (!(key in routes))
			return new Response("nicht gefunden", { status: 404 });
		return new Response(JSON.stringify(routes[key]), { status: 200 });
	};
	return { calls, fetcher };
}

const ctx = {
	site: humansource,
	section: humansource.sections[1],
	pageUrl: "https://humansource.peter-jarek.workers.dev/",
};
const repo = "/repos/PsyPIOTY/psychologe-konzeptstudio";

describe("Claude über GitHub", () => {
	it("legt den Auftrag als Issue mit Label und @claude an", async () => {
		const gh = fakeGitHub({
			[`POST ${repo}/issues`]: {
				number: 42,
				html_url: "https://github.com/x/42",
			},
		});
		const adapter = new GitHubClaudeAdapter("t", gh.fetcher);
		const r = createRequest(
			{
				siteId: "humansource",
				sectionId: "situation",
				text: "Frage kürzer",
				pagePath: "/",
				pin: { x: 10, y: 20, hint: "Woran" },
			},
			"r1",
			"2026-10-21T20:00:00Z",
		);
		const job = {
			site: ctx.site,
			items: [{ request: r, section: ctx.section, pageUrl: ctx.pageUrl }],
			engine: "claude" as const,
			style: ["Keine Ausrufezeichen"],
		};
		expect(await adapter.dispatch(job)).toEqual({
			id: "42",
			url: "https://github.com/x/42",
		});
		const body = gh.calls[0].body as {
			title: string;
			body: string;
			labels: string[];
		};
		expect(body.labels).toEqual(["websi"]);
		expect(body.body.startsWith("@claude")).toBe(true);
		expect(body.body).toContain("Frage kürzer");
		expect(body.body).toContain("Nicht mergen");
		expect(body.body).toContain('"requestIds":["r1"]');
		expect(body.body).toContain('"engine":"claude"');
		expect(body.body).toContain("**Peters Stil**\n- Keine Ausrufezeichen");
	});

	it("bündelt einen Sammelauftrag in ein Issue, ohne @claude bei anderem Modell", async () => {
		const gh = fakeGitHub({
			[`POST ${repo}/issues`]: {
				number: 43,
				html_url: "https://github.com/x/43",
			},
		});
		const adapter = new GitHubClaudeAdapter("t", gh.fetcher);
		const mk = (id: string, sectionId: string, text: string) =>
			createRequest(
				{ siteId: "humansource", sectionId, text, pagePath: "/" },
				id,
				"2026-10-21T20:00:00Z",
			);
		const s1 = humansource.sections[1];
		const s2 = humansource.sections[2];
		await adapter.dispatch({
			site: humansource,
			items: [
				{
					request: mk("a", s1.id, "Kürzer"),
					section: s1,
					pageUrl: ctx.pageUrl,
				},
				{
					request: mk("b", s2.id, "Neues Bild"),
					section: s2,
					pageUrl: ctx.pageUrl,
				},
			],
			engine: "codex",
			style: [],
		});
		const body = gh.calls[0].body as { title: string; body: string };
		expect(body.title).toContain("Sammelauftrag: 2 Wünsche");
		expect(body.body.startsWith("@claude")).toBe(false);
		expect(body.body).toContain(`### 1. ${s1.label}`);
		expect(body.body).toContain(`### 2. ${s2.label}`);
		expect(body.body).toContain('"requestIds":["a","b"]');
		expect(body.body).toContain("Modell: Codex");
	});

	it("erkennt Antworten und den Pull Request des Agenten", async () => {
		const gh = fakeGitHub({
			[`GET ${repo}/issues/42/comments`]: [
				{
					html_url: "c1",
					created_at: "t1",
					body: "Ich schaue mir das an",
					user: { login: "claude[bot]", type: "Bot" },
				},
				{
					html_url: "c2",
					created_at: "t2",
					body: "danke",
					user: { login: "PsyPIOTY", type: "User" },
				},
			],
			[`GET ${repo}/pulls`]: [
				{
					number: 7,
					html_url: "https://github.com/x/pull/7",
					state: "open",
					merged_at: null,
					body: "Fixes #42",
					head: { ref: "claude/issue-42-2026" },
				},
			],
		});
		const adapter = new GitHubClaudeAdapter("t", gh.fetcher);
		const r = {
			...createRequest(
				{
					siteId: "humansource",
					sectionId: "situation",
					text: "x",
					pagePath: "/",
				},
				"r1",
				"t",
			),
			status: "in_arbeit" as const,
			external: { adapter: "github-claude", id: "42", url: "" },
		};
		const update = await adapter.sync(r, ctx);
		expect(update.status).toBe("vorschlag");
		expect(update.proposalUrl).toBe("https://github.com/x/pull/7");
		expect(update.messages.map((m) => m.text)).toEqual([
			"Ich schaue mir das an",
		]);
	});

	it("erkennt den eigenen Worker an Branch und Markierung, auch unter Peters Konto", async () => {
		const gh = fakeGitHub({
			[`GET ${repo}/issues/42/comments`]: [
				{
					html_url: "c1",
					created_at: "t1",
					body: '<!-- websi-worker {"engine":"claude","seconds":95,"where":"github","preview":"https://websi-42-humansource.peter-jarek.workers.dev"} -->\n**Vorschlag fertig.** Kürzer.',
					user: { login: "PsyPIOTY", type: "User" },
				},
			],
			[`GET ${repo}/pulls`]: [],
			[`GET ${repo}/branches`]: [{ name: "websi/issue-42-faq" }],
		});
		const adapter = new GitHubClaudeAdapter("t", gh.fetcher);
		const r = {
			...createRequest(
				{
					siteId: "humansource",
					sectionId: "situation",
					text: "x",
					pagePath: "/",
				},
				"r1",
				"t",
			),
			status: "in_arbeit" as const,
			external: { adapter: "github-claude", id: "42", url: "" },
		};
		const update = await adapter.sync(r, ctx);
		expect(update.status).toBe("vorschlag");
		expect(update.branch).toBe("websi/issue-42-faq");
		expect(update.previewUrl).toBe(
			"https://websi-42-humansource.peter-jarek.workers.dev",
		);
		expect(update.messages[0].usage).toEqual({
			engine: "claude",
			seconds: 95,
			where: "github",
		});
		expect(update.messages.map((m) => m.text)).toEqual([
			"**Vorschlag fertig.** Kürzer.",
		]);
	});

	it("veröffentlicht nur per Merge des gefundenen Vorschlags", async () => {
		const gh = fakeGitHub({
			[`GET ${repo}/pulls`]: [],
			[`GET ${repo}/branches`]: [{ name: "claude/issue-42-x" }],
			[`POST ${repo}/pulls`]: {
				number: 8,
				html_url: "https://github.com/x/pull/8",
				state: "open",
				merged_at: null,
				body: "",
				head: { ref: "claude/issue-42-x" },
			},
			[`PUT ${repo}/pulls/8/merge`]: { merged: true },
		});
		const adapter = new GitHubClaudeAdapter("t", gh.fetcher);
		const r = {
			...createRequest(
				{
					siteId: "humansource",
					sectionId: "situation",
					text: "x",
					pagePath: "/",
				},
				"r1",
				"t",
			),
			external: { adapter: "github-claude", id: "42", url: "" },
		};
		expect(await adapter.publish(r, ctx)).toEqual({
			url: "https://github.com/x/pull/8",
		});
		expect(
			gh.calls.map(
				(c) =>
					`${c.method} ${c.url.split("?")[0].replace("https://api.github.com", "")}`,
			),
		).toContain(`PUT ${repo}/pulls/8/merge`);
	});

	it("ist ohne Zugang nicht bereit", () => {
		expect(new GitHubClaudeAdapter(undefined).ready()).toBe(false);
	});
});

describe("Vorschau über Cloudflare Workers Builds", () => {
	const host = new URL(humansource.url).host;

	it("liest die Vorschau-Adresse aus Checks, Branch-Name vor Versionsnummer", async () => {
		const gh = fakeGitHub({
			[`GET ${repo}/issues/50/comments`]: [],
			[`GET ${repo}/pulls`]: [
				{
					number: 9,
					html_url: "https://github.com/x/pull/9",
					state: "open",
					merged_at: null,
					body: "Closes #50",
					head: { ref: "websi/issue-50-faq", sha: "abc123" },
				},
			],
			[`GET ${repo}/commits/abc123/check-runs`]: {
				check_runs: [
					{
						details_url: "https://dash.cloudflare.com/x",
						output: {
							title: "Build erfolgreich",
							summary: `Version: https://1a2b3c4d-${host}\nBranch: https://websi-issue-50-faq-${host}.`,
							text: null,
						},
					},
				],
			},
			[`GET ${repo}/commits/abc123/statuses`]: [],
			[`GET ${repo}/issues/9/comments`]: [
				{
					body: "https://evil.workers.dev",
					html_url: "",
					created_at: "",
					user: null,
				},
			],
		});
		const adapter = new GitHubClaudeAdapter("t", gh.fetcher);
		const r = {
			...createRequest(
				{
					siteId: "humansource",
					sectionId: "situation",
					text: "x",
					pagePath: "/",
				},
				"r1",
				"t",
			),
			status: "in_arbeit" as const,
			external: { adapter: "github-claude", id: "50", url: "" },
		};
		const update = await adapter.sync(r, ctx);
		expect(update.previewUrl).toBe(`https://websi-issue-50-faq-${host}`);
	});

	it("bleibt ohne Vorschau, wenn Cloudflare nichts meldet", () => {
		expect(
			pickPreviewUrl("nichts hier https://example.com", humansource),
		).toBeUndefined();
		expect(pickPreviewUrl(`https://${host}`, humansource)).toBeUndefined();
	});
});

describe("Mehrere Entwürfe über GitHub", () => {
	const draftsMeta = {
		engine: "claude",
		seconds: 300,
		where: "github",
		runs: 3,
		drafts: [
			{
				name: "knapp",
				branch: "websi/issue-60-entwurf-knapp",
				url: "https://github.com/x/pull/11",
				preview: "https://websi-60-1-humansource.peter-jarek.workers.dev",
			},
			{
				name: "mutig",
				branch: "websi/issue-60-entwurf-mutig",
				url: "https://github.com/x/pull/12",
			},
		],
	};
	const base = () => ({
		...createRequest(
			{
				siteId: "humansource",
				sectionId: "situation",
				text: "x",
				pagePath: "/",
			},
			"r1",
			"t",
		),
		status: "in_arbeit" as const,
		drafts: ["knapp", "mutig"],
		external: { adapter: "github-claude", id: "60", url: "" },
	});

	it("meldet die Entwürfe mit Vorschau und zählt jeden Lauf", async () => {
		const gh = fakeGitHub({
			[`GET ${repo}/issues/60/comments`]: [
				{
					html_url: "c1",
					created_at: "t1",
					body: `<!-- websi-worker ${JSON.stringify(draftsMeta)} -->\n**2 Entwürfe fertig.**`,
					user: { login: "github-actions[bot]", type: "Bot" },
				},
			],
			[`GET ${repo}/commits/websi%2Fissue-60-entwurf-mutig/check-runs`]: {
				check_runs: [],
			},
			[`GET ${repo}/commits/websi%2Fissue-60-entwurf-mutig/statuses`]: [],
		});
		const update = await new GitHubClaudeAdapter("t", gh.fetcher).sync(
			base(),
			ctx,
		);
		expect(update.status).toBe("vorschlag");
		expect(update.drafts).toEqual([
			{
				name: "knapp",
				branch: "websi/issue-60-entwurf-knapp",
				proposalUrl: "https://github.com/x/pull/11",
				previewUrl: "https://websi-60-1-humansource.peter-jarek.workers.dev",
			},
			{
				name: "mutig",
				branch: "websi/issue-60-entwurf-mutig",
				proposalUrl: "https://github.com/x/pull/12",
				previewUrl: undefined,
			},
		]);
		expect(update.messages[0].usage?.runs).toBe(3);
	});

	it("schließt bei der Wahl die anderen Entwürfe und löscht ihre Branches", async () => {
		const pull = (number: number, ref: string) => ({
			number,
			html_url: `https://github.com/x/pull/${number}`,
			state: "open",
			merged_at: null,
			body: "",
			head: { ref },
		});
		const gh = fakeGitHub({
			[`GET ${repo}/pulls`]: [
				pull(11, "websi/issue-60-entwurf-knapp"),
				pull(12, "websi/issue-60-entwurf-mutig"),
			],
			[`PATCH ${repo}/pulls/11`]: {},
			[`DELETE ${repo}/git/refs/heads/websi/issue-60-entwurf-knapp`]: {},
			[`POST ${repo}/issues/60/comments`]: {},
		});
		const r = {
			...base(),
			external: {
				...base().external,
				drafts: draftsMeta.drafts.map((d) => ({
					name: d.name,
					branch: d.branch,
					proposalUrl: d.url,
				})),
			},
		};
		await new GitHubClaudeAdapter("t", gh.fetcher).choose(r, ctx, {
			name: "mutig",
			branch: "websi/issue-60-entwurf-mutig",
			proposalUrl: "https://github.com/x/pull/12",
		});
		const calls = gh.calls.map(
			(c) =>
				`${c.method} ${c.url.replace("https://api.github.com", "").split("?")[0]}`,
		);
		expect(calls).toContain(`PATCH ${repo}/pulls/11`);
		expect(calls).not.toContain(`PATCH ${repo}/pulls/12`);
		expect(calls).toContain(
			`DELETE ${repo}/git/refs/heads/websi/issue-60-entwurf-knapp`,
		);
		const comment = gh.calls.find((c) => c.url.endsWith("/issues/60/comments"));
		expect((comment?.body as { body: string }).body).toContain(
			'<!-- websi-worker {"chosen":"websi/issue-60-entwurf-mutig"} -->',
		);
	});
});
