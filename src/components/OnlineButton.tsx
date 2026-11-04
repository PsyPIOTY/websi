import { useCallback, useEffect, useId, useState } from "react";
import type { OnlineStatus } from "../../core/online";
import type { SiteProfile } from "../../core/types";
import { api } from "../api";

const fmt = (iso: string) =>
	new Date(iso).toLocaleString("de-DE", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Europe/Berlin",
	});

const BUILD_NOTE: Record<string, string> = {
	laeuft: "Cloudflare baut sie noch; der Mac mini wartet darauf.",
	fehler:
		"Cloudflare konnte diese Fassung nicht bauen. Paco schaut es sich an.",
};

/** Knopf „Online stellen“ (nur in WEBSI, Peter 3.11.2026, Anleitung C1–C4). */
export function OnlineButton({ profile }: { profile: SiteProfile }) {
	const [open, setOpen] = useState(false);
	if (!profile.online) return null;
	return (
		<>
			<button
				type="button"
				className="btn btn--small online__open"
				onClick={() => setOpen(true)}
			>
				Online stellen
			</button>
			{open && (
				<OnlineDialog profile={profile} onClose={() => setOpen(false)} />
			)}
		</>
	);
}

function OnlineDialog({
	profile,
	onClose,
}: {
	profile: SiteProfile;
	onClose: () => void;
}) {
	const titleId = useId();
	const [st, setSt] = useState<OnlineStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirm, setConfirm] = useState(false);
	const [busy, setBusy] = useState(false);
	const domain = profile.online?.domain ?? "";

	const load = useCallback(() => {
		api.online(profile.id).then(
			(s) => {
				setSt(s);
				setError(null);
			},
			(e: Error) => setError(e.message),
		);
	}, [profile.id]);

	useEffect(() => {
		load();
	}, [load]);

	// Solange der Mac mini dran ist, alle 30 Sekunden nachsehen.
	useEffect(() => {
		if (!st?.pending) return;
		const t = setInterval(() => {
			if (!document.hidden) load();
		}, 30000);
		return () => clearInterval(t);
	}, [st?.pending, load]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	async function go() {
		setBusy(true);
		try {
			setSt(await api.goOnline(profile.id));
			setError(null);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
			setConfirm(false);
		}
	}

	const stand = st?.stand;
	const blocked =
		!st?.ready || Boolean(st?.pending) || stand?.build === "fehler" || busy;

	return (
		<div
			className="online"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
		>
			<div className="online__card">
				<header className="online__head">
					<h2 id={titleId}>{domain} online stellen</h2>
					<button
						type="button"
						className="icon-btn"
						onClick={onClose}
						aria-label="Schließen"
					>
						×
					</button>
				</header>

				{error && (
					<p className="banner banner--error" role="alert">
						{error}
					</p>
				)}
				{!st && !error && <p className="muted">Wird geladen …</p>}

				{st && (
					<>
						<dl className="online__facts">
							<dt>Online</dt>
							<dd>
								{st.lastOnline
									? `seit ${fmt(st.lastOnline.at)}`
									: "noch nie über WEBSI"}
							</dd>
							<dt>Letzte Änderung hier</dt>
							<dd>
								{stand ? (
									<>
										{fmt(stand.at)} · {stand.message}
										{BUILD_NOTE[stand.build] && (
											<span className="online__hint">
												{BUILD_NOTE[stand.build]}
											</span>
										)}
									</>
								) : (
									"unbekannt"
								)}
							</dd>
						</dl>

						{st.pending && (
							<p className="online__note" aria-live="polite">
								Der Mac mini stellt gerade online, das dauert bis zu 10 Minuten.{" "}
								<a href={st.pending.url} target="_blank" rel="noreferrer">
									Auftrag ansehen
								</a>
							</p>
						)}
						{!st.pending && st.last && !st.last.ok && (
							<p className="online__note online__note--bad">
								Letzter Versuch hat nicht geklappt: {st.last.text}
							</p>
						)}
						{!st.ready && st.reason && (
							<p className="online__note">{st.reason}</p>
						)}

						<div className="online__actions">
							{confirm ? (
								<>
									<span className="online__ask">Wirklich online stellen?</span>
									<button
										type="button"
										className="btn btn--primary"
										disabled={busy}
										onClick={go}
									>
										{busy ? "Wird beauftragt …" : "Ja, online stellen"}
									</button>
									<button
										type="button"
										className="btn"
										onClick={() => setConfirm(false)}
									>
										Abbrechen
									</button>
								</>
							) : (
								<button
									type="button"
									className="btn btn--primary"
									disabled={blocked}
									onClick={() => setConfirm(true)}
								>
									Online stellen
								</button>
							)}
						</div>
						<p className="muted small">
							„Veröffentlichen“ bei einem Wunsch ändert nur den Entwurf. Erst
							dieser Knopf bringt die neueste Fassung auf {domain}.
						</p>
					</>
				)}
			</div>
		</div>
	);
}
