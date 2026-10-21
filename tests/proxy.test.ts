import { describe, expect, it } from "vitest";
import { siteProfiles } from "../sites";
import {
	belongsToPreview,
	injectBridge,
	previewKey,
	proxyRequest,
	resolveTarget,
} from "../worker/proxy";

describe("Live-Vorschau", () => {
	it("leitet nur Anfragen der Vorschau an die Website weiter", () => {
		const cookie = { cookie: "websi_site=praxis" };
		expect(belongsToPreview(new Request("https://w.test/proxy/praxis/"))).toBe(
			true,
		);
		expect(
			belongsToPreview(
				new Request("https://w.test/_next/static/a.js", { headers: cookie }),
			),
		).toBe(true);
		expect(
			belongsToPreview(
				new Request("https://w.test/api/feedback", {
					headers: { ...cookie, referer: "https://w.test/proxy/praxis/" },
				}),
			),
		).toBe(true);
		expect(
			belongsToPreview(
				new Request("https://w.test/api/websi/sites", {
					headers: { ...cookie, referer: "https://w.test/proxy/praxis/" },
				}),
			),
		).toBe(false);
		expect(
			belongsToPreview(
				new Request("https://w.test/assets/index.js", { headers: cookie }),
			),
		).toBe(false);
		expect(
			belongsToPreview(
				new Request("https://w.test/", {
					headers: { ...cookie, referer: "https://w.test/" },
				}),
			),
		).toBe(false);
	});

	it("setzt die Bridge ein und erlaubt die Anzeige im Rahmen", async () => {
		const upstream = async () =>
			new Response("<html><head><title>x</title></head><body></body></html>", {
				headers: { "content-type": "text/html", "x-frame-options": "DENY" },
			});
		const res = await proxyRequest(
			new Request("https://w.test/proxy/praxis/?concept=erstes-gespraech"),
			siteProfiles,
			upstream as typeof fetch,
		);
		expect(res.headers.get("x-frame-options")).toBeNull();
		expect(res.headers.get("set-cookie")).toContain("websi_site=praxis");
		expect(await res.text()).toContain(
			'<script src="/websi-bridge.js" defer></script></head>',
		);
		expect(injectBridge("<p>ohne head</p>")).toMatch(/^<script/);
	});
});

describe("Vorschau-Version im Vergleich", () => {
	const praxis = siteProfiles.find((s) => s.id === "praxis");
	if (!praxis) throw new Error("Profil fehlt");
	const host = new URL(praxis.url).host;

	it("leitet praxis@alias an die Vorschau-Adresse derselben Website", async () => {
		const seen: string[] = [];
		const upstream = async (url: string | URL | Request) => {
			seen.push(String(url));
			return new Response("<html><head></head><body></body></html>", {
				headers: { "content-type": "text/html" },
			});
		};
		const res = await proxyRequest(
			new Request("https://w.test/proxy/praxis@websi-12/faq"),
			siteProfiles,
			upstream as typeof fetch,
		);
		expect(seen[0]).toBe(`https://websi-12-${host}/faq`);
		expect(res.headers.get("set-cookie")).toContain(
			"websi_site=praxis%40websi-12",
		);
	});

	it("ordnet Unteranfragen über den Referer der richtigen Fassung zu", async () => {
		const seen: string[] = [];
		const upstream = async (url: string | URL | Request) => {
			seen.push(String(url));
			return new Response("js", {
				headers: { "content-type": "text/javascript" },
			});
		};
		await proxyRequest(
			new Request("https://w.test/_next/a.js", {
				headers: {
					cookie: "websi_site=praxis",
					referer: "https://w.test/proxy/praxis@websi-12/",
				},
			}),
			siteProfiles,
			upstream as typeof fetch,
		);
		expect(seen[0]).toBe(`https://websi-12-${host}/_next/a.js`);
	});

	it("erkennt nur Vorschau-Adressen derselben Website", () => {
		expect(previewKey(praxis, `https://websi-3-${host}`)).toBe(
			"praxis@websi-3",
		);
		expect(previewKey(praxis, praxis.url)).toBe("praxis");
		expect(previewKey(praxis, "https://evil.example.com")).toBeNull();
		expect(resolveTarget("praxis@../x", siteProfiles)).toBeNull();
	});
});
