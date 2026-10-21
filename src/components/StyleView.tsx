import { useCallback, useEffect, useId, useState } from "react";
import { ALL_SITES, type SiteProfile, type StyleRule } from "../../core/types";
import { api, type StyleData } from "../api";

const sourceText: Record<StyleRule["source"], string> = {
	peter: "von dir",
	nachbessern: "aus einer Nachbesserung",
	verworfen: "aus einem verworfenen Vorschlag",
};

/**
 * Stil-Gedächtnis: Regeln, die jeder Auftrag mitbekommt. Vorschläge kommen aus
 * deinen Nachbesserungen und den Gründen, mit denen du etwas verworfen hast.
 */
export function StyleView({ profile }: { profile: SiteProfile }) {
	const [data, setData] = useState<StyleData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [scope, setScope] = useState<"site" | "alle">("site");
	const fieldId = useId();

	const load = useCallback(() => {
		api.style(profile.id).then(
			(d) => {
				setData(d);
				setError(null);
			},
			(e: Error) => setError(e.message),
		);
	}, [profile.id]);

	useEffect(() => load(), [load]);

	const run = async (fn: () => Promise<unknown>) => {
		try {
			await fn();
			load();
		} catch (e) {
			setError((e as Error).message);
		}
	};

	const active = data?.rules.filter((r) => r.active).length ?? 0;

	return (
		<section className="page">
			<header className="page__head">
				<h1>Stil-Gedächtnis</h1>
				<p className="muted">
					Jeder Auftrag an die KI bekommt diese Regeln mit. {active} aktiv für{" "}
					{profile.name}.
				</p>
			</header>

			<form
				className="style-add"
				onSubmit={(e) => {
					e.preventDefault();
					const t = text.trim();
					if (!t) return;
					run(() => api.addStyle(profile.id, t, scope)).then(() => setText(""));
				}}
			>
				<label htmlFor={fieldId}>Neue Regel</label>
				<div className="style-add__row">
					<input
						id={fieldId}
						value={text}
						maxLength={300}
						onChange={(e) => setText(e.target.value)}
						placeholder="z. B. Du statt Sie. Keine Ausrufezeichen."
					/>
					<select
						aria-label="Gilt für"
						value={scope}
						onChange={(e) => setScope(e.target.value as "site" | "alle")}
					>
						<option value="site">Nur {profile.name}</option>
						<option value="alle">Alle Websites</option>
					</select>
					<button
						type="submit"
						className="btn btn--primary"
						disabled={!text.trim()}
					>
						Merken
					</button>
				</div>
			</form>

			{error && (
				<p className="banner banner--error" role="alert">
					{error}
				</p>
			)}

			<h2 className="section-title">Regeln</h2>
			{data && data.rules.length === 0 && (
				<p className="empty">
					Noch keine Regeln. Schreib oben eine, oder übernimm einen Vorschlag
					aus deinen Nachbesserungen.
				</p>
			)}
			<ul className="style-list">
				{data?.rules.map((r) => (
					<li key={r.id} className={r.active ? "" : "style-list__off"}>
						<label className="style-list__toggle">
							<input
								type="checkbox"
								checked={r.active}
								onChange={(e) =>
									run(() =>
										api.patchStyle(profile.id, r.id, {
											active: e.target.checked,
										}),
									)
								}
							/>
							<span className="visually-hidden">Aktiv</span>
						</label>
						<div className="style-list__body">
							<p>{r.text}</p>
							<p className="muted small">
								{r.siteId === ALL_SITES ? "Alle Websites" : profile.name} ·{" "}
								{sourceText[r.source]}
							</p>
						</div>
						<button
							type="button"
							className="btn btn--quiet btn--small"
							onClick={() =>
								run(() =>
									api.patchStyle(profile.id, r.id, {
										scope: r.siteId === ALL_SITES ? profile.id : ALL_SITES,
									}),
								)
							}
						>
							{r.siteId === ALL_SITES ? "Nur diese Website" : "Für alle"}
						</button>
						<button
							type="button"
							className="icon-btn"
							aria-label={`Regel löschen: ${r.text}`}
							onClick={() => run(() => api.deleteStyle(profile.id, r.id))}
						>
							×
						</button>
					</li>
				))}
			</ul>

			{data && data.suggestions.length > 0 && (
				<>
					<h2 className="section-title">Vorschläge aus deinen Aufträgen</h2>
					<ul className="style-list">
						{data.suggestions.map((s) => (
							<li key={s.text}>
								<div className="style-list__body">
									<p>{s.text}</p>
									<p className="muted small">{sourceText[s.source]}</p>
								</div>
								<button
									type="button"
									className="btn btn--small"
									onClick={() =>
										run(() =>
											api.addStyle(profile.id, s.text, "site", s.source),
										)
									}
								>
									Als Regel merken
								</button>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
