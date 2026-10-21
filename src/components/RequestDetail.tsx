import { useEffect, useId, useRef, useState } from "react";
import {
	type ChangeRequest,
	type SiteProfile,
	WHOLE_PAGE,
} from "../../core/types";
import { api } from "../api";
import { StatusChip } from "./StatusChip";

interface Props {
	request: ChangeRequest;
	profile: SiteProfile;
	onChange: (r: ChangeRequest) => void;
	onClose: () => void;
}

const when = (iso: string) =>
	new Date(iso).toLocaleString("de-DE", {
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});

export function RequestDetail({
	request: r,
	profile,
	onChange,
	onClose,
}: Props) {
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [confirm, setConfirm] = useState(false);
	const panel = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const followId = useId();
	const section =
		profile.sections.find((s) => s.id === r.sectionId) ?? WHOLE_PAGE;

	useEffect(() => {
		panel.current?.focus();
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: beim Wechsel des Auftrags zurücksetzen
	useEffect(() => {
		setConfirm(false);
		setError(null);
	}, [r.id]);

	const run = async (label: string, fn: () => Promise<ChangeRequest>) => {
		setBusy(label);
		setError(null);
		try {
			onChange(await fn());
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(null);
		}
	};

	const active = r.status === "in_arbeit" || r.status === "vorschlag";

	return (
		<div
			className="drawer"
			role="dialog"
			aria-modal="false"
			aria-labelledby={titleId}
		>
			<div className="drawer__panel" ref={panel} tabIndex={-1}>
				<div className="drawer__head">
					<div>
						<p className="muted small">
							{profile.name} · {section.label}
						</p>
						<h2 id={titleId}>
							<StatusChip status={r.status} />
						</h2>
					</div>
					<button
						type="button"
						className="icon-btn"
						onClick={onClose}
						aria-label="Schließen"
					>
						×
					</button>
				</div>

				<blockquote className="drawer__text">{r.text}</blockquote>
				{r.pin && (
					<p className="muted small">
						Markierte Stelle: {Math.round(r.pin.x)} % / {Math.round(r.pin.y)} %
						{r.pin.hint ? ` bei „${r.pin.hint}“` : ""}
					</p>
				)}

				<div className="drawer__links">
					{r.external?.url && (
						<a href={r.external.url} target="_blank" rel="noreferrer">
							Auftrag in GitHub
						</a>
					)}
					{r.external?.proposalUrl && (
						<a href={r.external.proposalUrl} target="_blank" rel="noreferrer">
							Vorschlag ansehen
						</a>
					)}
				</div>

				<div className="drawer__actions">
					{r.status === "offen" && (
						<button
							type="button"
							className="btn btn--primary"
							disabled={!!busy}
							onClick={() => run("send", () => api.action(r.id, "send"))}
						>
							{busy === "send" ? "Wird gesendet …" : "An den Agenten senden"}
						</button>
					)}
					{active && (
						<button
							type="button"
							className="btn"
							disabled={!!busy}
							onClick={() => run("sync", () => api.action(r.id, "sync"))}
						>
							{busy === "sync" ? "Gleiche ab …" : "Stand abfragen"}
						</button>
					)}
					{r.status === "vorschlag" &&
						(confirm ? (
							<span className="confirm">
								<span>Wirklich live stellen?</span>
								<button
									type="button"
									className="btn btn--primary"
									disabled={!!busy}
									onClick={() =>
										run("publish", () => api.action(r.id, "publish"))
									}
								>
									{busy === "publish"
										? "Veröffentliche …"
										: "Ja, veröffentlichen"}
								</button>
								<button
									type="button"
									className="btn"
									onClick={() => setConfirm(false)}
								>
									Abbrechen
								</button>
							</span>
						) : (
							<button
								type="button"
								className="btn btn--primary"
								onClick={() => setConfirm(true)}
							>
								Veröffentlichen
							</button>
						))}
					{(r.status === "offen" || active) && (
						<button
							type="button"
							className="btn btn--quiet"
							disabled={!!busy}
							onClick={() => run("discard", () => api.action(r.id, "discard"))}
						>
							Verwerfen
						</button>
					)}
					{r.status === "verworfen" && (
						<button
							type="button"
							className="btn"
							disabled={!!busy}
							onClick={() => run("reopen", () => api.action(r.id, "reopen"))}
						>
							Wieder öffnen
						</button>
					)}
				</div>

				{active && (
					<form
						className="followup"
						onSubmit={(e) => {
							e.preventDefault();
							const t = text.trim();
							if (!t) return;
							run("follow", () => api.followUp(r.id, t)).then(() =>
								setText(""),
							);
						}}
					>
						<label htmlFor={followId}>Nachbessern</label>
						<textarea
							id={followId}
							rows={2}
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Was soll am Vorschlag anders werden?"
						/>
						<button
							type="submit"
							className="btn"
							disabled={!text.trim() || !!busy}
						>
							Nachricht senden
						</button>
					</form>
				)}

				{error && (
					<p className="banner banner--error" role="alert">
						{error}
					</p>
				)}

				<h3 className="drawer__sub">Verlauf</h3>
				<ol className="timeline">
					{[...r.events].reverse().map((e, i) => (
						<li
							key={`${e.at}-${i}`}
							className={`timeline__item timeline__item--${e.kind}`}
						>
							<span className="muted small">
								{when(e.at)} ·{" "}
								{e.by === "peter" ? "Du" : e.by === "websi" ? "WEBSI" : "Agent"}
							</span>
							<p>{e.text}</p>
							{e.url && (
								<a
									className="small"
									href={e.url}
									target="_blank"
									rel="noreferrer"
								>
									Öffnen
								</a>
							)}
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}
