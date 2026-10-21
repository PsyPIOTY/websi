import type { SiteProfile } from "../core/types";

export const humansource: SiteProfile = {
	id: "humansource",
	name: "humansourcebusiness",
	stage: "entwurf",
	url: "https://humansource.peter-jarek.workers.dev",
	editorPath: "/",
	pages: ["/"],
	repo: {
		owner: "PsyPIOTY",
		name: "psychologe-konzeptstudio",
		baseBranch: "main",
		path: "src/components/business",
	},
	agent: { adapter: "github-claude", label: "websi" },
	sections: [
		{ id: "hero", label: "Einstieg", selector: "section.hsb-hero" },
		{ id: "situation", label: "Anliegen", selector: "#hsb-situation" },
		{ id: "leistungen", label: "Leistungen", selector: "#hsb-leistungen" },
		{ id: "haltung", label: "Haltung", selector: "#hsb-haltung" },
		{ id: "ansatz", label: "Ansatz", selector: "#hsb-ansatz" },
		{ id: "formate", label: "Formate", selector: "#hsb-formate" },
		{ id: "person", label: "Person", selector: "#hsb-person" },
		{ id: "fragen", label: "Fragen", selector: "#hsb-fragen" },
		{ id: "kontakt", label: "Kontakt", selector: "#hsb-kontakt" },
		{ id: "fuss", label: "Fußzeile", selector: "footer.hsb-footer" },
	],
	seo: {
		region: "Bad Belzig",
		postalCode: "14806",
		keywords: [
			{ phrase: "Führungskräfte-Coaching", page: "/" },
			{ phrase: "Change-Management", page: "/" },
			{ phrase: "Organisationsentwicklung", page: "/" },
			{ phrase: "Mediation im Unternehmen", page: "/" },
			{ phrase: "Team-Workshops", page: "/" },
		],
		schemaTypes: ["ProfessionalService", "Person"],
		googleBusinessProfile: false,
	},
	directories: [
		{ id: "google", name: "Google Unternehmensprofil", url: "https://business.google.com" },
		{ id: "bing", name: "Bing Places", url: "https://www.bingplaces.com" },
		{ id: "apple", name: "Apple Business Connect", url: "https://businessconnect.apple.com" },
		{ id: "linkedin", name: "LinkedIn Unternehmensseite", url: "https://www.linkedin.com/company/setup/new/" },
	],
	notes: "Entwurf unter /business im Konzeptstudio-Repo. Vorbilder: Strategy&, Oliver Wyman, PwC.",
};
