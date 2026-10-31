import { ENGINES } from "./engines";
import type { ChangeRequest } from "./types";

/** Freie Actions-Minuten pro Monat für private Repos (GitHub Free). */
export const FREE_ACTIONS_MINUTES = 2000;

export type Limits = Partial<Record<string, number | null>>;

export const DEFAULT_LIMITS: Limits = { claude: 25, codex: 25, ollama: null };

export interface EngineUsage {
	id: string;
	label: string;
	/** Läufe heute (neuer Auftrag oder Nachbesserung). */
	today: number;
	/** Läufe in den letzten 5 Stunden; Claude-Abos rechnen in solchen Fenstern. */
	last5h: number;
	/** Peters Richtwert pro Tag, null = ohne Grenze. */
	limit: number | null;
	level: "ok" | "knapp" | "erreicht";
}

export interface UsageSummary {
	engines: EngineUsage[];
	github: { minutesMonth: number; free: number; level: EngineUsage["level"] };
}

const levelOf = (used: number, limit: number | null): EngineUsage["level"] =>
	limit === null || limit <= 0
		? "ok"
		: used >= limit
			? "erreicht"
			: used >= limit * 0.8
				? "knapp"
				: "ok";

/**
 * Zählt Läufe je Modell. Das Abo-Kontingent selbst ist nicht abfragbar;
 * WEBSI zählt deshalb, was es losschickt, und vergleicht mit Peters Richtwert.
 */
export function summarizeUsage(
	requests: ChangeRequest[],
	now: Date,
	limits: Limits,
	defaultEngine = "claude",
): UsageSummary {
	const day = now.toISOString().slice(0, 10);
	const month = now.toISOString().slice(0, 7);
	const since5h = now.getTime() - 5 * 3600_000;
	const runs = new Map<string, { engine: string; at: string; n: number }>();
	const minutes = new Map<string, number>();
	for (const r of requests) {
		const group = r.external?.id ?? r.id;
		for (const e of r.events) {
			if (e.kind === "gesendet" || e.kind === "nachbessern") {
				// Mehrere Entwürfe kosten je Richtung einen Lauf.
				runs.set(`${group}|${e.at}|${e.kind}`, {
					engine: r.engine ?? defaultEngine,
					at: e.at,
					n: e.kind === "gesendet" ? r.drafts?.length || 1 : 1,
				});
			}
			if (e.usage?.where === "github" && e.at.startsWith(month)) {
				minutes.set(
					e.url ?? `${group}|${e.at}`,
					Math.ceil(e.usage.seconds / 60),
				);
			}
		}
	}
	const engines = ENGINES.map((info) => {
		const mine = [...runs.values()].filter((x) => x.engine === info.id);
		const count = (list: typeof mine) => list.reduce((a, x) => a + x.n, 0);
		const today = count(mine.filter((x) => x.at.startsWith(day)));
		const limit = limits[info.id] ?? null;
		return {
			id: info.id,
			label: info.label,
			today,
			last5h: count(mine.filter((x) => Date.parse(x.at) >= since5h)),
			limit,
			level: levelOf(today, limit),
		};
	});
	const minutesMonth = [...minutes.values()].reduce((a, b) => a + b, 0);
	return {
		engines,
		github: {
			minutesMonth,
			free: FREE_ACTIONS_MINUTES,
			level: levelOf(minutesMonth, FREE_ACTIONS_MINUTES),
		},
	};
}
