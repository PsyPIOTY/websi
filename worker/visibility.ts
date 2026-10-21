import {
	analyzeOrigin,
	analyzePage,
	keywordCoverage,
	scoreOf,
} from "../core/seo/checks";
import type { CheckResult, SiteProfile, VisibilityReport } from "../core/types";

type Fetcher = (url: string) => Promise<Response>;

const get: Fetcher = (url) =>
	fetch(url, {
		headers: { "user-agent": "WEBSI-Sichtbarkeit (+Seiten-Check)" },
		redirect: "follow",
	});

/** Liest alle Seiten einer Website und erstellt den Sichtbarkeitsbericht. */
export async function scanSite(
	site: SiteProfile,
	fetcher: Fetcher = get,
	now = new Date(),
): Promise<VisibilityReport> {
	const checks: CheckResult[] = [];
	const keywords: VisibilityReport["keywords"] = [];
	const errors: string[] = [];
	const analyses: {
		page: string;
		title: string;
		h1: string[];
		text: string;
	}[] = [];

	for (const path of site.pages) {
		const url = new URL(path, site.url).toString();
		try {
			const res = await fetcher(url);
			if (!res.ok) {
				errors.push(`${path}: Antwort ${res.status}`);
				continue;
			}
			const analysis = analyzePage(await res.text(), url, site);
			checks.push(...analysis.checks);
			analyses.push({ page: path, ...analysis });
		} catch (e) {
			errors.push(`${path}: ${(e as Error).message}`);
		}
	}

	for (const k of site.seo.keywords) {
		const a =
			analyses.find((x) => x.page === (k.page ?? site.pages[0])) ?? analyses[0];
		if (a) keywords.push(keywordCoverage(k.phrase, a, a.page));
	}

	const origin = new URL(site.url).origin;
	try {
		const robots = await fetcher(`${origin}/robots.txt`);
		const robotsText =
			robots.ok && !(robots.headers.get("content-type") ?? "").includes("html")
				? await robots.text()
				: null;
		const sitemap = await fetcher(`${origin}/sitemap.xml`);
		const sitemapOk = sitemap.ok && (await sitemap.text()).includes("<urlset");
		checks.push(...analyzeOrigin(origin, robotsText, sitemapOk, site.stage));
	} catch (e) {
		errors.push(`robots/sitemap: ${(e as Error).message}`);
	}

	return {
		siteId: site.id,
		scannedAt: now.toISOString(),
		score: scoreOf(checks),
		checks,
		keywords,
		errors,
	};
}
