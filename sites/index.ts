import type { SiteProfile } from "../core/types";
import { humansource } from "./humansource";
import { praxis } from "./praxis";

/**
 * Alle hinterlegten Websites. Eine neue Website = eine neue Datei in diesem
 * Ordner + ein Eintrag hier. Bearbeitet wird immer nur eine davon.
 */
export const siteProfiles: SiteProfile[] = [praxis, humansource];
