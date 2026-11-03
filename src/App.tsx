import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_ENGINE, type EngineId, isEngine } from "../core/engines";
import type { ChangeRequest } from "../core/types";
import type { UsageSummary } from "../core/usage";
import { api, type SiteData, type SiteSummary, type StatusInfo } from "./api";
import { CompareView } from "./components/CompareView";
import { EditorView } from "./components/EditorView";
import { RequestDetail } from "./components/RequestDetail";
import { RequestsView } from "./components/RequestsView";
import { StyleView } from "./components/StyleView";
import { TopBar } from "./components/TopBar";
import { VisibilityView } from "./components/VisibilityView";
import { store } from "./local";

export type Tab = "editor" | "sichtbarkeit" | "auftraege" | "stil";
const TABS: Tab[] = ["editor", "sichtbarkeit", "auftraege", "stil"];

function readHash(): { site?: string; tab?: Tab; auftrag?: string } {
	const params = new URLSearchParams(location.hash.slice(1));
	const tab = params.get("tab");
	return {
		site: params.get("site") ?? undefined,
		tab: TABS.includes(tab as Tab) ? (tab as Tab) : undefined,
		auftrag: params.get("auftrag") ?? undefined,
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
	// Link aus einem Hinweis (#…&auftrag=…): öffnen, sobald die Website geladen ist.
	const [pendingId, setPendingId] = useState(initial.auftrag ?? null);
	const [compareId, setCompareId] = useState<string | null>(null);
	const [usage, setUsage] = useState<UsageSummary | null>(null);
	const [engine, setEngineState] = useState<EngineId>(() => {
		const saved = store.get("websi.engine");
		return isEngine(saved) ? saved : DEFAULT_ENGINE;
	});
	const setEngine = useCallback((e: EngineId) => {
		setEngineState(e);
		store.set("websi.engine", e);
	}, []);
	const refreshUsage = useCallback(() => {
		api.usage().then(setUsage, () => {});
	}, []);

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
		setCompareId(null);
		if (!siteId) return;
		store.set("websi.site", siteId);
		reload();
	}, [siteId, reload]);

	useEffect(() => {
		if (pendingId && data?.requests.some((r) => r.id === pendingId)) {
			setOpenId(pendingId);
			setPendingId(null);
		}
	}, [data, pendingId]);

	useEffect(() => {
		const onHash = () => {
			const next = readHash();
			if (next.site) setSiteId(next.site);
			if (next.tab) setTab(next.tab);
			if (next.auftrag) setPendingId(next.auftrag);
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

	const upsertMany = useCallback((list: ChangeRequest[]) => {
		setData((d) => {
			if (!d) return d;
			const mine = list.filter((r) => r.siteId === d.profile.id);
			if (!mine.length) return d;
			const ids = new Set(mine.map((r) => r.id));
			const rest = d.requests.filter((x) => !ids.has(x.id));
			return { ...d, requests: [...mine, ...rest] };
		});
	}, []);
	const upsert = useCallback(
		(r: ChangeRequest) => upsertMany([r]),
		[upsertMany],
	);

	useEffect(() => {
		refreshUsage();
	}, [refreshUsage]);

	// Kontingent nachziehen, sobald sich an den Aufträgen etwas ändert.
	const changeKey = data?.requests.map((r) => r.updatedAt).join("|") ?? "";
	useEffect(() => {
		if (changeKey) refreshUsage();
	}, [changeKey, refreshUsage]);

	// Laufende Aufträge regelmäßig abgleichen; ein Sammelauftrag nur einmal.
	useEffect(() => {
		if (!data) return;
		const seen = new Set<string>();
		const running = data.requests.filter((r) => {
			if (r.status !== "in_arbeit") return false;
			const key = r.batchId ?? r.id;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		if (!running.length) return;
		const timer = setInterval(() => {
			if (document.hidden) return;
			for (const r of running)
				api.action(r.id, "sync").then(
					(res) => upsertMany([res, ...(res.related ?? [])]),
					() => {},
				);
		}, 20000);
		return () => clearInterval(timer);
	}, [data, upsertMany]);

	const open = useMemo(
		() => data?.requests.find((r) => r.id === openId) ?? null,
		[data, openId],
	);
	const comparing = useMemo(
		() => data?.requests.find((r) => r.id === compareId) ?? null,
		[data, compareId],
	);
	const siblings = useMemo(
		() =>
			open?.batchId
				? (data?.requests.filter((r) => r.batchId === open.batchId) ?? [])
				: [],
		[data, open],
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
				usage={usage}
				onUsage={setUsage}
			/>
			<main className="main">
				{loadError && (
					<p className="banner banner--error" role="alert">
						{loadError}
					</p>
				)}
				{status?.paco?.level === "getrennt" && (
					<p className="banner banner--error" role="alert">
						Verbindung zu Paco unterbrochen: {status.paco.text}. Wünsche aus
						WEBSI laufen weiter, nur Paco sieht gerade nichts.
					</p>
				)}
				{!data && !loadError && (
					<p className="loading">Website wird geladen …</p>
				)}
				{data && tab === "editor" && (
					<EditorView
						key={data.profile.id}
						data={data}
						engines={status?.engines ?? []}
						engine={engine}
						onEngine={setEngine}
						onCreated={upsert}
						onChanged={upsertMany}
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
				{data && tab === "stil" && <StyleView profile={data.profile} />}
			</main>
			{open && data && (
				<RequestDetail
					request={open}
					profile={data.profile}
					siblings={siblings}
					engines={status?.engines ?? []}
					engine={engine}
					onChange={upsertMany}
					onCompare={() => setCompareId(open.id)}
					onClose={() => setOpenId(null)}
				/>
			)}
			{comparing && data && (
				<CompareView
					request={comparing}
					profile={data.profile}
					onClose={() => setCompareId(null)}
				/>
			)}
		</div>
	);
}
