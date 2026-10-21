import { describe, expect, it } from "vitest";
import { siteProfiles } from "../sites";
import { belongsToPreview, injectBridge, proxyRequest } from "../worker/proxy";

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
