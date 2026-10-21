import { describe, expect, it } from "vitest";
import { GitHubClaudeAdapter } from "../core/agent/githubClaude";
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
		expect(await adapter.dispatch(r, ctx)).toEqual({
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
		expect(body.body).toContain('"requestId":"r1"');
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
					body: "<!-- websi-worker -->\n**Vorschlag fertig.** Kürzer.",
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
