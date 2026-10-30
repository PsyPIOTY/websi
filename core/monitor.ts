import { parse } from "node-html-parser";
import type { KeywordTarget, Notice, SiteProfile } from "./types";

/**
 * Monatsprüfung: meldet sich nur, wenn etwas zu tun ist (Peters Wahl vom
 * 24.10.2026). Hier steht nur die Logik, Abruf und Speicher stehen in
 * worker/monitor.ts.
 */
export const SCHWELLEN = {
	/** Google: so viele Plätze schlechter als im Vormonat … */
	googlePlaetze: 3,
	/** … oder von der ersten Ergebnisseite (Platz 1–10) gerutscht. */
	googleSeite: 10,
	/** Mit weniger Einblendungen im Monat ist der Platz Zufall. */
	googleMinEinblendungen: 10,
	/** Besucher: mindestens 40 % weniger Aufrufe pro Tag als im Vormonat … */
	besucherRueckgang: 0.4,
	/** … bei mindestens so vielen Aufrufen im Vormonat. */
	besucherMinVormonat: 50,
	/** Für diesen Anteil der Tage eines Monats müssen Zahlen da sein. */
	besucherMinTage: 0.8,
	/** Höchstens so viele Links je Website prüfen. */
	maxLinks: 25,
};

/** Ab diesem Tag hat Search Console den Vormonat vollständig. */
export const PRUEFTAG = 4;

const MONATE = [
	"Januar",
	"Februar",
	"März",
	"April",
	"Mai",
	"Juni",
	"Juli",
	"August",
	"September",
	"Oktober",
	"November",
	"Dezember",
];

export interface Month {
	/** z. B. „2026-10“ */
	key: string;
	label: string;
	/** Erster und letzter Tag, z. B. „2026-10-01“ und „2026-10-31“. */
	start: string;
	end: string;
	days: number;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function month(year: number, index: number): Month {
	const first = new Date(Date.UTC(year, index, 1));
	const last = new Date(Date.UTC(year, index + 1, 0));
	return {
		key: isoDay(first).slice(0, 7),
		label: MONATE[first.getUTCMonth()],
		start: isoDay(first),
		end: isoDay(last),
		days: last.getUTCDate(),
	};
}

/** Der letzte volle Monat und der Monat davor. */
export function lastTwoMonths(now: Date) {
	const y = now.getUTCFullYear();
	const m = now.getUTCMonth();
	return { last: month(y, m - 1), before: month(y, m - 2) };
}

function daysOf(m: Month) {
	const first = Date.parse(m.start);
	return Array.from({ length: m.days }, (_, i) =>
		isoDay(new Date(first + i * 86_400_000)),
	);
}

export interface PageLink {
	url: string;
	text: string;
}

export interface BrokenLink extends PageLink {
	status: number;
}

/** Alle Links einer Seite, ohne Sprungmarken auf derselben Seite, Mail und Telefon. */
export function extractLinks(html: string, pageUrl: string): PageLink[] {
	const page = new URL(pageUrl);
	page.hash = "";
	const found = new Map<string, PageLink>();
	for (const a of parse(html).querySelectorAll("a[href]")) {
		let url: URL;
		try {
			url = new URL(a.getAttribute("href") ?? "", page);
		} catch {
			continue;
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		url.hash = "";
		if (url.href === page.href || found.has(url.href)) continue;
		const text = a.text.replace(/\s+/g, " ").trim().slice(0, 80);
		found.set(url.href, { url: url.href, text: text || url.href });
	}
	return [...found.values()];
}

/**
 * Kaputt heißt: Seite fehlt (404, 410), Serverfehler (5xx) oder keine Antwort
 * (0). 401, 403, 429 und Eigenes wie LinkedIns 999 nicht, damit sperren viele
 * Seiten nur Prüfprogramme aus.
 */
export const isBroken = (status: number) =>
	status === 0 ||
	status === 404 ||
	status === 410 ||
	(status >= 500 && status < 600);

export interface QueryRow {
	query: string;
	position: number;
	impressions: number;
}

export interface RankDrop {
	phrase: string;
	from: number;
	to: number;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Suchbegriffe der Website, bei denen sie bei Google deutlich gefallen ist. */
export function rankDrops(
	keywords: KeywordTarget[],
	before: QueryRow[],
	last: QueryRow[],
): RankDrop[] {
	const row = (rows: QueryRow[], phrase: string) =>
		rows.find(
			(r) =>
				norm(r.query) === norm(phrase) &&
				r.impressions >= SCHWELLEN.googleMinEinblendungen,
		);
	const drops: RankDrop[] = [];
	for (const k of keywords) {
		const b = row(before, k.phrase);
		const l = row(last, k.phrase);
		if (!b || !l) continue;
		const from = Math.round(b.position);
		const to = Math.round(l.position);
		const offPage = from <= SCHWELLEN.googleSeite && to > SCHWELLEN.googleSeite;
		if (to - from >= SCHWELLEN.googlePlaetze || offPage)
			drops.push({ phrase: k.phrase, from, to });
	}
	return drops;
}

export interface VisitDrop {
	/** Aufrufe im Monat, hochgerechnet, falls einzelne Tage fehlen. */
	before: number;
	last: number;
	percent: number;
}

function monthTotal(counts: Record<string, number>, m: Month) {
	const known = daysOf(m).filter((d) => d in counts);
	if (known.length < m.days * SCHWELLEN.besucherMinTage) return null;
	const sum = known.reduce((n, d) => n + counts[d], 0);
	return Math.round((sum / known.length) * m.days);
}

/** Deutlich weniger Aufrufe als im Vormonat? null auch bei zu wenig Zahlen. */
export function visitDrop(
	counts: Record<string, number>,
	before: Month,
	last: Month,
): VisitDrop | null {
	const b = monthTotal(counts, before);
	const l = monthTotal(counts, last);
	if (b === null || l === null || b < SCHWELLEN.besucherMinVormonat)
		return null;
	// Je Tag vergleichen, damit kurze und lange Monate gleich zählen.
	const change = l / last.days / (b / before.days) - 1;
	if (change > -SCHWELLEN.besucherRueckgang) return null;
	return { before: b, last: l, percent: Math.round(-change * 100) };
}

/** Ergebnis einer Prüfung; daraus werden Hinweis und vorbereiteter Auftrag. */
export interface NoticeDraft {
	kind: Notice["kind"];
	key: string;
	title: string;
	detail: string;
	/** Text des vorbereiteten Auftrags. */
	text: string;
}

const KEINE_INHALTE = "Angebote, Preise und Therapie-Aussagen nicht ändern.";
const VORBEREITET = "WEBSI hat einen Auftrag vorbereitet.";

export function linkNotice(
	site: SiteProfile,
	broken: BrokenLink[],
): NoticeDraft | null {
	const n = broken.length;
	if (!n) return null;
	const names = broken.slice(0, 3).map((l) => `„${l.text}“`);
	const list = broken.map(
		(l) =>
			`„${l.text}“ (${l.url}, ${l.status ? `Antwort ${l.status}` : "keine Antwort"})`,
	);
	return {
		kind: "links",
		key: `links:${broken
			.map((l) => l.url)
			.sort()
			.join(" ")}`,
		title: `${site.name}: ${n === 1 ? "ein Link geht ins Leere" : `${n} Links gehen ins Leere`}`,
		detail: `${names.join(", ")}${n > 3 ? " und weitere" : ""}. ${VORBEREITET}`,
		text: `Kaputte Links reparieren: ${list.join("; ")}. Bitte jeweils die richtige Adresse einsetzen oder den Link entfernen. ${KEINE_INHALTE}`,
	};
}

export function googleNotice(
	site: SiteProfile,
	drops: RankDrop[],
	last: Month,
): NoticeDraft | null {
	if (!drops.length) return null;
	const list = drops.map((d) => `„${d.phrase}“: Platz ${d.from} → ${d.to}`);
	const terms =
		drops.length === 1 ? "diesen Suchbegriff" : "diese Suchbegriffe";
	return {
		kind: "google",
		key: `google:${last.key}`,
		title: `${site.name} bei Google gefallen`,
		detail: `${list.join(", ")}. ${VORBEREITET}`,
		text: `Bei Google ist die Seite im ${last.label} gefallen (${list.join("; ")}, Durchschnitt im Monat). Bitte Titel, Beschreibung und Überschriften für ${terms} prüfen und gezielt verbessern. ${KEINE_INHALTE}`,
	};
}

export function visitNotice(
	site: SiteProfile,
	drop: VisitDrop | null,
	before: Month,
	last: Month,
): NoticeDraft | null {
	if (!drop) return null;
	const numbers = `${last.label} rund ${drop.last} Aufrufe, ${before.label} rund ${drop.before} (−${drop.percent} %)`;
	return {
		kind: "besuche",
		key: `besuche:${last.key}`,
		title: `${site.name}: deutlich weniger Besucher`,
		detail: `${numbers}. ${VORBEREITET}`,
		text: `Deutlich weniger Besucher: ${numbers}. Bitte prüfen, ob die Seite überall erreichbar ist und Google sie lesen darf, und die wichtigsten Verbesserungen vorschlagen. ${KEINE_INHALTE}`,
	};
}
