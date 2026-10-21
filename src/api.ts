import type {
	ChangeRequest,
	DirectoryDef,
	DirectoryStatus,
	Pin,
	SiteProfile,
	VisibilityReport,
} from "../core/types";

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
	}) =>
		call<ChangeRequest>("requests", {
			method: "POST",
			body: JSON.stringify(input),
		}),
	action: (
		id: string,
		action: "send" | "sync" | "publish" | "discard" | "reopen",
	) => call<ChangeRequest>(`requests/${id}/${action}`, { method: "POST" }),
	followUp: (id: string, text: string) =>
		call<ChangeRequest>(`requests/${id}/followup`, {
			method: "POST",
			body: JSON.stringify({ text }),
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
