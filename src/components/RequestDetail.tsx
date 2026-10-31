import { useEffect, useId, useRef, useState } from "react";
import {
	type EngineId,
	type EngineInfo,
	engineLabel,
} from "../../core/engines";
import {
	type ChangeRequest,
	type SiteProfile,
	WHOLE_PAGE,
} from "../../core/types";
import { type ActionResult, api, withRelated } from "../api";
import { draftNames } from "../drafts";
import { DraftsView } from "./DraftsView";
import { EngineSelect } from "./EngineSelect";
import { StatusChip } from "./StatusChip";

interface Props {
	request: ChangeRequest;
	profile: SiteProfile;
	/** Alle Wünsche desselben Sammelauftrags (inklusive diesem). */
	siblings: ChangeRequest[];
	engines: EngineInfo[];
	engine: EngineId;
	onChange: (list: ChangeRequest[]) => void;
	onCompare: () => void;
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
	siblings,
	engines,
	engine,
	onChange,
	onCompare,
	onClose,
}: Props) {
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [rememberFollow, setRememberFollow] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const [discarding, setDiscarding] = useState(false);
	const [reason, setReason] = useState("");
	const [rememberReason, setRememberReason] = useState(true);
	const [sendEngine, setSendEngine] = useState<EngineId>(r.engine ?? engine);
	const [sendMulti, setSendMulti] = useState(false);
	const [showDrafts, setShowDrafts] = useState(false);
	const panel = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const followId = useId();
	const reasonId = useId();
	const label = (id: string) =>
		profile.sections.find((s) => s.id === id)?.label ?? WHOLE_PAGE.label;
	const batch = siblings.length > 1;
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
		setDiscarding(false);
		setError(null);
	}, [r.id]);

	const run = async (what: string, fn: () => Promise<ActionResult>) => {
		setBusy(what);
		setError(null);
		try {
			onChange(withRelated(await fn()));
			return true;
		} catch (e) {
			setError((e as Error).message);
			return false;
		} finally {
			setBusy(null);
		}
	};

	const active = r.status === "in_arbeit" || r.status === "vorschlag";
	const drafts = r.external?.chosen ? [] : (r.external?.drafts ?? []);
	const picking = r.status === "vorschlag" && drafts.length > 0;
	const choose = (branch: string) =>
		run("choose", () => api.choose(r.id, branch)).then(
			(ok) => ok && setShowDrafts(false),
		);

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
				<p className="muted small">
					{r.external
						? `KI: ${engineLabel(r.engine ?? "claude")}`
						: "Noch nicht gesendet"}
				</p>
				{batch && (
					<div className="batch-box">
						<p className="small">
							<strong>Sammelauftrag mit {siblings.length} Wünschen.</strong> Ein
							gemeinsamer Vorschlag; Veröffentlichen und Verwerfen gelten für
							alle.
						</p>
						<ul>
							{siblings.map((x) => (
								<li key={x.id} className="small">
									<span className="muted">{label(x.sectionId)}:</span> {x.text}
								</li>
							))}
						</ul>
					</div>
				)}
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
							Änderung im Code
						</a>
					)}
					{r.external?.previewUrl && (
						<a href={r.external.previewUrl} target="_blank" rel="noreferrer">
							Vorschau öffnen
						</a>
					)}
				</div>
				{picking && (
					<div className="draft-box">
						<p>
							<strong>{drafts.length} Entwürfe liegen bereit.</strong> Nimm
							einen, die anderen werden verworfen.
						</p>
						<button
							type="button"
							className="btn btn--primary"
							onClick={() => setShowDrafts(true)}
						>
							Entwürfe ansehen und wählen
						</button>
						<span className="send-row">
							{drafts.map((d) => (
								<button
									key={d.branch}
									type="button"
									className="btn btn--small"
									disabled={!!busy}
									onClick={() => choose(d.branch)}
								>
									„{d.name}“ nehmen
								</button>
							))}
						</span>
					</div>
				)}
				{showDrafts && picking && (
					<DraftsView
						request={r}
						profile={profile}
						drafts={drafts}
						busy={!!busy}
						onChoose={(d) => choose(d.branch)}
						onClose={() => setShowDrafts(false)}
					/>
				)}
				{!picking &&
					(r.status === "vorschlag" || r.status === "veroeffentlicht") &&
					r.external?.previewUrl && (
						<button
							type="button"
							className="btn compare-btn"
							onClick={onCompare}
						>
							Vorher / Nachher vergleichen
						</button>
					)}

				<div className="drawer__actions">
					{r.status === "offen" && (
						<span className="send-row">
							<EngineSelect
								engines={engines}
								value={sendEngine}
								onChange={setSendEngine}
							/>
							<button
								type="button"
								className="btn btn--primary"
								disabled={!!busy}
								onClick={() =>
									run("send", () =>
										api.action(r.id, "send", {
											engine: sendEngine,
											drafts: sendMulti ? draftNames() : undefined,
										}),
									)
								}
							>
								{busy === "send" ? "Wird gesendet …" : "Einzeln senden"}
							</button>
							<label className="check">
								<input
									type="checkbox"
									checked={sendMulti}
									onChange={(e) => setSendMulti(e.target.checked)}
								/>
								{draftNames().length} Entwürfe
							</label>
						</span>
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
						!picking &&
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
										: batch
											? `Ja, alle ${siblings.length} veröffentlichen`
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
					{(r.status === "offen" || active) && !discarding && (
						<button
							type="button"
							className="btn btn--quiet"
							disabled={!!busy}
							onClick={() => setDiscarding(true)}
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

				{discarding && (
					<form
						className="followup discard"
						onSubmit={(e) => {
							e.preventDefault();
							run("discard", () =>
								api.discard(
									r.id,
									reason.trim(),
									rememberReason && !!reason.trim(),
								),
							).then((ok) => ok && setDiscarding(false));
						}}
					>
						<label htmlFor={reasonId}>
							Warum verwerfen? <span className="muted">(freiwillig)</span>
						</label>
						<textarea
							id={reasonId}
							rows={2}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="z. B. zu werblich, zu lang"
						/>
						<label className="check">
							<input
								type="checkbox"
								checked={rememberReason}
								onChange={(e) => setRememberReason(e.target.checked)}
							/>
							Grund als Stilregel merken
						</label>
						{batch && (
							<p className="muted small">
								Verwirft den ganzen Sammelauftrag ({siblings.length} Wünsche).
							</p>
						)}
						<span className="send-row">
							<button type="submit" className="btn" disabled={!!busy}>
								{busy === "discard" ? "Verwerfe …" : "Verwerfen"}
							</button>
							<button
								type="button"
								className="btn btn--quiet"
								onClick={() => setDiscarding(false)}
							>
								Abbrechen
							</button>
						</span>
					</form>
				)}

				{active && !picking && (
					<form
						className="followup"
						onSubmit={(e) => {
							e.preventDefault();
							const t = text.trim();
							if (!t) return;
							run("follow", () => api.followUp(r.id, t, rememberFollow)).then(
								(ok) => ok && setText(""),
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
						<label className="check">
							<input
								type="checkbox"
								checked={rememberFollow}
								onChange={(e) => setRememberFollow(e.target.checked)}
							/>
							Als Stilregel merken (gilt künftig für jeden Auftrag)
						</label>
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
