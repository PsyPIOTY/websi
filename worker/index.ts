import { siteProfiles } from "../sites";
import { createApi } from "./api";
import { belongsToPreview, proxyRequest } from "./proxy";
import { D1Store } from "./storage";
import { scanSite } from "./visibility";

interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
	GITHUB_TOKEN?: string;
	ALLOWED_EMAIL?: string;
	AGENT_MODE?: string;
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
		if (!allowed(request, env))
			return new Response("Kein Zugang", { status: 403 });

		if (belongsToPreview(request)) return proxyRequest(request, siteProfiles);

		const api = createApi({
			store: new D1Store(env.DB),
			sites: siteProfiles,
			env,
			scan: (site) => scanSite(site),
		});
		const response = await api.handle(request);
		if (response) return response;

		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
