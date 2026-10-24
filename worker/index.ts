import { siteProfiles, startStyle } from "../sites";
import { type AccessEnv, isAllowed } from "./access";
import { createApi } from "./api";
import { handleMcp } from "./mcp";
import { type MonitorEnv, runMonitor } from "./monitor";
import { belongsToPreview, proxyRequest } from "./proxy";
import { D1Store } from "./storage";
import { scanSite } from "./visibility";

interface Env extends AccessEnv, MonitorEnv {
	DB: D1Database;
	ASSETS: Fetcher;
	GITHUB_TOKEN?: string;
	AGENT_MODE?: string;
	/** Zugang für MCP-Clients (Paco, KI-Betriebssystem). Ohne Token nur wie das Dashboard. */
	MCP_TOKEN?: string;
}

const MCP_PATH = "/api/websi/mcp";

/** Vergleich in konstanter Zeit, damit das Token nicht erraten werden kann. */
function sameToken(a: string, b: string) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function mcpAllowed(request: Request, env: Env) {
	const auth = request.headers.get("authorization") ?? "";
	return Boolean(env.MCP_TOKEN && sameToken(auth, `Bearer ${env.MCP_TOKEN}`));
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const isMcp = new URL(request.url).pathname === MCP_PATH;
		if (
			!((isMcp && mcpAllowed(request, env)) || (await isAllowed(request, env)))
		)
			return new Response("Kein Zugang", { status: 403 });

		if (belongsToPreview(request)) return proxyRequest(request, siteProfiles);

		const store = new D1Store(env.DB);
		const api = createApi({
			store,
			sites: siteProfiles,
			env,
			scan: (site) => scanSite(site),
			startStyle,
			runMonitor: () => runMonitor({ store, sites: siteProfiles, env }, true),
		});
		if (isMcp) return handleMcp(request, api.handle);
		const response = await api.handle(request);
		if (response) return response;

		return env.ASSETS.fetch(request);
	},

	// Täglich: Aufrufe zählen, ab dem 4. einmal im Monat prüfen (wrangler.jsonc, „triggers“).
	async scheduled(controller, env, ctx) {
		ctx.waitUntil(
			runMonitor({
				store: new D1Store(env.DB),
				sites: siteProfiles,
				env,
				now: new Date(controller.scheduledTime),
			}),
		);
	},
} satisfies ExportedHandler<Env>;
