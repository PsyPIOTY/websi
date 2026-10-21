import { siteProfiles } from "../sites";
import { createApi } from "./api";
import { handleMcp } from "./mcp";
import { belongsToPreview, proxyRequest } from "./proxy";
import { D1Store } from "./storage";
import { scanSite } from "./visibility";

interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
	GITHUB_TOKEN?: string;
	ALLOWED_EMAIL?: string;
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

/**
 * Zugang nur für Peter. Im Betrieb steht Cloudflare Access davor und setzt
 * diese Kopfzeile; ohne ALLOWED_EMAIL (lokal) ist alles offen.
 */
function allowed(request: Request, env: Env) {
	if (!env.ALLOWED_EMAIL) return true;
	const email = request.headers.get("cf-access-authenticated-user-email") ?? "";
	return email.toLowerCase() === env.ALLOWED_EMAIL.toLowerCase();
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const isMcp = new URL(request.url).pathname === MCP_PATH;
		if (!(allowed(request, env) || (isMcp && mcpAllowed(request, env))))
			return new Response("Kein Zugang", { status: 403 });

		if (belongsToPreview(request)) return proxyRequest(request, siteProfiles);

		const api = createApi({
			store: new D1Store(env.DB),
			sites: siteProfiles,
			env,
			scan: (site) => scanSite(site),
		});
		if (isMcp) return handleMcp(request, api.handle);
		const response = await api.handle(request);
		if (response) return response;

		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
