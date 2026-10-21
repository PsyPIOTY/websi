import type { ChangeRequest } from "../types";
import type {
	AgentAdapter,
	AgentContext,
	AgentUpdate,
	DispatchResult,
} from "./adapter";

/**
 * Testmodus: verhält sich wie ein echter Ausführer, ändert aber nichts.
 * Läuft automatisch, solange kein GitHub-Zugang hinterlegt ist.
 */
export class TestModeAdapter implements AgentAdapter {
	readonly id = "testmodus";
	readonly label = "Testmodus (ändert nichts)";

	ready() {
		return true;
	}

	async dispatch(request: ChangeRequest): Promise<DispatchResult> {
		return { id: `test-${request.id.slice(0, 8)}`, url: "" };
	}

	async sync(request: ChangeRequest, ctx: AgentContext): Promise<AgentUpdate> {
		if (request.status !== "in_arbeit")
			return { status: "unveraendert", messages: [] };
		const already = request.events.some((e) => e.kind === "vorschlag");
		if (already) return { status: "unveraendert", messages: [] };
		return {
			status: "vorschlag",
			messages: [
				{
					at: new Date().toISOString(),
					text: `Testmodus: So würde der Agent antworten. Für „${ctx.section.label}“ läge jetzt ein Vorschlag bereit. Mit GitHub-Zugang entsteht hier ein echter Pull Request.`,
				},
			],
			proposalUrl: ctx.pageUrl,
		};
	}

	async followUp() {}

	async publish(_request: ChangeRequest, ctx: AgentContext) {
		return { url: ctx.pageUrl };
	}

	async discard() {}
}
