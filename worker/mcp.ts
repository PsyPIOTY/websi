/**
 * MCP-Brücke: Paco, das KI-Betriebssystem oder ein Claude-Client sprechen
 * WEBSI über das Model Context Protocol an (Streamable HTTP, JSON-RPC 2.0).
 * Adresse: POST /api/websi/mcp, Zugang per Bearer-Token (MCP_TOKEN).
 *
 * Bewusst ohne Veröffentlichen und Verwerfen: das bleibt Peters Klick in WEBSI.
 */

type Handle = (request: Request) => Promise<Response | null>;

interface Tool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	/** Übersetzt den Aufruf in eine WEBSI-API-Anfrage. */
	call: (args: Record<string, unknown>) => {
		method: string;
		path: string;
		body?: unknown;
	};
}

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});
const enc = (v: unknown) => encodeURIComponent(String(v ?? ""));

export const TOOLS: Tool[] = [
	{
		name: "websi_sites",
		description: "Alle Websites in WEBSI mit Adresse und Zahl der Abschnitte.",
		inputSchema: obj({}),
		call: () => ({ method: "GET", path: "sites" }),
	},
	{
		name: "websi_site",
		description:
			"Profil einer Website (Abschnitte mit IDs, Suchbegriffe), ihre Aufträge und der letzte Sichtbarkeits-Check.",
		inputSchema: obj({ siteId: str("ID der Website, z. B. praxis") }, [
			"siteId",
		]),
		call: (a) => ({ method: "GET", path: `sites/${enc(a.siteId)}` }),
	},
	{
		name: "websi_requests",
		description: "Aufträge einer Website, neueste zuerst.",
		inputSchema: obj({ siteId: str("ID der Website") }, ["siteId"]),
		call: (a) => ({ method: "GET", path: `requests?site=${enc(a.siteId)}` }),
	},
	{
		name: "websi_create_request",
		description:
			"Neuer Änderungswunsch zu einem Abschnitt. Standard: wird gesammelt (send=false) und später als Sammelauftrag geschickt.",
		inputSchema: obj(
			{
				siteId: str("ID der Website"),
				sectionId: str("ID des Abschnitts oder ganze-seite"),
				text: str("Der Wunsch in Peters Worten"),
				engine: { type: "string", enum: ["claude", "codex", "ollama"] },
				send: { type: "boolean", description: "sofort losschicken" },
			},
			["siteId", "sectionId", "text"],
		),
		call: (a) => ({
			method: "POST",
			path: "requests",
			body: {
				siteId: a.siteId,
				sectionId: a.sectionId,
				text: a.text,
				engine: a.engine,
				pagePath: "/",
				send: a.send === true,
			},
		}),
	},
	{
		name: "websi_send_batch",
		description:
			"Schickt alle gesammelten Wünsche einer Website als einen Sammelauftrag los.",
		inputSchema: obj(
			{
				siteId: str("ID der Website"),
				engine: { type: "string", enum: ["claude", "codex", "ollama"] },
			},
			["siteId"],
		),
		call: (a) => ({
			method: "POST",
			path: "batches",
			body: { siteId: a.siteId, engine: a.engine },
		}),
	},
	{
		name: "websi_followup",
		description: "Nachbessern: weitere Nachricht zu einem laufenden Auftrag.",
		inputSchema: obj(
			{
				requestId: str("ID des Auftrags"),
				text: str("Was anders werden soll"),
			},
			["requestId", "text"],
		),
		call: (a) => ({
			method: "POST",
			path: `requests/${enc(a.requestId)}/followup`,
			body: { text: a.text },
		}),
	},
	{
		name: "websi_sync",
		description: "Fragt den Stand eines Auftrags beim Worker ab.",
		inputSchema: obj({ requestId: str("ID des Auftrags") }, ["requestId"]),
		call: (a) => ({
			method: "POST",
			path: `requests/${enc(a.requestId)}/sync`,
		}),
	},
	{
		name: "websi_style",
		description:
			"Peters Stil-Gedächtnis für eine Website (Regeln und Vorschläge).",
		inputSchema: obj({ siteId: str("ID der Website") }, ["siteId"]),
		call: (a) => ({ method: "GET", path: `style/${enc(a.siteId)}` }),
	},
	{
		name: "websi_add_style_rule",
		description: "Neue Stilregel. scope=alle gilt für jede Website.",
		inputSchema: obj(
			{
				siteId: str("ID der Website"),
				text: str("Die Regel, kurz"),
				scope: { type: "string", enum: ["site", "alle"] },
			},
			["siteId", "text"],
		),
		call: (a) => ({
			method: "POST",
			path: `style/${enc(a.siteId)}`,
			body: { text: a.text, scope: a.scope },
		}),
	},
	{
		name: "websi_scan",
		description:
			"Startet den Sichtbarkeits-Check einer Website und liefert das Ergebnis.",
		inputSchema: obj({ siteId: str("ID der Website") }, ["siteId"]),
		call: (a) => ({ method: "POST", path: `visibility/${enc(a.siteId)}/scan` }),
	},
	{
		name: "websi_hinweise",
		description:
			"Offene Hinweise der Monatsprüfung: kaputte Links, bei Google deutlich gefallen, deutlich weniger Besucher. Leer, wenn nichts zu tun ist. Je Hinweis ein vorbereiteter Auftrag und ein Link, der ihn in WEBSI öffnet.",
		inputSchema: obj({}),
		call: () => ({ method: "GET", path: "hinweise" }),
	},
	{
		name: "websi_pruefen",
		description:
			"Monatsprüfung sofort ausführen, z. B. als Test nach dem Online-Gang. Sonst läuft sie von selbst ab dem 4. jedes Monats.",
		inputSchema: obj({}),
		call: () => ({ method: "POST", path: "hinweise/pruefen" }),
	},
	{
		name: "websi_usage",
		description:
			"Kontingent: Läufe je Modell heute und Actions-Minuten im Monat.",
		inputSchema: obj({}),
		call: () => ({ method: "GET", path: "usage" }),
	},
];

interface RpcRequest {
	jsonrpc: "2.0";
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

const rpc = (id: RpcRequest["id"], result: unknown) => ({
	jsonrpc: "2.0",
	id: id ?? null,
	result,
});
const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({
	jsonrpc: "2.0",
	id: id ?? null,
	error: { code, message },
});

export const PROTOCOL_VERSION = "2025-06-18";

export async function handleMcp(request: Request, api: Handle) {
	if (request.method === "GET")
		return new Response("Nur POST", {
			status: 405,
			headers: { allow: "POST" },
		});
	if (request.method !== "POST") return new Response(null, { status: 405 });
	let payload: RpcRequest | RpcRequest[];
	try {
		payload = await request.json();
	} catch {
		return Response.json(rpcError(null, -32700, "Ungültiges JSON"), {
			status: 400,
		});
	}
	const origin = new URL(request.url).origin;
	const list = Array.isArray(payload) ? payload : [payload];
	const answers = [];
	for (const msg of list) {
		const answer = await one(msg, origin, api);
		if (answer) answers.push(answer);
	}
	if (!answers.length) return new Response(null, { status: 202 });
	return Response.json(Array.isArray(payload) ? answers : answers[0]);
}

async function one(msg: RpcRequest, origin: string, api: Handle) {
	// Benachrichtigungen (ohne id) brauchen keine Antwort.
	if (msg.id === undefined) return null;
	switch (msg.method) {
		case "initialize":
			return rpc(msg.id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: "websi", version: "0.2.0" },
				instructions:
					"WEBSI pflegt Peters Websites. Wünsche anlegen, sammeln, losschicken, Stand abfragen. Veröffentlichen kann nur Peter in WEBSI.",
			});
		case "ping":
			return rpc(msg.id, {});
		case "tools/list":
			return rpc(msg.id, {
				tools: TOOLS.map(({ name, description, inputSchema }) => ({
					name,
					description,
					inputSchema,
				})),
			});
		case "tools/call": {
			const name = String(msg.params?.name ?? "");
			const tool = TOOLS.find((t) => t.name === name);
			if (!tool)
				return rpcError(msg.id, -32602, `Unbekanntes Werkzeug: ${name}`);
			const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
			const { method, path, body } = tool.call(args);
			const res = await api(
				new Request(`${origin}/api/websi/${path}`, {
					method,
					headers: body ? { "content-type": "application/json" } : undefined,
					body: body ? JSON.stringify(body) : undefined,
				}),
			);
			const text = res ? await res.text() : '{"error":"keine Antwort"}';
			return rpc(msg.id, {
				content: [{ type: "text", text }],
				isError: !res || !res.ok,
			});
		}
		default:
			return rpcError(msg.id, -32601, `Unbekannte Methode: ${msg.method}`);
	}
}
