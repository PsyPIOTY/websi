import type { CloudflareUsage } from "../core/usage";
import type { MonitorEnv } from "./monitor";
import type { Store } from "./storage";

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const KEY = "kosten-cloudflare";
/** Höchstens alle 15 Minuten neu abfragen. */
const FRESH_MS = 15 * 60_000;

interface Cached {
	at: string;
	data?: CloudflareUsage;
	error?: string;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Verbrauch heute bei Cloudflare (alle Worker, D1). Nutzt denselben
 * Lese-Schlüssel wie die Besucherzahlen (Account Analytics: Read).
 */
export async function fetchCloudflareUsage(
	env: MonitorEnv,
	fetcher: Fetcher,
	now: Date,
): Promise<CloudflareUsage> {
	const day = now.toISOString().slice(0, 10);
	const query = `query ($account: String!, $day: Date!) { viewer { accounts(filter: { accountTag: $account }) {
		workers: workersInvocationsAdaptive(limit: 10000, filter: { date: $day }) { sum { requests } }
		d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date: $day }) { sum { rowsRead rowsWritten } }
	} } }`;
	const res = await fetcher(GRAPHQL, {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			query,
			variables: { account: env.CF_ACCOUNT_ID, day },
		}),
	});
	const body = (await res.json().catch(() => ({}))) as {
		data?: {
			viewer?: {
				accounts?: {
					workers?: { sum: { requests: number } }[];
					d1?: { sum: { rowsRead: number; rowsWritten: number } }[];
				}[];
			};
		};
		errors?: { message: string }[] | null;
	};
	const account = body.data?.viewer?.accounts?.[0];
	if (!res.ok || body.errors?.length || !account)
		throw new Error(
			`Cloudflare-Verbrauch: ${body.errors?.[0]?.message ?? `Antwort ${res.status}`}`,
		);
	const sum = <T>(list: { sum: T }[] | undefined, pick: (s: T) => number) =>
		(list ?? []).reduce((a, x) => a + (pick(x.sum) || 0), 0);
	return {
		day,
		requests: sum(account.workers, (s) => s.requests),
		rowsRead: sum(account.d1, (s) => s.rowsRead),
		rowsWritten: sum(account.d1, (s) => s.rowsWritten),
	};
}

/**
 * Verbrauch mit Zwischenspeicher. `refresh: false` liest nur, was da ist
 * (für den Kostenwächter vor jedem Senden, ohne Wartezeit).
 */
export async function cloudflareUsage(
	deps: { store: Store; env: MonitorEnv; fetcher?: Fetcher; now?: Date },
	refresh = true,
): Promise<{ at: string; data: CloudflareUsage } | { error: string } | null> {
	const { env, store } = deps;
	if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return null;
	const now = deps.now ?? new Date();
	const day = now.toISOString().slice(0, 10);
	let cached = await store.getSetting<Cached>(KEY);
	const stale =
		!cached ||
		cached.data?.day !== day ||
		now.getTime() - Date.parse(cached.at) > FRESH_MS;
	if (refresh && stale) {
		try {
			const data = await fetchCloudflareUsage(
				env,
				deps.fetcher ?? ((u, i) => fetch(u, i)),
				now,
			);
			cached = { at: now.toISOString(), data };
		} catch (e) {
			cached = { at: now.toISOString(), error: (e as Error).message };
		}
		await store.putSetting(KEY, cached);
	}
	if (!cached) return null;
	if (cached.data && cached.data.day === day)
		return { at: cached.at, data: cached.data };
	return cached.error ? { error: cached.error } : null;
}
