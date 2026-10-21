import type { SiteProfile } from "../core/types";

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
	let site: SiteProfile | undefined;
	let path = url.pathname;
	if (url.pathname.startsWith(PREFIX)) {
		const [, , id, ...rest] = url.pathname.split("/");
		site = sites.find((s) => s.id === id);
		path = `/${rest.join("/")}`;
	} else {
		site = sites.find((s) => s.id === readCookie(request, SITE_COOKIE));
	}
	if (!site) return new Response("Unbekannte Website", { status: 404 });

	const target = new URL(path + url.search, site.url);
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
	const upstream = await fetcher(target.toString(), {
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
		const loc = new URL(location, site.url);
		if (loc.origin === new URL(site.url).origin)
			out.set("location", proxyPath(site.id, loc.pathname + loc.search));
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
		`${SITE_COOKIE}=${encodeURIComponent(site.id)}; Path=/; SameSite=Lax; HttpOnly`,
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
