import { useEffect, useId, useRef, useState } from "react";
import type { EngineUsage, UsageSummary } from "../../core/usage";
import { api } from "../api";

const levelText: Record<EngineUsage["level"], string> = {
	ok: "im Rahmen",
	knapp: "wird knapp",
	erreicht: "Richtwert erreicht",
};

/** Kontingent: Läufe je Modell und Actions-Minuten, mit Peters Richtwerten. */
export function UsageMenu({
	usage,
	onUsage,
}: {
	usage: UsageSummary;
	onUsage: (u: UsageSummary) => void;
}) {
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const box = useRef<HTMLDivElement>(null);
	const main = usage.engines.find((e) => e.id === "claude") ?? usage.engines[0];
	const cf = usage.cloudflare;
	const cfRows = cf && "rows" in cf ? cf.rows : [];
	const levels = [
		...usage.engines.map((e) => e.level),
		usage.github.level,
		...cfRows.map((r) => r.level),
	];
	const worst = levels.includes("erreicht")
		? "erreicht"
		: levels.includes("knapp")
			? "knapp"
			: "ok";

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (!box.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const setLimit = async (id: string, value: number | null) => {
		const limits = Object.fromEntries(
			usage.engines.map((e) => [e.id, e.limit]),
		);
		limits[id] = value;
		await api.setLimits(limits);
		onUsage(await api.usage());
	};

	return (
		<div className="usage" ref={box}>
			<button
				type="button"
				className={`usage__pill usage__pill--${worst}`}
				aria-expanded={open}
				aria-controls={panelId}
				aria-label={`Kontingent: ${main.label} ${main.today} heute`}
				onClick={() => setOpen((o) => !o)}
			>
				<span className="usage__dot" aria-hidden="true" />
				<span className="usage__name">{main.label} </span>
				{main.today}
				{main.limit ? `/${main.limit}` : ""}
				<span className="usage__name"> heute</span>
			</button>
			{open && (
				<div className="usage__panel" id={panelId}>
					<h2>Kostenwächter</h2>
					<p className="muted small">
						WEBSI zählt alles, was Geld kosten könnte, warnt ab 80 % und schickt
						bei 100 % nichts mehr los. Das Abo verrät sein Limit nicht, darum
						gilt dort dein Richtwert.
					</p>
					<table className="usage__table">
						<thead>
							<tr>
								<th scope="col">Modell</th>
								<th scope="col">Heute</th>
								<th scope="col">5 Std.</th>
								<th scope="col">Richtwert/Tag</th>
							</tr>
						</thead>
						<tbody>
							{usage.engines.map((e) => (
								<tr key={e.id} className={`usage__row--${e.level}`}>
									<th scope="row">
										{e.label}
										<span className="muted small"> · {levelText[e.level]}</span>
									</th>
									<td>{e.today}</td>
									<td>{e.last5h}</td>
									<td>
										<LimitInput
											label={`Richtwert für ${e.label}`}
											value={e.limit}
											onSave={(v) => setLimit(e.id, v)}
										/>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<div className="usage__minutes">
						<div className="usage__minutes-head">
							<span>GitHub-Actions-Minuten diesen Monat</span>
							<strong>
								{usage.github.minutesMonth} / {usage.github.free}
							</strong>
						</div>
						<div className="meter" aria-hidden="true">
							<span
								className={`meter__fill meter__fill--${usage.github.level}`}
								style={{
									width: `${Math.min(100, (usage.github.minutesMonth / usage.github.free) * 100)}%`,
								}}
							/>
						</div>
						<p className="muted small">
							Frei für private Repos. Zählt nur Läufe des Workers in GitHub.
						</p>
					</div>
					<div className="usage__minutes">
						<div className="usage__minutes-head">
							<span>Cloudflare heute (frei)</span>
						</div>
						{cf === null || cf === undefined ? (
							<p className="muted small">
								Erscheint, sobald der Lese-Schlüssel für die Hinweise
								eingetragen ist.
							</p>
						) : "error" in cf ? (
							<p className="muted small">Nicht abrufbar: {cf.error}</p>
						) : (
							cfRows.map((r) => (
								<div key={r.id} className="usage__cf">
									<div className="usage__minutes-head">
										<span className="small">{r.label}</span>
										<strong className="small">
											{r.used.toLocaleString("de-DE")} /{" "}
											{r.free.toLocaleString("de-DE")}
										</strong>
									</div>
									<div className="meter" aria-hidden="true">
										<span
											className={`meter__fill meter__fill--${r.level}`}
											style={{
												width: `${Math.min(100, (r.used / r.free) * 100)}%`,
											}}
										/>
									</div>
								</div>
							))
						)}
					</div>
					<details className="usage__safety">
						<summary>Was sonst Geld kosten könnte</summary>
						<ul className="small">
							<li>
								GitHub: Ausgabenlimit für Actions auf 0 € lassen (Settings →
								Billing). Dann stoppt GitHub bei 2.000 Minuten, statt zu
								berechnen.
							</li>
							<li>
								Claude: Im Konto keine bezahlte Zusatznutzung einschalten. Dann
								wartet Claude am Abo-Limit, statt zu berechnen.
							</li>
							<li>
								Cloudflare: Beim Plan „Free“ bleiben. Workers und Datenbank
								stoppen an der freien Grenze, statt zu berechnen.
							</li>
							<li>
								Zero Trust: Plan „Free“ gilt bis 50 Personen, du bist einer. Die
								hinterlegte Zahlungsart wird dabei nicht belastet.
							</li>
						</ul>
					</details>
				</div>
			)}
		</div>
	);
}

function LimitInput({
	label,
	value,
	onSave,
}: {
	label: string;
	value: number | null;
	onSave: (v: number | null) => void;
}) {
	const [text, setText] = useState(value === null ? "" : String(value));
	useEffect(() => setText(value === null ? "" : String(value)), [value]);
	const commit = () => {
		const n = Number.parseInt(text, 10);
		const next = Number.isFinite(n) && n > 0 ? n : null;
		if (next !== value) onSave(next);
	};
	return (
		<input
			className="usage__limit"
			inputMode="numeric"
			aria-label={label}
			placeholder="offen"
			value={text}
			onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
			onBlur={commit}
			onKeyDown={(e) => e.key === "Enter" && commit()}
		/>
	);
}
