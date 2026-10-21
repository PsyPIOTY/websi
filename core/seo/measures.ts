import type { CheckResult } from "../types";

/** 0–100: gewichteter Anteil bestandener Prüfungen. */
export function scoreOf(checks: CheckResult[]) {
	let total = 0;
	let got = 0;
	for (const c of checks) {
		total += c.impact;
		if (c.level === "ok") got += c.impact;
		else if (c.level === "warnung") got += c.impact * 0.5;
	}
	return total ? Math.round((got / total) * 100) : 0;
}

/** Die wichtigsten offenen Maßnahmen zuerst. */
export function topMeasures(checks: CheckResult[], limit = 3) {
	return checks
		.filter((c) => c.level !== "ok" && c.fix)
		.sort(
			(a, b) =>
				(b.level === "fehler" ? 1 : 0) - (a.level === "fehler" ? 1 : 0) ||
				b.impact - a.impact,
		)
		.slice(0, limit);
}
