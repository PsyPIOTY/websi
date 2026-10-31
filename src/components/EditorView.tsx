import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AppToBridge, isBridgeMessage } from "../../core/bridge/protocol";
import {
	type EngineId,
	type EngineInfo,
	engineLabel,
} from "../../core/engines";
import { summarizeBySection } from "../../core/requests";
import { type ChangeRequest, WHOLE_PAGE } from "../../core/types";
import { api, type SiteData, withRelated } from "../api";
import { store } from "../local";
import { EngineSelect } from "./EngineSelect";
import { StatusChip } from "./StatusChip";

type Device = "handy" | "tablet" | "desktop";
const widths: Record<Device, string> = {
	handy: "390px",
	tablet: "820px",
	desktop: "100%",
};

interface Props {
	data: SiteData;
	engines: EngineInfo[];
	engine: EngineId;
	onEngine: (e: EngineId) => void;
	onCreated: (r: ChangeRequest) => void;
	onChanged: (list: ChangeRequest[]) => void;
	onOpen: (id: string) => void;
}

/** Gesammelt = noch nicht losgeschickt. */
const isDraft = (r: ChangeRequest) => r.status === "offen" && !r.external;

export function EditorView({
	data,
	engines,
	engine,
	onEngine,
	onCreated,
	onChanged,
	onOpen,
}: Props) {
	const { profile, requests } = data;
	// Sammeln ist der Standard: Wünsche unter mehreren Abschnitten, dann alles auf einmal.
	const [collect, setCollectState] = useState(
		() => store.get("websi.collect") !== "nein",
	);
	const setCollect = (on: boolean) => {
		setCollectState(on);
		store.set("websi.collect", on ? "ja" : "nein");
	};
	const drafts = useMemo(
		() =>
			requests
				.filter(isDraft)
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
		[requests],
	);
	const frame = useRef<HTMLIFrameElement>(null);
	const [device, setDevice] = useState<Device>(() =>
		window.innerWidth < 700 ? "handy" : "desktop",
	);
	const [found, setFound] = useState<string[] | null>(null);
	const [visible, setVisible] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [sheet, setSheet] = useState(false);
	const [pagePath, setPagePath] = useState(profile.editorPath);
	const src = useMemo(
		() => `/proxy/${profile.id}${profile.editorPath}`,
		[profile],
	);

	const post = useCallback(
		(msg: AppToBridge) => frame.current?.contentWindow?.postMessage(msg, "*"),
		[],
	);

	const bySection = useMemo(() => {
		const map: Record<
			string,
			{ id: string; text: string; status: ChangeRequest["status"] }[]
		> = {};
		for (const r of requests) {
			map[r.sectionId] ??= [];
			map[r.sectionId].push({
				id: r.id,
				text: r.text,
				status: r.status,
			});
		}
		return map;
	}, [requests]);
	const summary = useMemo(() => summarizeBySection(requests), [requests]);

	const submit = useCallback(
		async (
			sectionId: string,
			text: string,
			pin?: ChangeRequest["pin"],
			path?: string,
		) => {
			try {
				const r = await api.createRequest({
					siteId: profile.id,
					sectionId,
					text,
					pin,
					pagePath: path ?? pagePath,
					engine,
					send: !collect,
				});
				onCreated(r);
				const failed = r.events.at(-1)?.kind === "fehler";
				setToast(
					failed
						? `Gespeichert, aber nicht gesendet: ${r.events.at(-1)?.text}`
						: collect
							? "Gesammelt. Unten alles auf einmal losschicken."
							: "Gesendet. Der Status erscheint unter dem Abschnitt.",
				);
			} catch (e) {
				setToast(`Nicht gespeichert: ${(e as Error).message}`);
			}
		},
		[profile.id, pagePath, onCreated, engine, collect],
	);

	const [sending, setSending] = useState(false);
	const sendAll = async () => {
		setSending(true);
		try {
			const list = await api.sendBatch(profile.id, engine);
			onChanged(list);
			const failed = list[0]?.events.at(-1)?.kind === "fehler";
			setToast(
				failed
					? `Nicht gesendet: ${list[0]?.events.at(-1)?.text}`
					: `${list.length} Wünsche als ein Auftrag an ${engineLabel(engine)} gegeben.`,
			);
		} catch (e) {
			setToast(`Nicht gesendet: ${(e as Error).message}`);
		} finally {
			setSending(false);
		}
	};
	const dropDraft = async (id: string) => {
		try {
			onChanged(withRelated(await api.discard(id)));
		} catch (e) {
			setToast((e as Error).message);
		}
	};

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.source !== frame.current?.contentWindow || !isBridgeMessage(e.data))
				return;
			const msg = e.data;
			if (msg.type === "websi:hello") {
				post({
					type: "websi:config",
					sections: profile.sections,
					preview: profile.preview,
					mode: "edit",
					collect,
				});
				post({ type: "websi:state", bySection });
			} else if (msg.type === "websi:ready") {
				setFound(msg.found);
				const prefix = `/proxy/${profile.id}`;
				setPagePath(
					msg.path.startsWith(prefix)
						? msg.path.slice(prefix.length) || "/"
						: msg.path,
				);
			} else if (msg.type === "websi:submit") {
				const prefix = `/proxy/${profile.id}`;
				submit(
					msg.sectionId,
					msg.text,
					msg.pin,
					msg.path.startsWith(prefix)
						? msg.path.slice(prefix.length) || "/"
						: msg.path,
				);
			} else if (msg.type === "websi:open") {
				onOpen(msg.requestId);
			} else if (msg.type === "websi:visible") {
				setVisible(msg.sectionId);
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [profile, bySection, post, submit, onOpen, collect]);

	useEffect(() => {
		post({ type: "websi:state", bySection });
	}, [bySection, post]);

	useEffect(() => {
		post({ type: "websi:mode", collect });
	}, [collect, post]);

	useEffect(() => {
		if (!toast) return;
		const t = setTimeout(() => setToast(null), 5000);
		return () => clearTimeout(t);
	}, [toast]);

	const missing = found
		? profile.sections.filter((s) => !found.includes(s.id))
		: [];

	return (
		<div className="editor">
			<div className="editor__stage">
				<div className="editor__toolbar">
					<fieldset className="segmented">
						<legend className="visually-hidden">Gerät</legend>
						{(Object.keys(widths) as Device[]).map((d) => (
							<button
								key={d}
								type="button"
								aria-pressed={device === d}
								onClick={() => setDevice(d)}
							>
								{d === "handy"
									? "Handy"
									: d === "tablet"
										? "Tablet"
										: "Desktop"}
							</button>
						))}
					</fieldset>
					<EngineSelect engines={engines} value={engine} onChange={onEngine} />
					<label className="toggle">
						<input
							type="checkbox"
							checked={collect}
							onChange={(e) => setCollect(e.target.checked)}
						/>
						<span>Sammeln</span>
					</label>
					<a
						className="editor__live"
						href={new URL(profile.editorPath, profile.url).toString()}
						target="_blank"
						rel="noreferrer"
					>
						Website öffnen
					</a>
					<button
						type="button"
						className="editor__sheet-toggle"
						onClick={() => setSheet(true)}
					>
						Abschnitte
					</button>
				</div>
				<div className="editor__frame-wrap">
					<iframe
						ref={frame}
						className="editor__frame"
						style={{ width: widths[device] }}
						title={`Live-Ansicht ${profile.name}`}
						src={src}
						allow="microphone"
					/>
				</div>
				{drafts.length > 0 && (
					<Tray
						drafts={drafts}
						label={(id) =>
							profile.sections.find((x) => x.id === id)?.label ??
							WHOLE_PAGE.label
						}
						engine={engineLabel(engine)}
						sending={sending}
						onSend={sendAll}
						onDrop={dropDraft}
						onOpen={onOpen}
					/>
				)}
			</div>

			<aside
				className={`rail ${sheet ? "rail--open" : ""}`}
				aria-label="Abschnitte"
			>
				<div className="rail__head">
					<h2>Abschnitte</h2>
					<button
						type="button"
						className="rail__close"
						onClick={() => setSheet(false)}
						aria-label="Schließen"
					>
						×
					</button>
				</div>
				{found === null && (
					<p className="muted">Live-Ansicht wird verbunden …</p>
				)}
				<ol className="sections">
					{profile.sections.map((s) => {
						const sum = summary[s.id];
						const isMissing = found !== null && !found.includes(s.id);
						return (
							<li key={s.id}>
								<button
									type="button"
									className="sections__item"
									aria-current={visible === s.id ? "true" : undefined}
									disabled={isMissing}
									onClick={() => {
										post({ type: "websi:scrollTo", sectionId: s.id });
										setSheet(false);
									}}
								>
									<span className="sections__label">{s.label}</span>
									{sum?.top && sum.open > 0 && <StatusChip status={sum.top} />}
									{sum && sum.open > 1 && (
										<span className="sections__count">{sum.open}</span>
									)}
									{isMissing && (
										<span className="muted small">nicht gefunden</span>
									)}
								</button>
							</li>
						);
					})}
				</ol>
				{missing.length > 0 && (
					<p className="muted small">
						{missing.length} Abschnitt{missing.length > 1 ? "e" : ""} nicht im
						Live-Bild. Das Website-Profil prüfen.
					</p>
				)}
				<WholePage
					collect={collect}
					onSubmit={(text) => submit(WHOLE_PAGE.id, text)}
					open={bySection[WHOLE_PAGE.id] ?? []}
					onOpen={onOpen}
				/>
			</aside>
			{sheet && (
				<button
					type="button"
					className="scrim"
					aria-label="Schließen"
					onClick={() => setSheet(false)}
				/>
			)}
			{toast && (
				<output className="toast" aria-live="polite">
					{toast}
				</output>
			)}
		</div>
	);
}

/** Leiste mit den gesammelten Wünschen: prüfen, einzeln entfernen, zusammen losschicken. */
function Tray({
	drafts,
	label,
	engine,
	sending,
	onSend,
	onDrop,
	onOpen,
}: {
	drafts: ChangeRequest[];
	label: (sectionId: string) => string;
	engine: string;
	sending: boolean;
	onSend: () => void;
	onDrop: (id: string) => void;
	onOpen: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const sections = new Set(drafts.map((d) => d.sectionId)).size;
	return (
		<section className="tray" aria-label="Gesammelte Wünsche">
			<div className="tray__bar">
				<button
					type="button"
					className="tray__count"
					aria-expanded={open}
					onClick={() => setOpen((o) => !o)}
				>
					<strong>
						{drafts.length} {drafts.length > 1 ? "Wünsche" : "Wunsch"}
					</strong>{" "}
					gesammelt in {sections} Abschnitt{sections > 1 ? "en" : ""}
					<span className="tray__caret" aria-hidden="true">
						{open ? "▾" : "▴"}
					</span>
				</button>
				<button
					type="button"
					className="btn btn--primary"
					disabled={sending}
					onClick={onSend}
				>
					{sending ? "Wird gesendet …" : `Alle senden · ${engine}`}
				</button>
			</div>
			{open && (
				<ol className="tray__list">
					{drafts.map((d) => (
						<li key={d.id}>
							<button
								type="button"
								className="tray__item"
								onClick={() => onOpen(d.id)}
							>
								<span className="tray__section">{label(d.sectionId)}</span>
								<span className="tray__text">{d.text}</span>
							</button>
							<button
								type="button"
								className="icon-btn"
								aria-label={`Wunsch entfernen: ${d.text}`}
								onClick={() => onDrop(d.id)}
							>
								×
							</button>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function WholePage({
	collect,
	onSubmit,
	open,
	onOpen,
}: {
	collect: boolean;
	onSubmit: (text: string) => void;
	open: { id: string; text: string; status: ChangeRequest["status"] }[];
	onOpen: (id: string) => void;
}) {
	const [text, setText] = useState("");
	return (
		<form
			className="whole"
			onSubmit={(e) => {
				e.preventDefault();
				if (!text.trim()) return;
				onSubmit(text.trim());
				setText("");
			}}
		>
			<h3>Ganze Seite</h3>
			<p className="muted small">
				Für Wünsche, die keinen einzelnen Abschnitt betreffen: Farben, Schrift,
				Titel in Google.
			</p>
			{open.slice(0, 3).map((r) => (
				<button
					key={r.id}
					type="button"
					className="whole__item"
					onClick={() => onOpen(r.id)}
				>
					<StatusChip status={r.status} />
					<span>{r.text}</span>
				</button>
			))}
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				rows={2}
				placeholder="Was soll sich an der ganzen Seite ändern?"
			/>
			<button
				type="submit"
				className="btn btn--primary"
				disabled={!text.trim()}
			>
				{collect ? "Sammeln" : "Senden"}
			</button>
		</form>
	);
}
