import { describe, expect, it } from "vitest";
import {
	analyzeOrigin,
	analyzePage,
	keywordCoverage,
} from "../core/seo/checks";
import { scoreOf, topMeasures } from "../core/seo/measures";
import { praxis } from "../sites/praxis";

const good = `<!doctype html><html lang="de"><head>
<title>Paartherapie Bad Belzig · Psychologische Praxis Peter Jarek</title>
<meta name="description" content="Paartherapie, Beziehungsberatung und Kommunikations-Coaching in Bad Belzig. Erstgespräch vereinbaren: vor Ort oder online, mit Zeit und Ruhe.">
<meta name="viewport" content="width=device-width">
<link rel="canonical" href="https://praxis.example/">
<meta property="og:title" content="Praxis"><meta property="og:image" content="/foto.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Psychologist"},{"@type":"LocalBusiness"},{"@type":"FAQPage"}]}</script>
</head><body><h1>Paartherapie in Bad Belzig</h1>
<p>${"Wort ".repeat(420)} Sandberger Straße 6, 14806 Bad Belzig</p>
<a href="tel:+491713830060">Anrufen</a>${'<a href="#a">x</a>'.repeat(6)}
<img src="a.jpg" alt="Praxisraum"></body></html>`;

describe("Seiten-Check", () => {
	it("erkennt eine gut aufgestellte Seite", () => {
		const a = analyzePage(good, "https://praxis.example/", {
			...praxis,
			stage: "live",
		});
		const bad = a.checks.filter((c) => c.level !== "ok").map((c) => c.id);
		// Nur das fehlende Google-Profil bleibt offen.
		expect(bad).toEqual(["gbp"]);
		expect(keywordCoverage("Paartherapie Bad Belzig", a, "/")).toMatchObject({
			inTitle: true,
			inH1: true,
			inBody: true,
		});
	});

	it("meldet fehlende Grundlagen und sortiert die Maßnahmen", () => {
		const a = analyzePage(
			'<html><head></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
			"https://x.example/",
			{ ...praxis, stage: "live" },
		);
		const ids = a.checks.filter((c) => c.level === "fehler").map((c) => c.id);
		expect(ids).toEqual(
			expect.arrayContaining([
				"title",
				"description",
				"viewport",
				"h1",
				"words",
				"schema",
			]),
		);
		expect(a.checks.find((c) => c.id === "words")?.title).toBe(
			"Inhalt entsteht erst im Browser",
		);
		const top = topMeasures(a.checks);
		expect(top).toHaveLength(3);
		expect(top.every((c) => c.level === "fehler")).toBe(true);
		expect(scoreOf(a.checks)).toBeLessThan(30);
	});

	it("behandelt Sperren im Entwurf als gewollt", () => {
		const html =
			'<html><head><meta name="robots" content="noindex"></head><body></body></html>';
		const draft = analyzePage(html, "https://x.example/", praxis).checks.find(
			(c) => c.id === "noindex",
		);
		const live = analyzePage(html, "https://x.example/", {
			...praxis,
			stage: "live",
		}).checks.find((c) => c.id === "noindex");
		expect(draft?.level).toBe("warnung");
		expect(live?.level).toBe("fehler");
		expect(
			analyzeOrigin(
				"https://x.example",
				"User-agent: *\nDisallow: /",
				false,
				"entwurf",
			)[0].level,
		).toBe("warnung");
	});
});
