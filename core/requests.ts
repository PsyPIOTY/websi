import { type EngineId, isEngine } from "./engines";
import type { ChangeRequest, Pin, RequestEvent, RequestStatus } from "./types";

/** Erlaubte Übergänge. Veröffentlichen kann nur Peter auslösen (Worker prüft das). */
const transitions: Record<RequestStatus, RequestStatus[]> = {
	offen: ["in_arbeit", "verworfen"],
	in_arbeit: ["vorschlag", "offen", "verworfen"],
	vorschlag: ["in_arbeit", "veroeffentlicht", "verworfen"],
	veroeffentlicht: [],
	verworfen: ["offen"],
};

export const statusLabels: Record<RequestStatus, string> = {
	offen: "Gesammelt",
	in_arbeit: "In Arbeit",
	vorschlag: "Vorschlag da",
	veroeffentlicht: "Live",
	verworfen: "Verworfen",
};

export function canTransition(from: RequestStatus, to: RequestStatus) {
	return transitions[from].includes(to);
}

export class RequestError extends Error {}

export interface NewRequestInput {
	siteId: string;
	sectionId: string;
	text: string;
	pagePath: string;
	pin?: Pin;
	engine?: EngineId;
}

export function validateNewRequest(input: unknown): NewRequestInput {
	if (!input || typeof input !== "object")
		throw new RequestError("Leerer Auftrag");
	const v = input as Record<string, unknown>;
	const str = (key: string, max: number) => {
		const value = v[key];
		if (typeof value !== "string" || !value.trim())
			throw new RequestError(`Feld „${key}“ fehlt`);
		if (value.length > max) throw new RequestError(`Feld „${key}“ ist zu lang`);
		return value.trim();
	};
	const result: NewRequestInput = {
		siteId: str("siteId", 64),
		sectionId: str("sectionId", 64),
		text: str("text", 4000),
		pagePath: typeof v.pagePath === "string" ? v.pagePath.slice(0, 300) : "/",
	};
	if (v.engine !== undefined && v.engine !== null && v.engine !== "") {
		if (!isEngine(v.engine)) throw new RequestError("Modell unbekannt");
		result.engine = v.engine;
	}
	const pin = v.pin as Record<string, unknown> | undefined;
	if (pin && typeof pin.x === "number" && typeof pin.y === "number") {
		result.pin = {
			x: Math.min(100, Math.max(0, pin.x)),
			y: Math.min(100, Math.max(0, pin.y)),
			hint: typeof pin.hint === "string" ? pin.hint.slice(0, 200) : undefined,
		};
	}
	return result;
}

export function createRequest(
	input: NewRequestInput,
	id: string,
	now: string,
	by = "peter",
): ChangeRequest {
	return {
		id,
		...input,
		status: "offen",
		createdAt: now,
		updatedAt: now,
		events: [{ at: now, kind: "erstellt", text: input.text, by }],
	};
}

export function withStatus(
	request: ChangeRequest,
	to: RequestStatus,
	now: string,
	event?: Omit<RequestEvent, "at">,
): ChangeRequest {
	if (request.status !== to && !canTransition(request.status, to)) {
		throw new RequestError(
			`Von „${statusLabels[request.status]}“ geht es nicht zu „${statusLabels[to]}“`,
		);
	}
	return {
		...request,
		status: to,
		updatedAt: now,
		events: event ? [...request.events, { at: now, ...event }] : request.events,
	};
}

export function addEvent(
	request: ChangeRequest,
	now: string,
	event: Omit<RequestEvent, "at">,
) {
	return {
		...request,
		updatedAt: now,
		events: [...request.events, { at: now, ...event }],
	};
}

/** Zusammenfassung je Abschnitt für Statusmarken und Mini-Karte. */
export function summarizeBySection(requests: ChangeRequest[]) {
	const summary: Record<
		string,
		{ open: number; total: number; top: RequestStatus | null }
	> = {};
	const rank: RequestStatus[] = [
		"vorschlag",
		"in_arbeit",
		"offen",
		"veroeffentlicht",
		"verworfen",
	];
	for (const r of requests) {
		const s = summary[r.sectionId] ?? { open: 0, total: 0, top: null };
		s.total += 1;
		if (r.status !== "veroeffentlicht" && r.status !== "verworfen") s.open += 1;
		if (s.top === null || rank.indexOf(r.status) < rank.indexOf(s.top))
			s.top = r.status;
		summary[r.sectionId] = s;
	}
	return summary;
}
