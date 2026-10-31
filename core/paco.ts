/**
 * Verbindung zu Paco (bzw. dem KI-Betriebssystem). Jeder Abruf mit MCP_TOKEN
 * gilt als Lebenszeichen; Paco ruft mindestens einmal täglich
 * websi_verbindungstest auf. Bleibt das länger aus, zeigt WEBSI Rot.
 */
export const PACO_SILENCE_HOURS = 26;

export interface PacoContact {
	at: string;
	/** Wie Paco sich gemeldet hat, z. B. "mcp" oder "hinweise". */
	via: string;
}

export interface PacoLink {
	/** MCP_TOKEN ist gesetzt, die Brücke ist eingerichtet. */
	configured: boolean;
	lastSeen: string | null;
	level: "aus" | "wartet" | "ok" | "getrennt";
	text: string;
}

export function pacoLink(
	configured: boolean,
	contact: PacoContact | null,
	now: Date,
): PacoLink {
	const lastSeen = contact?.at ?? null;
	if (!configured)
		return {
			configured,
			lastSeen,
			level: "aus",
			text: "Brücke zu Paco noch nicht eingerichtet",
		};
	if (!lastSeen)
		return {
			configured,
			lastSeen,
			level: "wartet",
			text: "Paco hat sich noch nicht gemeldet",
		};
	const hours = (now.getTime() - Date.parse(lastSeen)) / 3_600_000;
	if (hours <= PACO_SILENCE_HOURS)
		return { configured, lastSeen, level: "ok", text: "Paco verbunden" };
	const since =
		hours < 48
			? `${Math.floor(hours)} Stunden`
			: `${Math.floor(hours / 24)} Tagen`;
	return {
		configured,
		lastSeen,
		level: "getrennt",
		text: `Paco hat sich seit ${since} nicht gemeldet`,
	};
}
