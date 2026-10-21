import type { EngineId, EngineInfo } from "../../core/engines";

/** Auswahl, welche KI einen Auftrag abarbeitet. */
export function EngineSelect({
	engines,
	value,
	onChange,
	label = "KI",
}: {
	engines: EngineInfo[];
	value: EngineId;
	onChange: (e: EngineId) => void;
	label?: string;
}) {
	if (!engines.length) return null;
	const current = engines.find((e) => e.id === value);
	return (
		<label className="engine-select" title={current?.account}>
			<span className="engine-select__label">{label}</span>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as EngineId)}
			>
				{engines.map((e) => (
					<option key={e.id} value={e.id}>
						{e.label}
						{e.runsOn === "lokal" ? " (nur dein Rechner)" : ""}
					</option>
				))}
			</select>
		</label>
	);
}
