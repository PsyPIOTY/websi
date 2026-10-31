/**
 * Mehrere Entwürfe zur Auswahl: Der Worker setzt einen Wunsch in bis zu drei
 * Richtungen um, Peter wählt einen. Kostet je Richtung einen Modell-Lauf.
 */
export const DEFAULT_DRAFTS = ["knapp", "ausführlich", "mutig"];

export interface Draft {
	name: string;
	branch: string;
	proposalUrl: string;
	previewUrl?: string;
}

/** Bis zu drei verschiedene, nicht leere Richtungen; weniger als zwei = ein normaler Vorschlag. */
export function normalizeDrafts(raw: unknown): string[] {
	const list = Array.isArray(raw) ? raw : [];
	const names = [
		...new Set(
			list
				.filter((d): d is string => typeof d === "string")
				.map((d) => d.trim().slice(0, 40))
				.filter(Boolean),
		),
	].slice(0, 3);
	return names.length >= 2 ? names : [];
}
