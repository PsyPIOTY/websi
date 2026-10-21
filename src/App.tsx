import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeRequest } from "../core/types";
import { api, type SiteData, type SiteSummary, type StatusInfo } from "./api";
import { EditorView } from "./components/EditorView";
import { RequestDetail } from "./components/RequestDetail";
import { RequestsView } from "./components/RequestsView";
import { TopBar } from "./components/TopBar";
import { VisibilityView } from "./components/VisibilityView";

export type Tab = "editor" | "sichtbarkeit" | "auftraege";

const store = {
	get(key: string) {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	set(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {}
	},
};

function readHash(): { site?: string; tab?: Tab } {
	const params = new URLSearchParams(location.hash.slice(1));
	const tab = params.get("tab");
	return {
		site: params.get("site") ?? undefined,
		tab:
			tab === "editor" || tab === "sichtbarkeit" || tab === "auftraege"
				? tab
				: undefined,
	};
}

export function App() {
	const initial = readHash();
	const [sites, setSites] = useState<SiteSummary[]>([]);
	const [status, setStatus] = useState<StatusInfo | null>(null);
	const [siteId, setSiteId] = useState<string | null>(
		initial.site ?? store.get("websi.site"),
	);
	const [tab, setTab] = useState<Tab>(initial.tab ?? "editor");
	const [data, setData] = useState<SiteData | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [openId, setOpenId] = useState<string | null>(null);

	useEffect(() => {
		api.sites().then(
			(list) => {
				setSites(list);
				setSiteId((current) =>
					current && list.some((s) => s.id === current)
						? current
						: (list[0]?.id ?? null),
				);
			},
			(e: Error) => setLoadError(e.message),
		);
		api.status().then(setStatus, () => {});
	}, []);

	// Beim Wechsel der Website alle Daten genau dieser Website laden.
	const reload = useCallback(async () => {
		if (!siteId) return;
		try {
			setData(await api.site(siteId));
			setLoadError(null);
		} catch (e) {
			setLoadError((e as Error).message);
		}
	}, [siteId]);

	useEffect(() => {
		setData(null);
		setOpenId(null);
		if (!siteId) return;
		store.set("websi.site", siteId);
		reload();
	}, [siteId, reload]);

	useEffect(() => {
		const onHash = () => {
			const next = readHash();
			if (next.site) setSiteId(next.site);
			if (next.tab) setTab(next.tab);
		};
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	useEffect(() => {
		const params = new URLSearchParams();
		if (siteId) params.set("site", siteId);
		params.set("tab", tab);
		history.replaceState(null, "", `#${params}`);
	}, [siteId, tab]);

	const upsert = useCallback((r: ChangeRequest) => {
		setData((d) => {
			if (!d || d.profile.id !== r.siteId) return d;
			const rest = d.requests.filter((x) => x.id !== r.id);
			return { ...d, requests: [r, ...rest] };
		});
	}, []);

	// Laufende Aufträge regelmäßig mit dem Ausführer abgleichen.
	useEffect(() => {
		if (!data) return;
		const running = data.requests.filter((r) => r.status === "in_arbeit");
		if (!running.length) return;
		const timer = setInterval(() => {
			if (document.hidden) return;
			for (const r of running) api.action(r.id, "sync").then(upsert, () => {});
		}, 20000);
		return () => clearInterval(timer);
	}, [data, upsert]);

	const open = useMemo(
		() => data?.requests.find((r) => r.id === openId) ?? null,
		[data, openId],
	);

	return (
		<div className="app">
			<TopBar
				sites={sites}
				siteId={siteId}
				onSite={setSiteId}
				tab={tab}
				onTab={setTab}
				status={status}
				adapter={data?.adapter ?? null}
			/>
			<main className="main">
				{loadError && (
					<p className="banner banner--error" role="alert">
						{loadError}
					</p>
				)}
				{!data && !loadError && (
					<p className="loading">Website wird geladen …</p>
				)}
				{data && tab === "editor" && (
					<EditorView
						key={data.profile.id}
						data={data}
						onCreated={upsert}
						onOpen={setOpenId}
					/>
				)}
				{data && tab === "sichtbarkeit" && (
					<VisibilityView
						data={data}
						onReport={(report, history) =>
							setData((d) => (d ? { ...d, report, history } : d))
						}
						onCreated={(r) => {
							upsert(r);
							setOpenId(r.id);
						}}
						onDirectories={reload}
					/>
				)}
				{data && tab === "auftraege" && (
					<RequestsView data={data} onOpen={setOpenId} />
				)}
			</main>
			{open && data && (
				<RequestDetail
					request={open}
					profile={data.profile}
					onChange={upsert}
					onClose={() => setOpenId(null)}
				/>
			)}
		</div>
	);
}
