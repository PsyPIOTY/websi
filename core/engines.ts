/**
 * Die Modelle, mit denen der WEBSI-Worker einen Auftrag abarbeiten kann.
 * Gewählt wird pro Auftrag; die Ausführung steckt im Worker (runner/).
 */
export type EngineId = "claude" | "codex" | "ollama";

export interface EngineInfo {
	id: EngineId;
	label: string;
	/** Wo der Worker dieses Modell ausführen kann. */
	runsOn: "github+lokal" | "lokal";
	/** Womit es bezahlt wird. */
	account: string;
}

export const ENGINES: EngineInfo[] = [
	{
		id: "claude",
		label: "Claude",
		runsOn: "github+lokal",
		account: "dein Claude-Abo",
	},
	{
		id: "codex",
		label: "Codex (OpenAI)",
		runsOn: "github+lokal",
		account: "ein ChatGPT-Abo",
	},
	{
		id: "ollama",
		label: "Lokales Modell",
		runsOn: "lokal",
		account: "kostenlos, auf deinem Rechner",
	},
];

export const DEFAULT_ENGINE: EngineId = "claude";

export function isEngine(value: unknown): value is EngineId {
	return ENGINES.some((e) => e.id === value);
}

export function engineLabel(id: string | undefined) {
	return ENGINES.find((e) => e.id === id)?.label ?? id ?? "";
}
