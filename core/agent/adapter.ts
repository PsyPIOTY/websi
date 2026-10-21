import type { ChangeRequest, SectionDef, SiteProfile } from "../types";

/** Was ein Ausführer über einen Auftrag zurückmeldet. */
export interface AgentUpdate {
	status: "in_arbeit" | "vorschlag" | "unveraendert";
	/** Neue Antworten des Agenten seit dem letzten Abgleich. */
	messages: { at: string; text: string; url?: string }[];
	proposalUrl?: string;
	branch?: string;
}

export interface DispatchResult {
	id: string;
	url: string;
}

export interface AgentContext {
	site: SiteProfile;
	section: SectionDef;
	/** Absolute Adresse der Seite, auf der der Wunsch entstand. */
	pageUrl: string;
}

/**
 * Die Schnittstelle, hinter der jeder KI-Anbieter steckt.
 * Auftrag rein, Vorschlag raus. Ein neuer Anbieter = eine neue Implementierung.
 */
export interface AgentAdapter {
	readonly id: string;
	readonly label: string;
	/** Ist der Adapter einsatzbereit (Zugangsdaten vorhanden)? */
	ready(): boolean;
	dispatch(request: ChangeRequest, ctx: AgentContext): Promise<DispatchResult>;
	sync(request: ChangeRequest, ctx: AgentContext): Promise<AgentUpdate>;
	/** Nachbessern: weitere Nachricht zum laufenden Auftrag. */
	followUp(
		request: ChangeRequest,
		ctx: AgentContext,
		text: string,
	): Promise<void>;
	/** Vorschlag übernehmen und veröffentlichen. Nur auf Peters Klick. */
	publish(request: ChangeRequest, ctx: AgentContext): Promise<{ url: string }>;
	/** Vorschlag verwerfen (Issue schließen o. Ä.). */
	discard(request: ChangeRequest, ctx: AgentContext): Promise<void>;
}

/** Klartext-Auftrag, wie ihn jeder Ausführer versteht. */
export function briefing(request: ChangeRequest, ctx: AgentContext) {
	const lines = [
		`Änderungswunsch für **${ctx.site.name}**, Abschnitt **${ctx.section.label}**.`,
		"",
		`> ${request.text.split("\n").join("\n> ")}`,
		"",
		"**Kontext**",
		`- Seite: ${ctx.pageUrl}`,
		`- Abschnitt im Code: \`${ctx.section.selector}\``,
	];
	if (ctx.site.repo.path)
		lines.push(`- Wahrscheinlicher Ort im Repo: \`${ctx.site.repo.path}\``);
	if (request.pin) {
		lines.push(
			`- Markierte Stelle: ${Math.round(request.pin.x)} % von links, ${Math.round(request.pin.y)} % von oben im Abschnitt` +
				(request.pin.hint ? ` (bei „${request.pin.hint}“)` : ""),
		);
	}
	if (ctx.site.notes) lines.push(`- Hinweis zur Website: ${ctx.site.notes}`);
	lines.push(
		"",
		"**Regeln**",
		"- Nur diesen Abschnitt ändern, alles andere unverändert lassen.",
		"- Peters Ton und Stil beibehalten. Keine KI-artig aussehenden Bilder.",
		"- Tests, Typprüfung und Barrierefreiheit müssen grün bleiben.",
		"- Ergebnis als Pull Request mit kurzer Beschreibung auf Deutsch. Nicht mergen: Peter veröffentlicht selbst.",
	);
	return lines.join("\n");
}
