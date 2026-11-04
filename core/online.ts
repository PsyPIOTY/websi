/**
 * Online stellen (Peter 3.11.2026, Anleitung „Websites online stellen“, C1–C4,
 * A8 „nur für WEBSI“): Der Knopf legt im Repo der Website ein Issue mit Label
 * „online-stellen“ an. Der Mac mini (KIAPP, online_stellen.py) prüft die
 * Unterschrift, holt die neueste Fassung aus der Werkstatt, lädt sie zu
 * All-Inkl und meldet das Ergebnis als Kommentar am Issue.
 *
 * Die Unterschrift ist HMAC-SHA256 mit dem WEBSI-Schlüssel (MCP_TOKEN) über
 * „websi-online|site|commit|zeit“. Der Helfer am Mac mini kennt nur das
 * GitHub-Token, nicht diesen Schlüssel: So kann nur WEBSI, also Peters
 * Klick hinter seiner Anmeldung, einen Auftrag schreiben.
 */

export const ONLINE_LABEL = "online-stellen";
const ORDER = "websi-online";
const RESULT = "websi-online-ergebnis";

export interface OnlineOrder {
	site: string;
	commit: string;
	zeit: string;
	sig: string;
}

export interface OnlineResult {
	ok: boolean;
	zeit: string;
	site?: string;
	commit?: string;
	dateien?: number;
}

/** Cloudflare-Bau der neuesten Fassung (Prüfung „Workers Builds“ am Stand von main). */
export type BuildState = "fertig" | "laeuft" | "fehler" | "unbekannt";

export interface OnlineStatus {
	domain: string;
	/** Knopf nutzbar: GitHub-Zugang und WEBSI-Schlüssel sind da. */
	ready: boolean;
	reason?: string;
	/** Neueste Fassung: commit = Stand von main (wird hochgeladen); Zeit und Text = letzte Änderung an dieser Website. */
	stand: {
		commit: string;
		at: string;
		message: string;
		build: BuildState;
	} | null;
	/** Ein Auftrag liegt beim Mac mini. */
	pending: { at: string; url: string } | null;
	/** Letzte Rückmeldung des Mac mini. */
	last: { ok: boolean; at: string; text: string; url: string } | null;
	lastOnline: { at: string; commit?: string } | null;
}

const hex = (buf: ArrayBuffer) =>
	[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Gleiche Rechnung wie der Mac mini (online_stellen.unterschrift). */
export async function signOrder(
	key: string,
	site: string,
	commit: string,
	zeit: string,
) {
	const enc = new TextEncoder();
	const k = await crypto.subtle.importKey(
		"raw",
		enc.encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		k,
		enc.encode(`websi-online|${site}|${commit}|${zeit}`),
	);
	return hex(sig);
}

export function orderBody(order: OnlineOrder, domain: string, stand: string) {
	return [
		`Peter hat in WEBSI „Online stellen“ gedrückt: ${domain}.`,
		"",
		`Stand: ${stand}`,
		"",
		"Der Mac mini holt die neueste Fassung aus der Werkstatt und lädt sie zu All-Inkl hoch. Er schaut alle 10 Minuten nach und schreibt das Ergebnis hier hin.",
		"",
		`<!-- ${ORDER}:${JSON.stringify(order)} -->`,
	].join("\n");
}

function readMeta<T>(body: string | null | undefined, name: string): T | null {
	const m = (body ?? "").match(
		new RegExp(`<!--\\s*${name}:(\\{[\\s\\S]*?\\})\\s*-->`),
	);
	if (!m) return null;
	try {
		return JSON.parse(m[1]) as T;
	} catch {
		return null;
	}
}

export const readOrder = (body: string | null | undefined) =>
	readMeta<OnlineOrder>(body, ORDER);

export const readResult = (body: string | null | undefined) =>
	readMeta<OnlineResult>(body, RESULT);

/** Kommentartext ohne die versteckte Angabe, z. B. „⚠️ Nicht online gestellt: …“. */
export function resultText(body: string) {
	return body
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^(✅ Online|⚠️ Nicht online gestellt):\s*/u, "")
		.trim();
}
