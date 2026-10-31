import type { PacoContact } from "../core/paco";
import type { Store } from "./storage";

export const CONTACT_KEY = "paco-kontakt";
/** Höchstens alle 10 Minuten schreiben, ein Lebenszeichen braucht nicht mehr. */
const THROTTLE_MS = 10 * 60_000;

/** Merkt sich, dass Paco (mit MCP_TOKEN) WEBSI erreicht hat. */
export async function markContact(store: Store, via: string, now: Date) {
	const last = await store.getSetting<PacoContact>(CONTACT_KEY);
	if (last && now.getTime() - Date.parse(last.at) < THROTTLE_MS) return;
	await store.putSetting(CONTACT_KEY, { at: now.toISOString(), via });
}
