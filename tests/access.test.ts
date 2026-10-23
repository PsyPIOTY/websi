import { beforeAll, describe, expect, it } from "vitest";
import { isAllowed, teamOrigin, verifyAccessToken } from "../worker/access";

const TEAM = "https://peter.cloudflareaccess.com";
const EMAIL = "peter@example.org";
const NOW = Date.UTC(2026, 10, 1, 9, 0);

const algorithm = {
	name: "RSASSA-PKCS1-v1_5",
	modulusLength: 2048,
	publicExponent: new Uint8Array([1, 0, 1]),
	hash: "SHA-256",
};
let peterKey: CryptoKeyPair;
let strangerKey: CryptoKeyPair;
let jwks: unknown;
let certRequests = 0;

const fetcher = (async (url: string) => {
	certRequests++;
	if (url !== `${TEAM}/cdn-cgi/access/certs`)
		return new Response("nicht gefunden", { status: 404 });
	return Response.json(jwks);
}) as typeof fetch;

function base64Url(bytes: Uint8Array) {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

async function token(
	claims: Record<string, unknown>,
	key = peterKey.privateKey,
	kid = "k1",
) {
	const encode = (part: unknown) =>
		base64Url(new TextEncoder().encode(JSON.stringify(part)));
	const body = `${encode({ alg: "RS256", kid })}.${encode({
		iss: TEAM,
		email: EMAIL,
		exp: NOW / 1000 + 600,
		...claims,
	})}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(body),
	);
	return `${body}.${base64Url(new Uint8Array(signature))}`;
}

beforeAll(async () => {
	peterKey = (await crypto.subtle.generateKey(algorithm, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	strangerKey = (await crypto.subtle.generateKey(algorithm, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const jwk = await crypto.subtle.exportKey("jwk", peterKey.publicKey);
	jwks = { keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] };
});

describe("Zugang über Cloudflare Access", () => {
	const cfg = { team: "peter", email: EMAIL };

	it("lässt Peter mit gültigem Access-Token herein", async () => {
		expect(await verifyAccessToken(await token({}), cfg, fetcher, NOW)).toBe(
			true,
		);
		expect(
			await verifyAccessToken(
				await token({ email: "Peter@Example.org" }),
				cfg,
				fetcher,
				NOW,
			),
		).toBe(true);
	});

	it("lehnt fremde, abgelaufene und gefälschte Tokens ab", async () => {
		for (const claims of [
			{ email: "jemand@example.org" },
			{ iss: "https://fremd.cloudflareaccess.com" },
			{ exp: NOW / 1000 - 1 },
			{ nbf: NOW / 1000 + 3600 },
		])
			expect(
				await verifyAccessToken(await token(claims), cfg, fetcher, NOW),
			).toBe(false);
		expect(
			await verifyAccessToken(
				await token({}, strangerKey.privateKey),
				cfg,
				fetcher,
				NOW,
			),
		).toBe(false);
		expect(await verifyAccessToken("kein.token", cfg, fetcher, NOW)).toBe(
			false,
		);
		expect(await verifyAccessToken(null, cfg, fetcher, NOW)).toBe(false);
	});

	it("prüft die Audience nur, wenn sie eingestellt ist", async () => {
		const withAud = { ...cfg, aud: "app-1" };
		expect(
			await verifyAccessToken(
				await token({ aud: ["app-1"] }),
				withAud,
				fetcher,
				NOW,
			),
		).toBe(true);
		expect(
			await verifyAccessToken(
				await token({ aud: ["app-2"] }),
				withAud,
				fetcher,
				NOW,
			),
		).toBe(false);
	});

	it("lädt bei unbekanntem Schlüssel höchstens einmal pro Minute nach", async () => {
		const later = NOW + 2 * 60 * 1000;
		const before = certRequests;
		const unknown = await token({}, peterKey.privateKey, "k9");
		expect(await verifyAccessToken(unknown, cfg, fetcher, later)).toBe(false);
		expect(await verifyAccessToken(unknown, cfg, fetcher, later + 1000)).toBe(
			false,
		);
		expect(certRequests - before).toBe(1);
	});

	it("vertraut der E-Mail-Kopfzeile allein nicht", async () => {
		const env = { ALLOWED_EMAIL: EMAIL, ACCESS_TEAM_DOMAIN: "peter" };
		const spoofed = new Request("https://websi.example.workers.dev/", {
			headers: { "cf-access-authenticated-user-email": EMAIL },
		});
		expect(await isAllowed(spoofed, env, fetcher, NOW)).toBe(false);
		const real = new Request("https://websi.example.workers.dev/", {
			headers: { "cf-access-jwt-assertion": await token({}) },
		});
		expect(await isAllowed(real, env, fetcher, NOW)).toBe(true);
		const fromCookie = new Request("https://websi.example.workers.dev/", {
			headers: { cookie: `theme=hell; CF_Authorization=${await token({})}` },
		});
		expect(await isAllowed(fromCookie, env, fetcher, NOW)).toBe(true);
	});

	it("ist ohne Einstellungen nur lokal offen und sonst zu", async () => {
		expect(await isAllowed(new Request("http://127.0.0.1:5173/"), {})).toBe(
			true,
		);
		expect(await isAllowed(new Request("http://localhost:5173/"), {})).toBe(
			true,
		);
		expect(
			await isAllowed(new Request("https://websi.example.workers.dev/"), {}),
		).toBe(false);
		expect(
			await isAllowed(new Request("https://websi.example.workers.dev/"), {
				ALLOWED_EMAIL: EMAIL,
			}),
		).toBe(false);
	});

	it("versteht den Teamnamen in jeder üblichen Schreibweise", () => {
		for (const team of [
			"peter",
			"peter.cloudflareaccess.com",
			"https://peter.cloudflareaccess.com/",
		])
			expect(teamOrigin(team)).toBe(TEAM);
	});
});
