/**
 * Ideen von fremden Websites (Peter 14./15.11.2026, Programmierliste neu-2 und o-13).
 *
 * Peter schickt dem WEBSI-Bot in Telegram ein Foto oder einen Link einer fremden Seite und schreibt „Idee“ dazu.
 * Paco legt sie am Mac mini unter AGENTEN/WEBSI/EINGANG/Ideen ab und gibt sie über die MCP-Brücke an WEBSI
 * weiter (websi_idee_ablegen). Im Editor stehen sie in der Ecke „Ideen“: als Wunsch für die aktive Website
 * übernehmen oder als erledigt weglegen. Fremde Seiten sind nur Anregung, kopiert wird nichts.
 */

export type IdeaStatus = "neu" | "uebernommen" | "erledigt";

export interface Idea {
	id: string;
	text: string;
	/** Erster Link aus dem Text oder eigens mitgegeben. */
	link?: string;
	/** Bildtyp, wenn ein Foto dabei ist (das Bild selbst liegt getrennt). */
	bild?: string;
	/** Dateiname bei Paco, z. B. telegram-websi-12.jpg: dieselbe Idee kommt nur einmal an. */
	quelle?: string;
	status: IdeaStatus;
	/** Übernommen als Wunsch: für welche Website, welcher Auftrag. */
	siteId?: string;
	requestId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface IdeaImage {
	type: string;
	/** Base64 ohne „data:“-Vorspann. */
	data: string;
}

export class IdeaError extends Error {}

export const TEXT_MAX = 4000;
/** D1 trägt höchstens 2 MB je Zeile; ein Telegram-Foto hat meist unter 300 KB. */
export const BILD_MAX = 1_400_000;
const BILDTYPEN = ["image/jpeg", "image/png", "image/webp"];
const LINK = /https?:\/\/[^\s<>"']+/i;

function cleanLink(value: string) {
	try {
		const url = new URL(value.replace(/[.,;:!?)»“]+$/, ""));
		return url.protocol === "https:" || url.protocol === "http:"
			? url.toString()
			: undefined;
	} catch {
		return undefined;
	}
}

export interface NewIdea {
	text: string;
	link?: string;
	bild: IdeaImage | null;
	quelle?: string;
}

/** Prüft eine neue Idee: Text oder Foto muss da sein, Bild nur JPEG, PNG oder WebP. */
export function validateIdea(raw: Record<string, unknown>): NewIdea {
	const text = String(raw.text ?? "")
		.trim()
		.slice(0, TEXT_MAX);
	let bild: IdeaImage | null = null;
	if (raw.bild) {
		const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(
			String(raw.bild),
		);
		if (!m || !BILDTYPEN.includes(m[1]))
			throw new IdeaError("Bild nur als JPEG, PNG oder WebP");
		const data = m[2].replace(/\s/g, "");
		if (data.length > BILD_MAX)
			throw new IdeaError("Bild zu groß (höchstens etwa 1 MB)");
		bild = { type: m[1], data };
	}
	if (!text && !bild) throw new IdeaError("Idee ohne Text und ohne Foto");
	const linkRaw = raw.link ? String(raw.link) : LINK.exec(text)?.[0];
	const link = linkRaw ? cleanLink(linkRaw) : undefined;
	const quelle = raw.quelle ? String(raw.quelle).slice(0, 200) : undefined;
	return { text, link, bild, quelle };
}

/** Der Wunsch, der aus einer Idee wird, wenn Peter sie für eine Website übernimmt. */
export function ideaToWish(idea: Idea) {
	const text = idea.text.slice(0, 3600);
	const teile = [`Idee von einer fremden Website: ${text || "siehe Foto"}`];
	if (idea.link && !text.includes(idea.link)) teile.push(`Link: ${idea.link}`);
	if (idea.bild) teile.push("Foto liegt in WEBSI unter Ideen.");
	teile.push("Nur als Anregung, nichts übernehmen oder kopieren.");
	return teile.join("\n");
}
