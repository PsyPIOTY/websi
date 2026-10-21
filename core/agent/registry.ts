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
 * Alle bekannten Ausführer. Welche KI arbeitet (Claude, Codex, lokal),
 * entscheidet die Modellwahl pro Auftrag; ausgeführt wird sie vom Worker.
 */
export function listAdapters(env: AgentEnv): AdapterInfo[] {
	const gh = new GitHubClaudeAdapter(env.GITHUB_TOKEN);
	return [
		{ id: gh.id, label: gh.label, ready: gh.ready() },
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
