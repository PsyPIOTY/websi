import { type HTMLElement, parse } from "node-html-parser";
import type {
	CheckCategory,
	CheckLevel,
	CheckResult,
	SiteProfile,
} from "../types";

export { scoreOf, topMeasures } from "./measures";

type Draft = Omit<CheckResult, "page">;

const check = (
	id: string,
	category: CheckCategory,
	level: CheckLevel,
	title: string,
	detail: string,
	impact: number,
	fix?: string,
	sectionId?: string,
): Draft => ({ id, category, level, title, detail, impact, fix, sectionId });

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function jsonLdTypes(root: HTMLElement): string[] {
	const types: string[] = [];
	const collect = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(collect);
		const obj = node as Record<string, unknown>;
		const t = obj["@type"];
		if (typeof t === "string") types.push(t);
		if (Array.isArray(t))
			types.push(...t.filter((x): x is string => typeof x === "string"));
		if (obj["@graph"]) collect(obj["@graph"]);
	};
	for (const script of root.querySelectorAll(
		'script[type="application/ld+json"]',
	)) {
		try {
			collect(JSON.parse(script.text));
		} catch {
			types.push("(ungültig)");
		}
	}
	return types;
}

/** Sichtbarer Text ohne Skripte, Styles und WEBSI-eigene Elemente. */
export function visibleText(root: HTMLElement) {
	const clone = parse(root.toString());
	for (const el of clone.querySelectorAll(
		"script, style, noscript, template, svg",
	))
		el.remove();
	return clone.text.replace(/\s+/g, " ").trim();
}

export interface PageAnalysis {
	checks: CheckResult[];
	title: string;
	h1: string[];
	text: string;
	description: string;
}

export function analyzePage(
	html: string,
	pageUrl: string,
	site: SiteProfile,
): PageAnalysis {
	const root = parse(html, { comment: false });
	const page = new URL(pageUrl).pathname + new URL(pageUrl).search;
	const out: Draft[] = [];
	const head = root.querySelector("head");

	const title = root.querySelector("title")?.text.trim() ?? "";
	if (!title)
		out.push(
			check(
				"title",
				"Technik",
				"fehler",
				"Seitentitel fehlt",
				"Ohne <title> zeigt Google einen selbst gewählten Text.",
				5,
				"Einen klaren Seitentitel (50–60 Zeichen) mit Hauptbegriff und Ort setzen.",
				"ganze-seite",
			),
		);
	else if (title.length < 30 || title.length > 65)
		out.push(
			check(
				"title",
				"Technik",
				"warnung",
				"Seitentitel ungünstig lang",
				`${title.length} Zeichen: „${title}“. Ideal sind 30–65.`,
				4,
				`Seitentitel auf 50–60 Zeichen bringen, Hauptbegriff nach vorn. Aktuell: „${title}“.`,
				"ganze-seite",
			),
		);
	else
		out.push(
			check(
				"title",
				"Technik",
				"ok",
				"Seitentitel passt",
				`„${title}“ (${title.length} Zeichen)`,
				4,
			),
		);

	const description =
		root
			.querySelector('meta[name="description"]')
			?.getAttribute("content")
			?.trim() ?? "";
	if (!description)
		out.push(
			check(
				"description",
				"Technik",
				"fehler",
				"Beschreibung fehlt",
				"Die Meta-Beschreibung ist der Text unter dem Titel in Google und entscheidet über Klicks.",
				5,
				"Meta-Beschreibung (120–155 Zeichen) mit Nutzen, Ort und Handlungsaufforderung ergänzen.",
				"ganze-seite",
			),
		);
	else if (description.length < 70 || description.length > 160)
		out.push(
			check(
				"description",
				"Technik",
				"warnung",
				"Beschreibung ungünstig lang",
				`${description.length} Zeichen. Ideal sind 120–155.`,
				4,
				`Meta-Beschreibung auf 120–155 Zeichen bringen. Aktuell: „${description}“.`,
				"ganze-seite",
			),
		);
	else
		out.push(
			check(
				"description",
				"Technik",
				"ok",
				"Beschreibung passt",
				`${description.length} Zeichen`,
				4,
			),
		);

	const h1 = root
		.querySelectorAll("h1")
		.map((h) => h.text.replace(/\s+/g, " ").trim());
	if (h1.length === 0)
		out.push(
			check(
				"h1",
				"Inhalte",
				"fehler",
				"Keine Hauptüberschrift",
				"Jede Seite braucht genau eine H1.",
				4,
				"Eine H1 mit dem wichtigsten Suchbegriff setzen.",
				site.sections[0]?.id,
			),
		);
	else if (h1.length > 1)
		out.push(
			check(
				"h1",
				"Inhalte",
				"warnung",
				`${h1.length} Hauptüberschriften`,
				`Gefunden: ${h1.map((h) => `„${h}“`).join(", ")}`,
				2,
				"Nur eine H1 behalten, die übrigen zu H2 machen.",
			),
		);
	else
		out.push(
			check("h1", "Inhalte", "ok", "Eine Hauptüberschrift", `„${h1[0]}“`, 4),
		);

	const lang = root.querySelector("html")?.getAttribute("lang");
	out.push(
		lang
			? check("lang", "Technik", "ok", "Sprache gesetzt", `lang="${lang}"`, 2)
			: check(
					"lang",
					"Technik",
					"warnung",
					"Sprache nicht gesetzt",
					"Ohne lang-Attribut ist unklar, dass die Seite deutsch ist.",
					2,
					'lang="de" am <html>-Element setzen.',
					"ganze-seite",
				),
	);

	const viewport =
		head?.querySelector('meta[name="viewport"]') ??
		root.querySelector('meta[name="viewport"]');
	out.push(
		viewport
			? check(
					"viewport",
					"Technik",
					"ok",
					"Für Handys eingerichtet",
					"Viewport-Angabe vorhanden",
					4,
				)
			: check(
					"viewport",
					"Technik",
					"fehler",
					"Nicht für Handys eingerichtet",
					"Google bewertet die Handy-Ansicht zuerst.",
					5,
					"Viewport-Meta-Tag ergänzen.",
					"ganze-seite",
				),
	);

	const canonical = root
		.querySelector('link[rel="canonical"]')
		?.getAttribute("href");
	out.push(
		canonical
			? check(
					"canonical",
					"Technik",
					"ok",
					"Kanonische Adresse gesetzt",
					canonical,
					2,
				)
			: check(
					"canonical",
					"Technik",
					"warnung",
					"Kanonische Adresse fehlt",
					"Hilft Google, Doppelungen (z. B. mit Parametern) zusammenzufassen.",
					2,
					'<link rel="canonical"> auf die endgültige Domain setzen.',
					"ganze-seite",
				),
	);

	const robots =
		root.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
	if (/noindex/i.test(robots)) {
		out.push(
			site.stage === "entwurf"
				? check(
						"noindex",
						"Technik",
						"warnung",
						"Für Google gesperrt (Entwurf, gewollt)",
						`robots="${robots}". Vor dem Livegang entfernen.`,
						1,
						"noindex beim Livegang entfernen.",
						"ganze-seite",
					)
				: check(
						"noindex",
						"Technik",
						"fehler",
						"Seite ist für Google gesperrt",
						`robots="${robots}"`,
						5,
						"noindex entfernen, damit Google die Seite aufnimmt.",
						"ganze-seite",
					),
		);
	}

	const ogTitle = root.querySelector('meta[property="og:title"]');
	const ogImage = root.querySelector('meta[property="og:image"]');
	out.push(
		ogTitle && ogImage
			? check(
					"og",
					"Technik",
					"ok",
					"Vorschau für Teilen vorhanden",
					"og:title und og:image gesetzt",
					1,
				)
			: check(
					"og",
					"Technik",
					"warnung",
					"Vorschau für Teilen unvollständig",
					"Beim Teilen in WhatsApp, LinkedIn & Co. fehlt Titel oder Bild.",
					1,
					"og:title, og:description und og:image ergänzen (echtes Foto, kein KI-Bild).",
					"ganze-seite",
				),
	);

	const imgs = root.querySelectorAll("img");
	const noAlt = imgs.filter((i) => i.getAttribute("alt") === undefined);
	out.push(
		noAlt.length === 0
			? check(
					"alt",
					"Inhalte",
					"ok",
					"Bilder beschrieben",
					`${imgs.length} Bilder mit alt-Text`,
					2,
				)
			: check(
					"alt",
					"Inhalte",
					"warnung",
					`${noAlt.length} Bilder ohne Beschreibung`,
					"alt-Texte helfen Google-Bildersuche und Screenreadern.",
					2,
					`alt-Texte für ${noAlt.length} Bilder ergänzen.`,
				),
	);

	const text = visibleText(root);
	const words = text ? text.split(" ").length : 0;
	const scripts = root.querySelectorAll("script[src]").length;
	if (words < 60 && scripts > 0) {
		out.push(
			check(
				"words",
				"Inhalte",
				"fehler",
				"Inhalt entsteht erst im Browser",
				`Im ausgelieferten HTML stehen nur ${words} Wörter; der Rest wird per JavaScript gebaut. Google sieht ihn verzögert oder gar nicht, KI-Suchen meist gar nicht.`,
				5,
				"Inhalte serverseitig ausliefern, sodass Texte und Überschriften schon im HTML stehen.",
			),
		);
	} else {
		out.push(
			words >= 400
				? check("words", "Inhalte", "ok", "Genug Text", `${words} Wörter`, 3)
				: check(
						"words",
						"Inhalte",
						words < 150 ? "fehler" : "warnung",
						"Wenig Text",
						`${words} Wörter. Seiten mit unter 400 Wörtern ranken selten oben.`,
						3,
						"Mehr erklärenden Text ergänzen: für wen, wie, was es kostet, wie es abläuft.",
					),
		);
	}

	const host = new URL(pageUrl).host;
	const internal = root.querySelectorAll("a[href]").filter((a) => {
		const href = a.getAttribute("href") ?? "";
		return href.startsWith("/") || href.startsWith("#") || href.includes(host);
	});
	out.push(
		internal.length >= 5
			? check(
					"links",
					"Inhalte",
					"ok",
					"Interne Verlinkung",
					`${internal.length} interne Links`,
					1,
				)
			: check(
					"links",
					"Inhalte",
					"warnung",
					"Kaum interne Links",
					`${internal.length} interne Links`,
					1,
					"Abschnitte und Unterseiten untereinander verlinken.",
				),
	);

	// Lokal
	const lowerText = norm(text);
	if (site.seo.postalCode) {
		const hasPlz = lowerText.includes(site.seo.postalCode);
		out.push(
			hasPlz
				? check(
						"plz",
						"Lokal",
						"ok",
						"Ort auf der Seite",
						`PLZ ${site.seo.postalCode} gefunden`,
						3,
					)
				: check(
						"plz",
						"Lokal",
						"fehler",
						"Ort fehlt im Text",
						`PLZ ${site.seo.postalCode} kommt nicht vor. Google ordnet die Seite dann keinem Ort zu.`,
						4,
						`Adresse mit PLZ ${site.seo.postalCode} sichtbar (Kontakt und Fußzeile) aufnehmen.`,
						site.sections.find((s) => /kontakt|contact/.test(s.id))?.id,
					),
		);
	}
	const tel = root.querySelector('a[href^="tel:"]');
	out.push(
		tel
			? check(
					"tel",
					"Lokal",
					"ok",
					"Telefon anklickbar",
					tel.getAttribute("href") ?? "",
					2,
				)
			: check(
					"tel",
					"Lokal",
					"warnung",
					"Telefon nicht anklickbar",
					"Am Handy sollte ein Tipp genügen, um anzurufen.",
					2,
					"Telefonnummer als tel:-Link einbauen.",
				),
	);
	if (!site.seo.googleBusinessProfile)
		out.push(
			check(
				"gbp",
				"Lokal",
				"fehler",
				"Kein Google-Unternehmensprofil",
				"Ohne Profil erscheint die Seite nicht in Google Maps und im lokalen Kartenblock.",
				5,
				"Google-Unternehmensprofil anlegen (siehe Verzeichnisse).",
			),
		);

	// KI-Suche und strukturierte Daten
	const types = jsonLdTypes(root);
	const missing = site.seo.schemaTypes.filter((t) => !types.includes(t));
	if (types.length === 0)
		out.push(
			check(
				"schema",
				"KI-Suche",
				"fehler",
				"Keine strukturierten Daten",
				"Google und KI-Suchen lesen Name, Adresse, Angebot bevorzugt aus schema.org-Daten.",
				4,
				`JSON-LD mit ${site.seo.schemaTypes.join(", ")} ergänzen (Name, Adresse, Telefon, Angebote).`,
				"ganze-seite",
			),
		);
	else if (missing.length)
		out.push(
			check(
				"schema",
				"KI-Suche",
				"warnung",
				"Strukturierte Daten unvollständig",
				`Gefunden: ${types.join(", ")}. Es fehlt: ${missing.join(", ")}.`,
				3,
				`JSON-LD um ${missing.join(", ")} ergänzen.`,
				"ganze-seite",
			),
		);
	else
		out.push(
			check(
				"schema",
				"KI-Suche",
				"ok",
				"Strukturierte Daten vorhanden",
				types.join(", "),
				4,
			),
		);

	const hasFaq = types.includes("FAQPage");
	const faqSection = site.sections.find((s) => /faq|fragen/.test(s.id));
	if (faqSection)
		out.push(
			hasFaq
				? check(
						"faq-schema",
						"KI-Suche",
						"ok",
						"FAQ ausgezeichnet",
						"FAQPage vorhanden",
						2,
					)
				: check(
						"faq-schema",
						"KI-Suche",
						"warnung",
						"FAQ nicht ausgezeichnet",
						"Fragen und Antworten werden gern direkt in Google und KI-Antworten übernommen.",
						3,
						"FAQ-Abschnitt zusätzlich als FAQPage (JSON-LD) auszeichnen.",
						faqSection.id,
					),
		);

	return {
		checks: out.map((c) => ({ ...c, page })),
		title,
		h1,
		text,
		description,
	};
}

/** Prüfungen auf Ebene der Domain (robots.txt, sitemap.xml). */
export function analyzeOrigin(
	origin: string,
	robotsTxt: string | null,
	sitemapOk: boolean,
	stage: SiteProfile["stage"] = "live",
): CheckResult[] {
	const out: CheckResult[] = [];
	const page = "/";
	if (robotsTxt === null)
		out.push({
			...check(
				"robots",
				"Technik",
				"warnung",
				"Keine robots.txt",
				`${origin}/robots.txt fehlt.`,
				2,
				"robots.txt mit Verweis auf die Sitemap anlegen.",
			),
			page,
		});
	else if (/^\s*disallow:\s*\/\s*$/im.test(robotsTxt))
		out.push({
			...(stage === "entwurf"
				? check(
						"robots",
						"Technik",
						"warnung",
						"robots.txt sperrt alles (Entwurf, gewollt)",
						"Vor dem Livegang aufheben.",
						1,
						"Sperre in robots.txt beim Livegang aufheben.",
					)
				: check(
						"robots",
						"Technik",
						"fehler",
						"robots.txt sperrt alles",
						"Suchmaschinen dürfen die Seite nicht lesen.",
						5,
						"Sperre in robots.txt aufheben.",
					)),
			page,
		});
	else
		out.push({
			...check(
				"robots",
				"Technik",
				"ok",
				"robots.txt vorhanden",
				"Suchmaschinen dürfen lesen",
				2,
			),
			page,
		});
	out.push(
		sitemapOk
			? {
					...check(
						"sitemap",
						"Technik",
						"ok",
						"Sitemap vorhanden",
						`${origin}/sitemap.xml`,
						2,
					),
					page,
				}
			: {
					...check(
						"sitemap",
						"Technik",
						"warnung",
						"Keine Sitemap",
						"Eine sitemap.xml hilft Google, alle Seiten zu finden.",
						2,
						"sitemap.xml erzeugen und in robots.txt sowie der Search Console eintragen.",
					),
					page,
				},
	);
	return out;
}

/** Ein Begriff zählt als vorhanden, wenn alle seine Wörter vorkommen (Reihenfolge egal). */
export function keywordCoverage(
	phrase: string,
	analysis: Pick<PageAnalysis, "title" | "h1" | "text">,
	page: string,
) {
	const words = norm(phrase)
		.split(/[\s-]+/)
		.filter(Boolean);
	const has = (s: string) => {
		const t = norm(s);
		return words.every((w) => t.includes(w));
	};
	return {
		phrase,
		page,
		inTitle: has(analysis.title),
		inH1: analysis.h1.some(has),
		inBody: has(analysis.text),
	};
}
