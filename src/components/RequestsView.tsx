import { useMemo, useState } from "react";
import { statusLabels } from "../../core/requests";
import { type RequestStatus, WHOLE_PAGE } from "../../core/types";
import type { SiteData } from "../api";
import { StatusChip } from "./StatusChip";

const filters: (RequestStatus | "alle")[] = [
	"alle",
	"vorschlag",
	"in_arbeit",
	"offen",
	"veroeffentlicht",
	"verworfen",
];

export function RequestsView({
	data,
	onOpen,
}: {
	data: SiteData;
	onOpen: (id: string) => void;
}) {
	const [filter, setFilter] = useState<RequestStatus | "alle">("alle");
	const label = (id: string) =>
		data.profile.sections.find((s) => s.id === id)?.label ?? WHOLE_PAGE.label;
	const counts = useMemo(() => {
		const c: Record<string, number> = { alle: data.requests.length };
		for (const r of data.requests) c[r.status] = (c[r.status] ?? 0) + 1;
		return c;
	}, [data.requests]);
	const list = data.requests.filter(
		(r) => filter === "alle" || r.status === filter,
	);

	return (
		<section className="page">
			<header className="page__head">
				<h1>Aufträge</h1>
				<p className="muted">
					Alle Änderungswünsche für {data.profile.name}. Neueste zuerst.
				</p>
			</header>
			<fieldset className="filters">
				<legend className="visually-hidden">Nach Status filtern</legend>
				{filters.map((f) => (
					<button
						key={f}
						type="button"
						aria-pressed={filter === f}
						onClick={() => setFilter(f)}
					>
						{f === "alle" ? "Alle" : statusLabels[f]}{" "}
						<span className="muted">{counts[f] ?? 0}</span>
					</button>
				))}
			</fieldset>
			{list.length === 0 ? (
				<p className="empty">
					{data.requests.length === 0
						? "Noch keine Aufträge. Im Editor unter einen Abschnitt schreiben, dann erscheint er hier."
						: "Keine Aufträge mit diesem Status."}
				</p>
			) : (
				<ul className="request-list">
					{list.map((r) => (
						<li key={r.id}>
							<button
								type="button"
								className="request-row"
								onClick={() => onOpen(r.id)}
							>
								<StatusChip status={r.status} />
								<span className="request-row__section">
									{label(r.sectionId)}
								</span>
								<span className="request-row__text">{r.text}</span>
								<time className="muted small" dateTime={r.updatedAt}>
									{new Date(r.updatedAt).toLocaleDateString("de-DE", {
										day: "2-digit",
										month: "2-digit",
									})}
								</time>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
