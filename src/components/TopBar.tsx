import type { Tab } from "../App";
import type { SiteSummary, StatusInfo } from "../api";

const tabs: { id: Tab; label: string }[] = [
	{ id: "editor", label: "Editor" },
	{ id: "sichtbarkeit", label: "Sichtbarkeit" },
	{ id: "auftraege", label: "Aufträge" },
];

interface Props {
	sites: SiteSummary[];
	siteId: string | null;
	onSite: (id: string) => void;
	tab: Tab;
	onTab: (tab: Tab) => void;
	status: StatusInfo | null;
	adapter: { id: string; label: string } | null;
}

export function TopBar({
	sites,
	siteId,
	onSite,
	tab,
	onTab,
	status,
	adapter,
}: Props) {
	const test = adapter?.id === "testmodus";
	return (
		<header className="topbar">
			<div className="topbar__brand">
				<img src="/favicon.svg" alt="" width="28" height="28" />
				<span>WEBSI</span>
			</div>
			<label className="site-select">
				<span className="visually-hidden">Aktive Website</span>
				<select value={siteId ?? ""} onChange={(e) => onSite(e.target.value)}>
					{sites.map((s) => (
						<option key={s.id} value={s.id}>
							{s.name}
						</option>
					))}
				</select>
			</label>
			<nav className="tabs" aria-label="Bereiche">
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						className="tabs__tab"
						aria-current={tab === t.id ? "page" : undefined}
						onClick={() => onTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</nav>
			{adapter && (
				<span
					className={`agent-pill ${test ? "agent-pill--test" : ""}`}
					title={status?.adapters
						.map(
							(a) =>
								`${a.label}: ${a.ready ? "bereit" : a.planned ? "geplant" : "nicht verbunden"}`,
						)
						.join("\n")}
				>
					<span className="agent-pill__dot" aria-hidden="true" />
					{test ? "Testmodus" : adapter.label}
				</span>
			)}
		</header>
	);
}
