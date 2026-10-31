import { DEFAULT_DRAFTS, normalizeDrafts } from "../core/drafts";
import { store } from "./local";

/** Peters Richtungen für „3 Entwürfe“, pro Browser gemerkt. */
export function draftNames() {
	try {
		const saved = normalizeDrafts(JSON.parse(store.get("websi.drafts") ?? ""));
		if (saved.length) return saved;
	} catch {}
	return DEFAULT_DRAFTS;
}

export function saveDraftNames(names: string[]) {
	store.set("websi.drafts", JSON.stringify(names));
}
