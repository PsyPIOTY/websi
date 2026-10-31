import type { Draft } from "../drafts";
import { ENGINES, type EngineId } from "../engines";
import type {
	ChangeRequest,
	RunUsage,
	SectionDef,
	SiteProfile,
} from "../types";

/** Was ein Ausführer über einen Auftrag zurückmeldet. */
export interface AgentUpdate {
	status: "in_arbeit" | "vorschlag" | "unveraendert";
	/** Neue Antworten des Agenten seit dem letzten Abgleich. */
	messages: { at: string; text: string; url?: string; usage?: RunUsage }[];
	proposalUrl?: string;
	previewUrl?: string;
	branch?: string;
	/** Mehrere Entwürfe zur Auswahl (noch keiner gewählt). */
	drafts?: Draft[];
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

/** Ein Wunsch innerhalb eines Auftrags, mit seinem Abschnitt. */
export interface JobItem {
	request: ChangeRequest;
	section: SectionDef;
	pageUrl: string;
}

/**
 * Was an den Ausführer geht: ein einzelner Wunsch oder ein Sammelauftrag
 * (mehrere Wünsche, ein Durchgang, ein Vorschlag).
 */
export interface Job {
	site: SiteProfile;
	items: JobItem[];
	engine: EngineId;
	/** Aktive Regeln aus Peters Stil-Gedächtnis. */
	style: string[];
	/** Richtungen für mehrere Entwürfe zur Auswahl; leer = ein Vorschlag. */
	drafts?: string[];
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
	dispatch(job: Job): Promise<DispatchResult>;
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
	/** Einen von mehreren Entwürfen nehmen, die anderen verwerfen. */
	choose(
		request: ChangeRequest,
		ctx: AgentContext,
		draft: Draft,
	): Promise<void>;
}

/** Steuerdaten, die der Worker aus dem Auftrag liest. */
export function jobMeta(job: Job) {
	return {
		siteId: job.site.id,
		engine: job.engine,
		requestIds: job.items.map((i) => i.request.id),
		sections: [...new Set(job.items.map((i) => i.section.id))],
		...(job.drafts?.length ? { drafts: job.drafts } : {}),
	};
}

export function jobTitle(job: Job) {
	if (job.items.length === 1) {
		const { request, section } = job.items[0];
		const short = request.text.replace(/\s+/g, " ").slice(0, 60);
		return `[WEBSI] ${job.site.name} · ${section.label}: ${short}`;
	}
	const labels = [...new Set(job.items.map((i) => i.section.label))];
	return `[WEBSI] ${job.site.name} · Sammelauftrag: ${job.items.length} Wünsche (${labels.slice(0, 3).join(", ")}${labels.length > 3 ? " …" : ""})`;
}

function itemLines(item: JobItem, site: SiteProfile) {
	const { request, section } = item;
	const lines = [
		`> ${request.text.split("\n").join("\n> ")}`,
		"",
		`- Seite: ${item.pageUrl}`,
		`- Abschnitt im Code: \`${section.selector}\``,
	];
	if (site.repo.path)
		lines.push(`- Wahrscheinlicher Ort im Repo: \`${site.repo.path}\``);
	if (request.pin) {
		lines.push(
			`- Markierte Stelle: ${Math.round(request.pin.x)} % von links, ${Math.round(request.pin.y)} % von oben im Abschnitt` +
				(request.pin.hint ? ` (bei „${request.pin.hint}“)` : ""),
		);
	}
	return lines;
}

/** Klartext-Auftrag, wie ihn jeder Ausführer versteht. */
export function briefing(job: Job) {
	const { site, items } = job;
	const engine = ENGINES.find((e) => e.id === job.engine);
	const lines: string[] = [];
	if (items.length === 1) {
		lines.push(
			`Änderungswunsch für **${site.name}**, Abschnitt **${items[0].section.label}**.`,
			"",
			...itemLines(items[0], site),
		);
	} else {
		const sections = new Set(items.map((i) => i.section.id)).size;
		lines.push(
			`Sammelauftrag für **${site.name}**: ${items.length} Wünsche in ${sections} Abschnitt${sections > 1 ? "en" : ""}. Alles in einem Durchgang umsetzen, ein gemeinsamer Vorschlag.`,
		);
		items.forEach((item, i) => {
			lines.push(
				"",
				`### ${i + 1}. ${item.section.label}`,
				"",
				...itemLines(item, site),
			);
		});
	}
	lines.push("");
	if (site.notes) lines.push(`- Hinweis zur Website: ${site.notes}`);
	if (engine) lines.push(`- Modell: ${engine.label} (${engine.account})`);
	if (job.drafts?.length)
		lines.push(
			`- ${job.drafts.length} Entwürfe zur Auswahl: ${job.drafts.join(", ")}. Je Richtung ein eigener Vorschlag, Peter wählt einen.`,
		);
	if (job.style.length) {
		lines.push("", "**Peters Stil**", ...job.style.map((s) => `- ${s}`));
	}
	lines.push(
		"",
		"**Regeln**",
		items.length === 1
			? "- Nur diesen Abschnitt ändern, alles andere unverändert lassen."
			: "- Nur die genannten Abschnitte ändern, alles andere unverändert lassen.",
		"- Peters Ton und Stil beibehalten. Keine KI-artig aussehenden Bilder.",
		"- Tests, Typprüfung und Barrierefreiheit müssen grün bleiben.",
		"- Ergebnis als Pull Request mit kurzer Beschreibung auf Deutsch. Nicht mergen: Peter veröffentlicht selbst.",
	);
	return lines.join("\n");
}
