import type { SiteProfile } from "../core/types";

const view = (id: string) => `section[data-view="${id}"]`;

/**
 * Ismails Seite (Peter 3.11.2026, Anleitung „Egypt with Ismael in WEBSI“ A1–A8 und
 * Fragen-Seite „Ismael und Postfächer“): privater Fahrer in Gizeh und Kairo, fünf
 * Sprachen. Gehört Ismail, deshalb `fremd`: Peters persönliche Regeln gelten hier nicht.
 */
export const ismail: SiteProfile = {
	id: "ismail",
	name: "Egypt with Ismail",
	stage: "entwurf",
	fremd: true,
	// Workers Builds aus PsyPIOTY/egypt-with-ismail in Peters Cloudflare-Konto.
	url: "https://egypt-with-ismail.kib-community.workers.dev",
	// Die sechs Bereiche sind Unterseiten (#tours …); „?alle“ zeigt sie für den Editor untereinander.
	editorPath: "/?alle",
	pages: ["/"],
	repo: {
		owner: "PsyPIOTY",
		name: "egypt-with-ismail",
		baseBranch: "main",
		path: "site",
	},
	agent: { adapter: "github-claude", label: "websi" },
	sections: [
		{ id: "home", label: "Start", selector: view("home") },
		{ id: "tours", label: "Ausflüge", selector: view("tours") },
		{ id: "desert", label: "Wüste", selector: view("desert") },
		{ id: "info", label: "Gut zu wissen", selector: view("info") },
		{ id: "about", label: "Über Ismail", selector: view("about") },
		{ id: "contact", label: "Kontakt", selector: view("contact") },
	],
	seo: {
		region: "Gizeh",
		// Suchbegriffe kommen, wenn die Seite unter egyptwithismail.com online geht.
		keywords: [],
		schemaTypes: [],
		googleBusinessProfile: false,
	},
	directories: [],
	// Peters Antworten A6 und A7 (3.11.2026). „Ansprache mit Sie“ gilt wie bei allen Seiten.
	startStyle: [
		"Ismail ist Fahrer, nie Guide oder Reiseleiter",
		"Jede Änderung in allen fünf Sprachen gleich: Englisch, Französisch, Spanisch, Deutsch, Arabisch",
		"Arabisch in ägyptischer Umgangssprache, nicht Hocharabisch",
		"Keine erfundenen Bewertungen",
		"Preise und Kontaktdaten nur von Ismail oder Peter",
		"Dazusagen, dass niemand mit Muttersprache die Übersetzungen gegengelesen hat",
	],
	notes:
		"Website für Ismail, Fahrer in Gizeh und Kairo. Domain egyptwithismail.com (Inhaber Ismail), liegt bei Peter bei All-Inkl. Online erst nach Domain und Ort.",
};
