import { useState } from "react";
import { topMeasures } from "../../core/seo/measures";
import type {
	ChangeRequest,
	CheckCategory,
	CheckResult,
	DirectoryStatus,
	VisibilityReport,
} from "../../core/types";
import { api, type SiteData } from "../api";

interface Props {
	data: SiteData;
	onReport: (report: VisibilityReport, history: SiteData["history"]) => void;
	onCreated: (r: ChangeRequest) => void;
	onDirectories: () => void;
}

const categories: CheckCategory[] = ["Technik", "Inhalte", "Lokal", "KI-Suche"];
const levelText = {
	ok: "In Ordnung",
	warnung: "Verbessern",
	fehler: "Fehlt",
} as const;

export function VisibilityView({
	data,
	onReport,
	onCreated,
	onDirectories,
}: Props) {
	const { report, history, profile } = data;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState<Record<string, boolean>>({});

	const scan = async () => {
		setBusy(true);
		setError(null);
		try {
			const r = await api.scan(profile.id);
			onReport(
				r,
				[...history, { scannedAt: r.scannedAt, score: r.score }].slice(-20),
			);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const toRequest = async (c: CheckResult) => {
		if (!c.fix) return;
		try {
			const r = await api.createRequest({
				siteId: profile.id,
				sectionId: c.sectionId ?? "ganze-seite",
				text: `${c.fix}\n\n(Aus dem Sichtbarkeits-Check: ${c.title}. ${c.detail})`,
				pagePath: c.page,
			});
			setSent((s) => ({ ...s, [c.id + c.page]: true }));
			onCreated(r);
		} catch (e) {
			setError((e as Error).message);
		}
	};

	const measures = report ? topMeasures(report.checks, 3) : [];
	const issues = report?.checks.filter((c) => c.level !== "ok").length ?? 0;

	return (
		<section className="page">
			<header className="page__head page__head--row">
				<div>
					<h1>Sichtbarkeit</h1>
					<p className="muted">
						Wie gut {profile.name} gefunden wird, und was als Nächstes am
						meisten bringt.
					</p>
				</div>
				<button
					type="button"
					className="btn btn--primary"
					onClick={scan}
					disabled={busy}
				>
					{busy
						? "Prüfe die Seite …"
						: report
							? "Neu prüfen"
							: "Seiten-Check starten"}
				</button>
			</header>

			{error && (
				<p className="banner banner--error" role="alert">
					{error}
				</p>
			)}

			{!report ? (
				<p className="empty">
					Noch kein Check für diese Website. Ein Check dauert wenige Sekunden.
				</p>
			) : (
				<>
					<div className="score-row">
						<div className="score">
							<span className="score__value">{report.score}</span>
							<span className="score__unit">von 100</span>
							<span className="muted small">
								Stand{" "}
								{new Date(report.scannedAt).toLocaleString("de-DE", {
									dateStyle: "short",
									timeStyle: "short",
								})}{" "}
								· {issues} offene Punkte
							</span>
						</div>
						<Sparkline points={history.map((h) => h.score)} />
					</div>

					{report.errors.length > 0 && (
						<p className="banner">
							Nicht alles lesbar: {report.errors.join(" · ")}
						</p>
					)}

					<h2 className="section-title">Die nächsten Schritte</h2>
					{measures.length === 0 ? (
						<p className="empty">
							Alle Grundlagen erfüllt. Jetzt zählen Inhalte und Verlinkungen.
						</p>
					) : (
						<ol className="measures">
							{measures.map((m) => (
								<li
									key={m.id + m.page}
									className={`measure measure--${m.level}`}
								>
									<div>
										<p className="measure__title">{m.title}</p>
										<p className="muted small">{m.detail}</p>
										<p className="measure__fix">{m.fix}</p>
									</div>
									<button
										type="button"
										className="btn"
										disabled={sent[m.id + m.page] || m.id === "gbp"}
										onClick={() => toRequest(m)}
									>
										{m.id === "gbp"
											? "Unter Verzeichnisse"
											: sent[m.id + m.page]
												? "Auftrag gesendet"
												: "Als Auftrag senden"}
									</button>
								</li>
							))}
						</ol>
					)}

					<h2 className="section-title">Suchbegriffe</h2>
					<div className="table-wrap">
						<table className="table">
							<thead>
								<tr>
									<th scope="col">Begriff</th>
									<th scope="col">Im Titel</th>
									<th scope="col">In der H1</th>
									<th scope="col">Im Text</th>
								</tr>
							</thead>
							<tbody>
								{report.keywords.map((k) => (
									<tr key={k.phrase}>
										<th scope="row">{k.phrase}</th>
										<td>{mark(k.inTitle)}</td>
										<td>{mark(k.inH1)}</td>
										<td>{mark(k.inBody)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="muted small">
						Platzierungen und Klicks kommen aus der Google Search Console,
						sobald sie verbunden ist (siehe unten).
					</p>

					<h2 className="section-title">Alle Prüfungen</h2>
					<div className="checks">
						{categories.map((cat) => {
							const list = report.checks.filter((c) => c.category === cat);
							if (!list.length) return null;
							const bad = list.filter((c) => c.level !== "ok").length;
							return (
								<details key={cat} className="checks__group" open={bad > 0}>
									<summary>
										<span>{cat}</span>
										<span className="muted small">
											{bad ? `${bad} offen` : "alles in Ordnung"}
										</span>
									</summary>
									<ul>
										{list.map((c) => (
											<li
												key={c.id + c.page}
												className={`check check--${c.level}`}
											>
												<span
													className={`dot dot--${c.level}`}
													title={levelText[c.level]}
												/>
												<span className="visually-hidden">
													{levelText[c.level]}:
												</span>
												<div>
													<p className="check__title">{c.title}</p>
													<p className="muted small">{c.detail}</p>
												</div>
												{c.level !== "ok" && c.fix && c.id !== "gbp" && (
													<button
														type="button"
														className="btn btn--small"
														disabled={sent[c.id + c.page]}
														onClick={() => toRequest(c)}
													>
														{sent[c.id + c.page] ? "Gesendet" : "Auftrag"}
													</button>
												)}
											</li>
										))}
									</ul>
								</details>
							);
						})}
					</div>
				</>
			)}

			<h2 className="section-title">Verzeichnisse und Profile</h2>
			<p className="muted small">
				Einträge mit gleicher Adresse und Telefonnummer stärken die lokale Suche
				{profile.seo.region ? ` in ${profile.seo.region}` : ""}. Anlegen musst
				du sie selbst; hier hältst du den Stand fest.
			</p>
			<ul className="directories">
				{data.directories.map((d) => (
					<DirectoryRow
						key={d.id}
						siteId={profile.id}
						dir={d}
						onSaved={onDirectories}
					/>
				))}
			</ul>

			<h2 className="section-title">Datenquellen</h2>
			<div className="cards">
				<div className="card">
					<h3>Google Search Console</h3>
					<p className="muted small">Nicht verbunden.</p>
					<p className="small">
						Liefert Klicks, Impressionen und Positionen je Suchbegriff. Zum
						Verbinden: Domain in der Search Console bestätigen, dann den Zugang
						in WEBSI hinterlegen.
					</p>
					<a
						className="small"
						href="https://search.google.com/search-console"
						target="_blank"
						rel="noreferrer"
					>
						Search Console öffnen
					</a>
				</div>
				<div className="card">
					<h3>Google Unternehmensprofil</h3>
					<p className="muted small">
						{profile.seo.googleBusinessProfile
							? "Vorhanden."
							: "Noch nicht angelegt."}
					</p>
					<p className="small">
						Voraussetzung für Google Maps und den Kartenblock in der lokalen
						Suche.
					</p>
					<a
						className="small"
						href="https://business.google.com"
						target="_blank"
						rel="noreferrer"
					>
						Profil anlegen
					</a>
				</div>
			</div>
		</section>
	);
}

const mark = (ok: boolean) => (
	<span className={ok ? "yes" : "no"}>
		<span aria-hidden="true">{ok ? "✓" : "–"}</span>
		<span className="visually-hidden">{ok ? "ja" : "nein"}</span>
	</span>
);

function Sparkline({ points }: { points: number[] }) {
	if (points.length < 2) return null;
	const w = 160;
	const h = 40;
	const step = w / (points.length - 1);
	const d = points
		.map(
			(p, i) =>
				`${i ? "L" : "M"}${(i * step).toFixed(1)} ${(h - (p / 100) * h).toFixed(1)}`,
		)
		.join(" ");
	return (
		<svg
			className="sparkline"
			viewBox={`0 0 ${w} ${h}`}
			width={w}
			height={h}
			role="img"
			aria-label={`Verlauf: ${points.join(", ")}`}
		>
			<path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
		</svg>
	);
}

function DirectoryRow({
	siteId,
	dir,
	onSaved,
}: {
	siteId: string;
	dir: SiteData["directories"][number];
	onSaved: () => void;
}) {
	const [status, setStatus] = useState<DirectoryStatus>(dir.status);
	const save = async (next: DirectoryStatus) => {
		setStatus(next);
		await api
			.setDirectory(siteId, dir.id, next, dir.note)
			.catch(() => setStatus(dir.status));
		onSaved();
	};
	return (
		<li className="directory">
			<a href={dir.url} target="_blank" rel="noreferrer">
				{dir.name}
			</a>
			<select
				value={status}
				onChange={(e) => save(e.target.value as DirectoryStatus)}
				aria-label={`Status ${dir.name}`}
			>
				<option value="offen">Offen</option>
				<option value="beantragt">Beantragt</option>
				<option value="aktiv">Aktiv</option>
			</select>
		</li>
	);
}
