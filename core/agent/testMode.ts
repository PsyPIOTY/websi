import type { Draft } from "../drafts";
import type { ChangeRequest } from "../types";
import type {
	AgentAdapter,
	AgentContext,
	AgentUpdate,
	DispatchResult,
	Job,
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

	async dispatch(job: Job): Promise<DispatchResult> {
		return { id: `test-${job.items[0].request.id.slice(0, 8)}`, url: "" };
	}

	async sync(request: ChangeRequest, ctx: AgentContext): Promise<AgentUpdate> {
		if (request.status !== "in_arbeit")
			return { status: "unveraendert", messages: [] };
		// Nach einer Nachbesserung gibt es einen neuen Vorschlag.
		const lastProposal = request.events.findLastIndex(
			(e) => e.kind === "vorschlag",
		);
		const lastFollowUp = request.events.findLastIndex(
			(e) => e.kind === "nachbessern",
		);
		if (lastProposal > lastFollowUp)
			return { status: "unveraendert", messages: [] };
		const names = request.external?.chosen ? [] : (request.drafts ?? []);
		if (names.length) {
			// Ohne echte Vorschau zeigen alle Entwürfe die Website selbst.
			const drafts: Draft[] = names.map((name) => ({
				name,
				branch: `testmodus/entwurf-${name}`,
				proposalUrl: ctx.pageUrl,
				previewUrl: ctx.site.url,
			}));
			return {
				status: "vorschlag",
				messages: [
					{
						at: new Date().toISOString(),
						usage: {
							engine: request.engine ?? "claude",
							seconds: 0,
							where: "test",
							runs: names.length,
						},
						text: `Testmodus: Für „${ctx.section.label}“ lägen jetzt ${names.length} Entwürfe bereit (${names.join(", ")}).`,
					},
				],
				drafts,
			};
		}
		return {
			status: "vorschlag",
			messages: [
				{
					at: new Date().toISOString(),
					usage: {
						engine: request.engine ?? "claude",
						seconds: 0,
						where: "test",
					},
					text: `Testmodus: So würde der Agent antworten. Für „${ctx.section.label}“ läge jetzt ein Vorschlag bereit. Mit GitHub-Zugang entsteht hier ein echter Pull Request.`,
				},
			],
			proposalUrl: ctx.pageUrl,
			// Ohne echte Vorschau zeigt der Vergleich die Website gegen sich selbst.
			previewUrl: ctx.site.url,
		};
	}

	async followUp() {}

	async publish(_request: ChangeRequest, ctx: AgentContext) {
		return { url: ctx.pageUrl };
	}

	async discard() {}

	async choose() {}
}
