import type { EngineId, EngineInfo } from "../core/engines";
import type {
	ChangeRequest,
	DirectoryDef,
	DirectoryStatus,
	Pin,
	SiteProfile,
	StyleRule,
	VisibilityReport,
} from "../core/types";
import type { Limits, UsageSummary } from "../core/usage";

/** Antwort einer Aktion: der Auftrag und alle mitgeänderten (Sammelauftrag). */
export type ActionResult = ChangeRequest & { related?: ChangeRequest[] };

export const withRelated = (r: ActionResult): ChangeRequest[] => {
	const { related, ...main } = r;
	return [main, ...(related ?? [])];
};

export interface StyleData {
	rules: StyleRule[];
	suggestions: { text: string; source: StyleRule["source"]; at: string }[];
}

export interface SiteSummary {
	id: string;
	name: string;
	url: string;
	sections: number;
}

export interface SiteData {
	profile: SiteProfile;
	requests: ChangeRequest[];
	report: VisibilityReport | null;
	history: { scannedAt: string; score: number }[];
	directories: (DirectoryDef & { status: DirectoryStatus; note: string })[];
	adapter: { id: string; label: string };
}

export interface StatusInfo {
	adapters: { id: string; label: string; ready: boolean; planned?: boolean }[];
	engines: EngineInfo[];
	mode: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api/websi/${path}`, {
		...init,
		headers: init?.body ? { "content-type": "application/json" } : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok)
		throw new Error(
			(data as { error?: string }).error ?? `Fehler ${res.status}`,
		);
	return data as T;
}

export const api = {
	status: () => call<StatusInfo>("status"),
	sites: () => call<SiteSummary[]>("sites"),
	site: (id: string) => call<SiteData>(`sites/${id}`),
	createRequest: (input: {
		siteId: string;
		sectionId: string;
		text: string;
		pagePath: string;
		pin?: Pin;
		engine?: EngineId;
		send?: boolean;
	}) =>
		call<ChangeRequest>("requests", {
			method: "POST",
			body: JSON.stringify(input),
		}),
	sendBatch: (siteId: string, engine: EngineId, requestIds?: string[]) =>
		call<ChangeRequest[]>("batches", {
			method: "POST",
			body: JSON.stringify({ siteId, engine, requestIds }),
		}),
	action: (
		id: string,
		action: "send" | "sync" | "publish" | "reopen",
		body?: Record<string, unknown>,
	) =>
		call<ActionResult>(`requests/${id}/${action}`, {
			method: "POST",
			body: body ? JSON.stringify(body) : undefined,
		}),
	discard: (id: string, reason = "", remember = false) =>
		call<ActionResult>(`requests/${id}/discard`, {
			method: "POST",
			body: JSON.stringify({ reason, remember }),
		}),
	followUp: (id: string, text: string, remember = false) =>
		call<ActionResult>(`requests/${id}/followup`, {
			method: "POST",
			body: JSON.stringify({ text, remember }),
		}),
	style: (siteId: string) => call<StyleData>(`style/${siteId}`),
	addStyle: (
		siteId: string,
		text: string,
		scope: "site" | "alle",
		source: StyleRule["source"] = "peter",
	) =>
		call<StyleRule>(`style/${siteId}`, {
			method: "POST",
			body: JSON.stringify({
				text,
				scope: scope === "alle" ? "alle" : siteId,
				source,
			}),
		}),
	patchStyle: (
		siteId: string,
		id: string,
		patch: { active?: boolean; text?: string; scope?: string },
	) =>
		call<StyleRule>(`style/${siteId}/${id}`, {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),
	deleteStyle: (siteId: string, id: string) =>
		call(`style/${siteId}/${id}`, { method: "DELETE" }),
	usage: () => call<UsageSummary>("usage"),
	setLimits: (limits: Limits) =>
		call<Limits>("usage/limits", {
			method: "PUT",
			body: JSON.stringify(limits),
		}),
	scan: (siteId: string) =>
		call<VisibilityReport>(`visibility/${siteId}/scan`, { method: "POST" }),
	setDirectory: (
		siteId: string,
		dirId: string,
		status: DirectoryStatus,
		note: string,
	) =>
		call(`directories/${siteId}/${dirId}`, {
			method: "PUT",
			body: JSON.stringify({ status, note }),
		}),
};
