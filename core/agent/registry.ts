import type { AgentAdapter } from "./adapter";
import { GitHubClaudeAdapter } from "./githubClaude";
import { TestModeAdapter } from "./testMode";

export interface AgentEnv {
	GITHUB_TOKEN?: string;
	/** "auto" = echter Adapter, wenn Zugang da ist, sonst Testmodus. "test" erzwingt Testmodus. */
	AGENT_MODE?: string;
}

export interface AdapterInfo {
	id: string;
	label: string;
	ready: boolean;
	planned?: boolean;
}

/**
 * Alle bekannten Ausführer. OpenAI ist als nächster Stecker vorgesehen;
 * er bekommt dieselbe Schnittstelle (z. B. über Codex in GitHub).
 */
export function listAdapters(env: AgentEnv): AdapterInfo[] {
	const gh = new GitHubClaudeAdapter(env.GITHUB_TOKEN);
	return [
		{ id: gh.id, label: gh.label, ready: gh.ready() },
		{
			id: "github-openai",
			label: "OpenAI (Codex über GitHub)",
			ready: false,
			planned: true,
		},
		{ id: "testmodus", label: "Testmodus (ändert nichts)", ready: true },
	];
}

export function resolveAdapter(wanted: string, env: AgentEnv): AgentAdapter {
	if (env.AGENT_MODE !== "test" && wanted === "github-claude") {
		const gh = new GitHubClaudeAdapter(env.GITHUB_TOKEN);
		if (gh.ready()) return gh;
	}
	return new TestModeAdapter();
}

export function adapterById(id: string, env: AgentEnv): AgentAdapter {
	if (id === "github-claude") return new GitHubClaudeAdapter(env.GITHUB_TOKEN);
	return new TestModeAdapter();
}
