import type { SiteProfile } from "../core/types";
import { humansource } from "./humansource";
import { praxis } from "./praxis";

/**
 * Alle hinterlegten Websites. Eine neue Website = eine neue Datei in diesem
 * Ordner + ein Eintrag hier. Bearbeitet wird immer nur eine davon.
 */
export const siteProfiles: SiteProfile[] = [praxis, humansource];

/**
 * Peters Stil-Regeln für alle Websites (seine Antwort E3, 23.10.2026). WEBSI
 * legt sie beim ersten Start einmal an; danach ändert Peter sie unter „Stil“.
 */
export const startStyle = [
	"Ansprache mit „Sie“, wie auf den Seiten heute",
	"Ton und Wortwahl wie in Peters bisherigen Texten",
	"Keine Bilder, die nach KI aussehen",
	"Preise und Therapie-Aussagen nur in Peters Wortlaut",
	"Farben und Schriften bleiben, außer Peter wünscht es ausdrücklich",
];
