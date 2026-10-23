/**
 * Zugang zu WEBSI. Im Betrieb steht Cloudflare Access davor. Maßgeblich ist
 * das signierte Access-Token (Kopfzeile Cf-Access-Jwt-Assertion), nicht die
 * E-Mail-Kopfzeile: Die könnte jeder selbst mitschicken, falls Access einmal
 * nicht greift. Ohne ALLOWED_EMAIL ist WEBSI nur lokal offen.
 */

export interface AccessEnv {
	ALLOWED_EMAIL?: string;
	/** Access-Teamname, z. B. "peterjarek" oder "peterjarek.cloudflareaccess.com". */
	ACCESS_TEAM_DOMAIN?: string;
	/** Optional: Audience-Tag der Access-Anwendung. */
	ACCESS_AUD?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const KEYS_TTL_MS = 60 * 60 * 1000;
const REFETCH_MS = 60 * 1000;

interface KeySet {
	at: number;
	keys: Map<string, CryptoKey>;
}

const keyCache = new Map<string, KeySet>();

/** "peterjarek" → "https://peterjarek.cloudflareaccess.com" */
export function teamOrigin(team: string) {
	const host = team
		.trim()
		.replace(/^https?:\/\//, "")
		.replace(/\/.*$/, "");
	return `https://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`;
}

function base64UrlBytes(part: string) {
	const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function base64UrlJson(part: string): Record<string, unknown> {
	return JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));
}

async function loadKeys(origin: string, fetcher: typeof fetch, now: number) {
	const res = await fetcher(`${origin}/cdn-cgi/access/certs`);
	if (!res.ok)
		throw new Error(`Access-Schlüssel nicht erreichbar (${res.status})`);
	const body = (await res.json()) as {
		keys?: (JsonWebKey & { kid?: string })[];
	};
	const keys = new Map<string, CryptoKey>();
	for (const jwk of body.keys ?? []) {
		if (!jwk.kid || jwk.kty !== "RSA") continue;
		keys.set(
			jwk.kid,
			await crypto.subtle.importKey(
				"jwk",
				jwk,
				{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
				false,
				["verify"],
			),
		);
	}
	const set = { at: now, keys };
	keyCache.set(origin, set);
	return set;
}

/** Schlüssel des Teams; bei unbekannter kid höchstens einmal pro Minute neu laden. */
async function keyFor(
	origin: string,
	kid: string,
	fetcher: typeof fetch,
	now: number,
) {
	let set = keyCache.get(origin);
	if (!set || now - set.at > KEYS_TTL_MS)
		set = await loadKeys(origin, fetcher, now);
	else if (!set.keys.has(kid) && now - set.at > REFETCH_MS)
		set = await loadKeys(origin, fetcher, now);
	return set.keys.get(kid);
}

/** Prüft Signatur, Aussteller (Peters Access-Team), Ablauf und E-Mail. */
export async function verifyAccessToken(
	token: string | null,
	cfg: { team: string; email: string; aud?: string },
	fetcher: typeof fetch = fetch,
	now = Date.now(),
): Promise<boolean> {
	const parts = token?.split(".") ?? [];
	if (parts.length !== 3) return false;
	try {
		const header = base64UrlJson(parts[0]);
		const claims = base64UrlJson(parts[1]);
		const origin = teamOrigin(cfg.team);
		if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
		if (claims.iss !== origin) return false;
		const seconds = now / 1000;
		if (typeof claims.exp !== "number" || claims.exp < seconds) return false;
		if (typeof claims.nbf === "number" && claims.nbf > seconds + 60)
			return false;
		if (cfg.aud) {
			const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
			if (!aud.includes(cfg.aud)) return false;
		}
		if (String(claims.email ?? "").toLowerCase() !== cfg.email.toLowerCase())
			return false;
		const key = await keyFor(origin, header.kid, fetcher, now);
		if (!key) return false;
		return await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			base64UrlBytes(parts[2]),
			new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
		);
	} catch {
		return false;
	}
}

/** Access legt das Token als Kopfzeile und als Cookie CF_Authorization ab. */
function accessToken(request: Request) {
	const header = request.headers.get("cf-access-jwt-assertion");
	if (header) return header;
	const cookie = request.headers.get("cookie") ?? "";
	return cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] ?? null;
}

/** Zugang nur für Peter über Access; ohne Einstellungen nur lokal offen. */
export async function isAllowed(
	request: Request,
	env: AccessEnv,
	fetcher: typeof fetch = fetch,
	now = Date.now(),
) {
	if (!env.ALLOWED_EMAIL) return LOCAL_HOSTS.has(new URL(request.url).hostname);
	if (!env.ACCESS_TEAM_DOMAIN) return false;
	return verifyAccessToken(
		accessToken(request),
		{
			team: env.ACCESS_TEAM_DOMAIN,
			email: env.ALLOWED_EMAIL,
			aud: env.ACCESS_AUD,
		},
		fetcher,
		now,
	);
}
