import type { SiteProfile } from "../core/types";

const anchor = (id: string) => `[data-anchor-id="${id}"]`;

export const praxis: SiteProfile = {
	id: "praxis",
	name: "Praxis Peter Jarek",
	stage: "entwurf",
	url: "https://konzeptstudio.peter-jarek.workers.dev",
	// Konzept 09 „Das erste Gespräch“ ist die Basis; Elemente aus 04 und 08 kommen dazu.
	// /praxis zeigt es ohne Konzeptstudio und liefert den ganzen Inhalt im HTML aus.
	editorPath: "/praxis",
	pages: ["/praxis"],
	repo: {
		owner: "PsyPIOTY",
		name: "psychologe-konzeptstudio",
		baseBranch: "main",
		path: "src/components/studio/frames",
	},
	agent: { adapter: "github-claude", label: "websi" },
	sections: [
		{ id: "hero", label: "Einleitung", selector: `${anchor("hero")}, ${anchor("hero.approved")}` },
		{ id: "concerns", label: "Anliegen", selector: anchor("concerns") },
		{ id: "experience", label: "Selbsteinschätzung", selector: anchor("experience") },
		{ id: "offers", label: "Angebot", selector: anchor("offers") },
		{ id: "approach", label: "Haltung", selector: anchor("approach") },
		{ id: "about", label: "Person", selector: anchor("about") },
		{ id: "rahmen", label: "Rahmen", selector: anchor("rahmen") },
		{ id: "contact", label: "Erstkontakt", selector: anchor("contact") },
		{ id: "faq", label: "Fragen", selector: anchor("faq") },
		{ id: "psychologie", label: "Psychologie", selector: anchor("psychologie") },
		{ id: "crisis", label: "Akute Hilfe", selector: anchor("crisis") },
		{ id: "footer", label: "Fußzeile", selector: anchor("footer") },
	],
	seo: {
		region: "Bad Belzig",
		postalCode: "14806",
		keywords: [
			{ phrase: "Paartherapie Bad Belzig" },
			{ phrase: "Beziehungsberatung" },
			{ phrase: "Kommunikations-Coaching" },
			{ phrase: "Psychologe Bad Belzig" },
		],
		// "Psychologist" gibt es bei schema.org nicht.
		schemaTypes: ["LocalBusiness"],
		googleBusinessProfile: false,
	},
	directories: [
		{ id: "google", name: "Google Unternehmensprofil", url: "https://business.google.com" },
		{ id: "bing", name: "Bing Places", url: "https://www.bingplaces.com" },
		{ id: "apple", name: "Apple Business Connect", url: "https://businessconnect.apple.com" },
		{ id: "therapie-de", name: "therapie.de", url: "https://www.therapie.de" },
		{ id: "jameda", name: "jameda", url: "https://www.jameda.de" },
		{ id: "11880", name: "11880", url: "https://www.11880.com" },
		{ id: "gelbe-seiten", name: "Gelbe Seiten", url: "https://www.gelbeseiten.de" },
	],
	notes:
		"Konzept 09 ist Basis. Endergebnis wird eine Mischung aus 04 Verbunden, 08 Sicherer Hafen und 09; gute Elemente an die richtigen Stellen bringen.",
};
