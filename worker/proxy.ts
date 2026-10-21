import { ALIAS } from "../core/preview";
import type { SiteProfile } from "../core/types";

export { previewKey } from "../core/preview";

/**
 * Live-Vorschau: Die Website wird über WEBSI ausgeliefert, damit das
 * Dashboard die Bridge einsetzen und mit ihr sprechen kann (gleicher Ursprung).
 * Alle Unteranfragen der Website (Skripte, Bilder, Daten) leitet der Worker
 * anhand eines Cookies an die richtige Website weiter.
 */

export const SITE_COOKIE = "websi_site";
const PREFIX = "/proxy/";

/** Pfade, die immer zu WEBSI selbst gehören. */
const OWN = [
	/^\/assets\//,
	/^\/websi-bridge\.js$/,
	/^\/favicon/,
	/^\/api\/websi\//,
];

/**
 * Ziel im Vorschaufenster: "praxis" = die Website selbst,
 * "praxis@websi-12" = ihre Vorschau-Version websi-12-<host> (Cloudflare-Vorschau).
 */
export interface Target {
	site: SiteProfile;
	origin: string;
	key: string;
}

export function resolveTarget(
	key: string | null | undefined,
	sites: SiteProfile[],
): Target | null {
	if (!key) return null;
	const [id, alias] = key.split("@");
	const site = sites.find((s) => s.id === id);
	if (!site) return null;
	const base = new URL(site.url);
	if (alias === undefined) return { site, origin: base.origin, key: site.id };
	if (!ALIAS.test(alias)) return null;
	return {
		site,
		origin: `${base.protocol}//${alias}-${base.host}`,
		key: `${site.id}@${alias}`,
	};
}

export function proxyPath(siteId: string, path: string) {
	return `${PREFIX}${siteId}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Ist das eine Anfrage, die die Website im Vorschaufenster stellt? */
export function belongsToPreview(request: Request) {
	const url = new URL(request.url);
	if (url.pathname.startsWith(PREFIX)) return true;
	if (OWN.some((r) => r.test(url.pathname))) return false;
	if (!readCookie(request, SITE_COOKIE)) return false;
	if (url.pathname.startsWith("/_next/")) return true;
	const referer = request.headers.get("referer");
	if (!referer) return false;
	try {
		const ref = new URL(referer);
		return (
			ref.origin === url.origin &&
			(ref.pathname.startsWith(PREFIX) || ref.pathname.startsWith("/_next/"))
		);
	} catch {
		return false;
	}
}

/** Kennung der anfragenden Vorschau-Seite aus dem Referer (/proxy/<kennung>/…). */
function refererKey(request: Request) {
	const referer = request.headers.get("referer");
	if (!referer) return null;
	try {
		const ref = new URL(referer);
		if (!ref.pathname.startsWith(PREFIX)) return null;
		return decodeURIComponent(ref.pathname.split("/")[2] ?? "");
	} catch {
		return null;
	}
}

export function readCookie(request: Request, name: string) {
	const header = request.headers.get("cookie") ?? "";
	for (const part of header.split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === name) return decodeURIComponent(v.join("="));
	}
	return null;
}

export async function proxyRequest(
	request: Request,
	sites: SiteProfile[],
	fetcher: typeof fetch = fetch,
): Promise<Response> {
	const url = new URL(request.url);
	let target: Target | null;
	let path = url.pathname;
	if (url.pathname.startsWith(PREFIX)) {
		const [, , key, ...rest] = url.pathname.split("/");
		target = resolveTarget(decodeURIComponent(key ?? ""), sites);
		path = `/${rest.join("/")}`;
	} else {
		// Zwei Fenster (Vorher/Nachher) laufen gleichzeitig: erst die Seite fragen, die anfragt.
		target =
			resolveTarget(refererKey(request), sites) ??
			resolveTarget(readCookie(request, SITE_COOKIE), sites);
	}
	if (!target) return new Response("Unbekannte Website", { status: 404 });

	const upstreamUrl = new URL(path + url.search, target.origin);
	const headers = new Headers();
	for (const h of [
		"accept",
		"accept-language",
		"content-type",
		"rsc",
		"next-router-state-tree",
		"next-url",
		"x-vinext-rsc",
	]) {
		const v = request.headers.get(h);
		if (v) headers.set(h, v);
	}
	headers.set("user-agent", "WEBSI-Vorschau");
	const upstream = await fetcher(upstreamUrl.toString(), {
		method: request.method,
		headers,
		body: ["GET", "HEAD"].includes(request.method)
			? undefined
			: await request.arrayBuffer(),
		redirect: "manual",
	});

	const out = new Headers(upstream.headers);
	out.delete("x-frame-options");
	out.delete("content-security-policy");
	out.delete("content-length");
	out.delete("content-encoding");
	const location = out.get("location");
	if (location) {
		const loc = new URL(location, target.origin);
		if (loc.origin === target.origin)
			out.set("location", proxyPath(target.key, loc.pathname + loc.search));
	}

	const type = upstream.headers.get("content-type") ?? "";
	const isDocument =
		url.pathname.startsWith(PREFIX) && type.includes("text/html");
	if (!isDocument)
		return new Response(upstream.body, {
			status: upstream.status,
			headers: out,
		});

	out.append(
		"set-cookie",
		`${SITE_COOKIE}=${encodeURIComponent(target.key)}; Path=/; SameSite=Lax; HttpOnly`,
	);
	out.set("cache-control", "no-store");
	const html = await upstream.text();
	return new Response(injectBridge(html), {
		status: upstream.status,
		headers: out,
	});
}

export function injectBridge(html: string) {
	const tag = '<script src="/websi-bridge.js" defer></script>';
	if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
	return tag + html;
}
