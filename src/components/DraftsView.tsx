import { useEffect, useId, useRef } from "react";
import { isBridgeMessage } from "../../core/bridge/protocol";
import type { Draft } from "../../core/drafts";
import { previewKey } from "../../core/preview";
import type { ChangeRequest, SiteProfile } from "../../core/types";

interface Props {
	request: ChangeRequest;
	profile: SiteProfile;
	drafts: Draft[];
	busy: boolean;
	onChoose: (draft: Draft) => void;
	onClose: () => void;
}

/**
 * Mehrere Entwürfe nebeneinander, am Handy zum Wischen. Jede Spalte zeigt die
 * Vorschau in Handy-Breite, verkleinert. „Diese nehmen“ verwirft die anderen.
 */
export function DraftsView({
	request,
	profile,
	drafts,
	busy,
	onChoose,
	onClose,
}: Props) {
	const titleId = useId();
	const row = useRef<HTMLOListElement>(null);
	const path = request.pagePath || profile.editorPath;

	// Vorschau in Handy-Breite (390 px) auf die Kartenbreite verkleinern.
	useEffect(() => {
		const el = row.current;
		const card = el?.querySelector<HTMLElement>(".drafts__card");
		if (!el || !card) return;
		const scale = () =>
			el.style.setProperty("--scale", String(card.clientWidth / 390));
		scale();
		const ro = new ResizeObserver(scale);
		ro.observe(card);
		return () => ro.disconnect();
	}, []);

	// Jede Vorschau ohne Leisten vorbereiten und zum Abschnitt springen.
	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (!isBridgeMessage(e.data) || e.data.type !== "websi:hello") return;
			const frames = row.current?.querySelectorAll("iframe") ?? [];
			const from = [...frames].find((f) => f.contentWindow === e.source);
			const post = (msg: unknown) => from?.contentWindow?.postMessage(msg, "*");
			if (!from) return;
			post({
				type: "websi:config",
				sections: profile.sections,
				preview: profile.preview,
				mode: "compare",
			});
			setTimeout(
				() =>
					post({
						type: "websi:scrollTo",
						sectionId: request.sectionId,
						smooth: false,
					}),
				600,
			);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [profile, request.sectionId]);

	useEffect(() => {
		// Escape schließt nur diese Ansicht, nicht das Auftragsfenster dahinter.
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopImmediatePropagation();
			onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	return (
		<div
			className="drafts"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
		>
			<header className="compare__head">
				<div className="compare__title">
					<h2 id={titleId}>{drafts.length} Entwürfe</h2>
					<p className="muted small">{request.text}</p>
				</div>
				<button
					type="button"
					className="icon-btn"
					onClick={onClose}
					aria-label="Schließen"
				>
					×
				</button>
			</header>
			<ol className="drafts__row" ref={row}>
				{drafts.map((d) => {
					const key = previewKey(profile, d.previewUrl);
					return (
						<li key={d.branch} className="drafts__card">
							<div className="drafts__card-head">
								<h3>{d.name}</h3>
								<button
									type="button"
									className="btn btn--primary btn--small"
									disabled={busy}
									onClick={() => onChoose(d)}
								>
									Diese nehmen
								</button>
							</div>
							{key ? (
								<div className="drafts__screen">
									<iframe
										title={`Entwurf ${d.name}`}
										src={`/proxy/${key}${path}`}
										loading="lazy"
									/>
								</div>
							) : (
								<p className="drafts__empty muted small">
									Noch keine Vorschau. Sie entsteht, sobald Cloudflare den
									Entwurf gebaut hat.
								</p>
							)}
							<p className="small drafts__links">
								{d.previewUrl && (
									<a href={d.previewUrl} target="_blank" rel="noreferrer">
										Groß öffnen
									</a>
								)}
								<a href={d.proposalUrl} target="_blank" rel="noreferrer">
									Änderung im Code
								</a>
							</p>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
