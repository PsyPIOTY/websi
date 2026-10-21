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
	const worst = [
		...usage.engines.map((e) => e.level),
		usage.github.level,
	].includes("erreicht")
		? "erreicht"
		: [...usage.engines.map((e) => e.level), usage.github.level].includes(
					"knapp",
				)
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
					<h2>Kontingent</h2>
					<p className="muted small">
						Das Abo verrät sein Limit nicht. WEBSI zählt, was es losschickt, und
						warnt ab 80 % deines Richtwerts.
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
