import type { SiteProfile } from "./types";

/** Gültiger Vorschau-Name (Cloudflare-Alias), z. B. websi-12. */
export const ALIAS = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * Vorschau-Kennung aus einer Vorschau-Adresse, z. B.
 * https://websi-12-konzeptstudio.x.workers.dev → "praxis@websi-12".
 * Nur Adressen derselben Website (gleicher Host mit Präfix) sind erlaubt.
 */
export function previewKey(site: SiteProfile, previewUrl: string | undefined) {
	if (!previewUrl) return null;
	try {
		const host = new URL(previewUrl).host;
		const base = new URL(site.url).host;
		if (host === base) return site.id;
		if (!host.endsWith(`-${base}`)) return null;
		const alias = host.slice(0, -(base.length + 1));
		return ALIAS.test(alias) ? `${site.id}@${alias}` : null;
	} catch {
		return null;
	}
}
