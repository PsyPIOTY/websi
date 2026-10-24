/**
 * WEBSI-Kernmodell. Bewusst ohne Abhängigkeiten zu React, Cloudflare oder
 * einem KI-Anbieter, damit andere Systeme (z. B. Paco oder das spätere
 * KI-Betriebssystem) dieselben Typen lesen und schreiben können.
 */

import type { EngineId } from "./engines";

/** Ein Abschnitt einer Website, unter dem Änderungswünsche hängen. */
export interface SectionDef {
	/** Stabile ID, an der Aufträge dauerhaft hängen. */
	id: string;
	label: string;
	/** CSS-Selektor, über den die Bridge den Abschnitt im Live-Bild findet. */
	selector: string;
}

export interface KeywordTarget {
	phrase: string;
	/** Seite, die für diesen Begriff ranken soll (Pfad). */
	page?: string;
}

export interface DirectoryDef {
	id: string;
	name: string;
	url: string;
}

/** Alles, was WEBSI über eine Website wissen muss. Wird beim Wechsel geladen. */
export interface SiteProfile {
	id: string;
	name: string;
	/** Entwurf: Sperren für Google sind gewollt und werden nur als Hinweis gezeigt. */
	stage: "entwurf" | "live";
	/** Öffentliche Adresse der Seite (live oder Entwurf). */
	url: string;
	/** Pfad + Query, die im Editor geöffnet werden. */
	editorPath: string;
	/** Weitere Seiten für den Sichtbarkeits-Check (Pfade). */
	pages: string[];
	repo: { owner: string; name: string; baseBranch: string; path?: string };
	agent: {
		/** ID eines registrierten Agent-Adapters, z. B. "github-claude". */
		adapter: string;
		/** Label, auf das der Agent im Repo reagiert. */
		label: string;
		/** Vorgabe für die Modellwahl, sonst Claude. */
		engine?: EngineId;
	};
	sections: SectionDef[];
	/** Vorbereitung im Live-Bild, z. B. Studio-Bedienelemente ausblenden. */
	preview?: {
		/** Einmal anklicken, sobald vorhanden (z. B. „Reine Ansicht“). */
		click?: string[];
		/** Im Editor ausblenden. */
		hide?: string[];
	};
	seo: {
		/** Zielregion für lokale Suche, z. B. PLZ + Ort. */
		region?: string;
		postalCode?: string;
		keywords: KeywordTarget[];
		/** Erwartete schema.org-Typen, z. B. "LocalBusiness", "ProfessionalService". */
		schemaTypes: string[];
		googleBusinessProfile: boolean;
		/** Quellen der Monatsprüfung; erst eintragen, wenn die Seite online ist. */
		statistik?: {
			/** Cloudflare Web Analytics: Site-Tag des Zählers ohne Cookies. */
			cloudflareSiteTag?: string;
			/** Search-Console-Property, z. B. „sc-domain:peterjarek.de“. */
			searchConsole?: string;
		};
	};
	directories: DirectoryDef[];
	notes?: string;
}

export type RequestStatus =
	| "offen"
	| "in_arbeit"
	| "vorschlag"
	| "veroeffentlicht"
	| "verworfen";

export interface Pin {
	/** Position im Abschnitt in Prozent (0–100). */
	x: number;
	y: number;
	/** Kurzer Text am angeklickten Element, hilft dem Agenten. */
	hint?: string;
}

export interface RequestEvent {
	at: string;
	kind:
		| "erstellt"
		| "gesendet"
		| "antwort"
		| "vorschlag"
		| "nachbessern"
		| "status"
		| "fehler";
	text: string;
	/** Wer: "peter", "websi" oder Adapter-ID. */
	by: string;
	url?: string;
	/** Rechenaufwand eines Worker-Laufs, für die Kontingent-Anzeige. */
	usage?: RunUsage;
}

export interface RunUsage {
	engine: string;
	seconds: number;
	/** "github" (Actions-Minuten) oder "lokal". */
	where: string;
}

/** Ein Auftrag: ein Änderungswunsch zu genau einem Abschnitt. */
export interface ChangeRequest {
	id: string;
	siteId: string;
	sectionId: string;
	text: string;
	pin?: Pin;
	/** Seite im Editor, auf der der Wunsch entstand. */
	pagePath: string;
	/** Gewähltes Modell; leer = Vorgabe der Website. */
	engine?: EngineId;
	/** Gemeinsamer Sammelauftrag: alle Wünsche mit gleicher batchId gehen zusammen. */
	batchId?: string;
	status: RequestStatus;
	createdAt: string;
	updatedAt: string;
	/** Verweis beim Ausführer, z. B. Issue-Nummer. */
	external?: {
		adapter: string;
		id: string;
		url: string;
		proposalUrl?: string;
		/** Vorschau-Adresse des Vorschlags (eigene Testversion der Website). */
		previewUrl?: string;
		branch?: string;
	};
	events: RequestEvent[];
}

export type CheckLevel = "ok" | "warnung" | "fehler";
export type CheckCategory = "Technik" | "Inhalte" | "Lokal" | "KI-Suche";

export interface CheckResult {
	id: string;
	category: CheckCategory;
	level: CheckLevel;
	title: string;
	detail: string;
	/** Was zu tun ist, formuliert als Auftrag an den Agenten. */
	fix?: string;
	/** Gewicht für die Reihenfolge der Maßnahmen (1–5). */
	impact: number;
	page: string;
	/** Abschnitt, an den eine Maßnahme als Auftrag gehen soll. */
	sectionId?: string;
}

export interface VisibilityReport {
	siteId: string;
	scannedAt: string;
	score: number;
	checks: CheckResult[];
	keywords: {
		phrase: string;
		inTitle: boolean;
		inH1: boolean;
		inBody: boolean;
		page: string;
	}[];
	errors: string[];
}

export type DirectoryStatus = "offen" | "beantragt" | "aktiv";

export interface DirectoryEntry {
	siteId: string;
	directoryId: string;
	status: DirectoryStatus;
	note: string;
	updatedAt: string;
}

/** Pseudo-Abschnitt für Wünsche, die die ganze Seite betreffen (Meta, Technik). */
export const WHOLE_PAGE: SectionDef = {
	id: "ganze-seite",
	label: "Ganze Seite",
	selector: "html",
};

/** Eine Regel aus Peters Stil-Gedächtnis. siteId "alle" gilt für jede Website. */
export interface StyleRule {
	id: string;
	siteId: string;
	text: string;
	/** Woher die Regel stammt. */
	source: "peter" | "nachbessern" | "verworfen";
	active: boolean;
	createdAt: string;
}

export const ALL_SITES = "alle";

/** Hinweis der Monatsprüfung. Kommt nur, wenn etwas zu tun ist. */
export interface Notice {
	id: string;
	siteId: string;
	kind: "links" | "google" | "besuche";
	/** Gleiches Problem, gleicher Schlüssel: Was Peter verwirft, kommt nicht wieder. */
	key: string;
	title: string;
	detail: string;
	/** Der vorbereitete Auftrag (gesammelt, noch nicht losgeschickt). */
	requestId: string;
	createdAt: string;
}
