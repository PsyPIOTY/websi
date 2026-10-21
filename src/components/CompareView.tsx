import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type AppToBridge, isBridgeMessage } from "../../core/bridge/protocol";
import { previewKey } from "../../core/preview";
import type { ChangeRequest, SiteProfile } from "../../core/types";

type Mode = "schieber" | "vorher" | "nachher";
type Device = "handy" | "desktop";

interface Props {
	request: ChangeRequest;
	profile: SiteProfile;
	onClose: () => void;
}

/**
 * Vorher/Nachher: links die Website, wie sie live ist, rechts der Vorschlag.
 * Der Schieber legt beide Fassungen übereinander; beide scrollen gemeinsam.
 */
export function CompareView({ request, profile, onClose }: Props) {
	const before = useRef<HTMLIFrameElement>(null);
	const after = useRef<HTMLIFrameElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState(50);
	const [mode, setMode] = useState<Mode>("schieber");
	const [device, setDevice] = useState<Device>(() =>
		window.innerWidth < 700 ? "handy" : "desktop",
	);
	const titleId = useId();
	const sliderId = useId();
	const previewUrl = request.external?.previewUrl;
	const afterKey = previewKey(profile, previewUrl);
	const sameAsLive = afterKey === profile.id;
	const path = request.pagePath || profile.editorPath;
	const srcBefore = `/proxy/${profile.id}${path}`;
	const srcAfter = afterKey ? `/proxy/${afterKey}${path}` : null;

	const post = useCallback(
		(frame: HTMLIFrameElement | null, msg: AppToBridge) =>
			frame?.contentWindow?.postMessage(msg, "*"),
		[],
	);

	useEffect(() => {
		const frames = () => [before.current, after.current];
		const onMessage = (e: MessageEvent) => {
			if (!isBridgeMessage(e.data)) return;
			const [a, b] = frames();
			const from =
				e.source === a?.contentWindow
					? a
					: e.source === b?.contentWindow
						? b
						: null;
			if (!from) return;
			const other = from === a ? b : a;
			if (e.data.type === "websi:hello") {
				post(from, {
					type: "websi:config",
					sections: profile.sections,
					preview: profile.preview,
					mode: "compare",
				});
				// Erst nach dem Aufbau der Seite zum Abschnitt springen.
				setTimeout(
					() =>
						post(from, {
							type: "websi:scrollTo",
							sectionId: request.sectionId,
							smooth: false,
						}),
					600,
				);
			} else if (e.data.type === "websi:scroll") {
				post(other, { type: "websi:scrollY", y: e.data.y });
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [post, profile, request.sectionId]);

	useEffect(() => {
		// Escape schließt nur den Vergleich, nicht das Auftragsfenster dahinter.
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopImmediatePropagation();
			onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	// Griff ziehen: Position aus dem Zeiger relativ zur Bühne.
	const drag = (e: React.PointerEvent<HTMLDivElement>) => {
		const box = stage.current?.getBoundingClientRect();
		if (!box || !(e.buttons & 1)) return;
		setPos(
			Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)),
		);
	};

	const clip = mode === "vorher" ? 100 : mode === "nachher" ? 0 : pos;

	return (
		<div
			className="compare"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
		>
			<header className="compare__head">
				<div className="compare__title">
					<h2 id={titleId}>Vorher / Nachher</h2>
					<p className="muted small">{request.text}</p>
				</div>
				<fieldset className="segmented">
					<legend className="visually-hidden">Ansicht</legend>
					{(["vorher", "schieber", "nachher"] as Mode[]).map((m) => (
						<button
							key={m}
							type="button"
							aria-pressed={mode === m}
							onClick={() => setMode(m)}
						>
							{m === "vorher"
								? "Vorher"
								: m === "nachher"
									? "Nachher"
									: "Schieber"}
						</button>
					))}
				</fieldset>
				<fieldset className="segmented">
					<legend className="visually-hidden">Gerät</legend>
					{(["handy", "desktop"] as Device[]).map((d) => (
						<button
							key={d}
							type="button"
							aria-pressed={device === d}
							onClick={() => setDevice(d)}
						>
							{d === "handy" ? "Handy" : "Desktop"}
						</button>
					))}
				</fieldset>
				{previewUrl && (
					<a
						href={previewUrl}
						target="_blank"
						rel="noreferrer"
						className="small"
					>
						Vorschau einzeln öffnen
					</a>
				)}
				<button
					type="button"
					className="icon-btn"
					onClick={onClose}
					aria-label="Schließen"
				>
					×
				</button>
			</header>

			{!srcAfter ? (
				<div className="compare__empty">
					<p>
						Für diesen Vorschlag gibt es noch keine Vorschau-Version.
						{previewUrl
							? " Die Vorschau liegt unter einer fremden Adresse und lässt sich nur einzeln öffnen."
							: " Sie entsteht, sobald die Website in Cloudflare mit „Workers Builds“ verbunden ist (siehe Anleitung zum Worker)."}
					</p>
				</div>
			) : (
				<>
					{sameAsLive && (
						<p className="banner compare__note">
							Testmodus: Beide Seiten zeigen die Live-Fassung. Mit echtem Worker
							steht rechts der Vorschlag.
						</p>
					)}
					<div className="compare__wrap">
						<div
							ref={stage}
							className="compare__stage"
							style={{ width: device === "handy" ? "390px" : "100%" }}
						>
							<iframe
								ref={before}
								className="compare__frame"
								title="Vorher: Live-Fassung"
								src={srcBefore}
							/>
							<iframe
								ref={after}
								className="compare__frame compare__frame--after"
								title="Nachher: Vorschlag"
								src={srcAfter}
								style={{ clipPath: `inset(0 0 0 ${clip}%)` }}
							/>
							{mode === "schieber" && (
								<div
									className="compare__handle"
									style={{ left: `${pos}%` }}
									onPointerDown={(e) => {
										e.currentTarget.setPointerCapture(e.pointerId);
										drag(e);
									}}
									onPointerMove={drag}
									aria-hidden="true"
								>
									<span className="compare__grip">⇆</span>
								</div>
							)}
							<span className="compare__tag compare__tag--before">Vorher</span>
							<span className="compare__tag compare__tag--after">Nachher</span>
						</div>
					</div>
					{mode === "schieber" && (
						<div className="compare__slider">
							<label htmlFor={sliderId} className="small">
								Trennlinie
							</label>
							<input
								id={sliderId}
								type="range"
								min={0}
								max={100}
								value={Math.round(pos)}
								onChange={(e) => setPos(Number(e.target.value))}
							/>
						</div>
					)}
				</>
			)}
		</div>
	);
}
