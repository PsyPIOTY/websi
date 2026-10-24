# Schnittstellen

Für Paco, das KI-Betriebssystem und jedes andere System, das mit WEBSI
zusammenarbeiten soll. Alle Typen stehen in [`core/types.ts`](../core/types.ts).

## Auftrag (`ChangeRequest`)

```json
{
  "id": "uuid",
  "siteId": "praxis",
  "sectionId": "offers",
  "text": "Kachel Paartherapie zuerst, Text kürzer",
  "pin": { "x": 42, "y": 18, "hint": "Paartherapie" },
  "pagePath": "/praxis",
  "status": "offen | in_arbeit | vorschlag | veroeffentlicht | verworfen",
  "engine": "claude | codex | ollama",
  "batchId": "github-claude-42",
  "external": { "adapter": "github-claude", "id": "42", "url": "…", "proposalUrl": "…", "previewUrl": "…" },
  "events": [{ "at": "ISO-Zeit", "kind": "erstellt", "text": "…", "by": "peter" }]
}
```

`sectionId` ist `ganze-seite` für Wünsche ohne einzelnen Abschnitt. `offen`
ohne `external` heißt gesammelt, noch nicht losgeschickt. Alle Wünsche mit
gleicher `batchId` sind ein Sammelauftrag: ein Issue, ein Vorschlag.

## HTTP-API

Alle Pfade unter `/api/websi/`, Antworten als JSON.

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `status` | Ausführer und ob sie bereit sind |
| GET | `sites` | Alle hinterlegten Websites |
| GET | `sites/:id` | Profil, Aufträge, letzter Bericht, Verzeichnisse einer Website |
| GET | `requests?site=:id` | Aufträge |
| POST | `requests` | Neuer Wunsch `{ siteId, sectionId, text, pagePath, pin?, engine?, send? }` |
| POST | `batches` | Sammelauftrag: alle gesammelten Wünsche einer Website `{ siteId, engine?, requestIds? }` |
| POST | `requests/:id/send` | Gesammelten Wunsch einzeln losschicken `{ engine? }` |
| POST | `requests/:id/sync` | Stand beim Ausführer abfragen |
| POST | `requests/:id/followup` | Nachbessern `{ text, remember? }` |
| POST | `requests/:id/publish` | Vorschlag veröffentlichen (nur Peter) |
| POST | `requests/:id/discard` | Verwerfen `{ reason?, remember? }` |
| POST | `requests/:id/reopen` | Verworfenen Auftrag wieder öffnen |
| POST | `visibility/:id/scan` | Seiten-Check ausführen und speichern |
| PUT | `directories/:id/:dirId` | Verzeichnis-Status `{ status, note }` |
| GET | `style/:siteId` | Stil-Gedächtnis: `{ rules, suggestions }` |
| POST | `style/:siteId` | Neue Regel `{ text, scope?: "alle" }` |
| PATCH, DELETE | `style/:siteId/:id` | Regel ändern `{ active?, text?, scope? }` oder löschen |
| GET | `hinweise` | Offene Hinweise der Monatsprüfung, siehe unten |
| POST | `hinweise/pruefen` | Monatsprüfung sofort ausführen |
| GET | `usage` | Kontingent je KI und Actions-Minuten |
| PUT | `usage/limits` | Richtwerte pro Tag `{ claude: 25, codex: 25, ollama: null }` |
| POST | `mcp` | MCP-Brücke (JSON-RPC), siehe unten |

Aktionen auf einen Wunsch eines Sammelauftrags antworten mit dem Wunsch und
`related`: allen mitgeänderten Wünschen.

## MCP-Brücke

`POST /api/websi/mcp`, Model Context Protocol über HTTP (JSON-RPC 2.0, ohne
Sitzung). Zugang mit `Authorization: Bearer <MCP_TOKEN>`. Hinter Cloudflare
Access braucht dieser eine Pfad eine Ausnahme (Bypass-Regel für
`/api/websi/mcp`), sonst kommt der Client nicht durch; das Token schützt ihn.

Werkzeuge: `websi_sites`, `websi_site`, `websi_requests`, `websi_create_request`
(sammelt standardmäßig), `websi_send_batch`, `websi_followup`, `websi_sync`,
`websi_style`, `websi_add_style_rule`, `websi_scan`, `websi_hinweise`,
`websi_pruefen`, `websi_usage`.
Veröffentlichen und Verwerfen gibt es bewusst nicht: das bleibt Peters Klick.

Beispiel für einen Claude-Client:

```json
{ "mcpServers": { "websi": { "type": "http", "url": "https://<websi-adresse>/api/websi/mcp",
  "headers": { "Authorization": "Bearer <MCP_TOKEN>" } } } }
```

## Monatsprüfung (Hinweise)

Meldet sich nur, wenn etwas zu tun ist (Peters Wahl). Läuft täglich um 05:00
UTC per Cron, zählt die Aufrufe der Vortage und prüft ab dem 4. einmal im Monat
jede Website mit `stage: "live"`:

| Art | Meldet, wenn | Quelle |
| --- | --- | --- |
| `links` | ein Link 404, 410, 5xx oder gar nicht antwortet, zweimal geprüft | die Seiten selbst |
| `google` | ein Suchbegriff aus dem Profil im Monatsschnitt 3 Plätze oder von Seite 1 fällt, ab 10 Einblendungen | Search Console |
| `besuche` | 40 % weniger Aufrufe pro Tag als im Vormonat, ab 50 Aufrufen und mit Zahlen für 80 % der Tage | Cloudflare Web Analytics |

Die Schwellen stehen in `SCHWELLEN` in [`core/monitor.ts`](../core/monitor.ts).
Je Hinweis legt WEBSI einen Auftrag an: gesammelt, `ganze-seite`, Ereignis von
`websi`. Er wartet, bis Peter ihn losschickt oder verwirft. Verworfenes kommt
nicht wieder, reparierte Links erledigen sich von selbst, höchstens ein offener
Hinweis je Art und Website.

```json
{
  "hinweise": [{
    "id": "uuid", "siteId": "praxis", "site": "Praxis Peter Jarek", "kind": "google",
    "key": "google:2026-10",
    "title": "Praxis Peter Jarek bei Google gefallen",
    "detail": "„Psychologe Bad Belzig“: Platz 6 → 11. WEBSI hat einen Auftrag vorbereitet.",
    "requestId": "uuid", "createdAt": "ISO-Zeit",
    "link": "https://<websi-adresse>/#site=praxis&tab=auftraege&auftrag=<requestId>"
  }],
  "pruefung": {
    "tag": { "at": "ISO-Zeit", "fehler": [] },
    "monat": { "key": "2026-10", "at": "ISO-Zeit", "hinweise": 1, "fehler": [] }
  }
}
```

Für Pacos „Wartet auf dich“: `title` und `detail` zeigen, „ansehen“ öffnet
`link` (WEBSI zeigt den vorbereiteten Auftrag mit „Einzeln senden“). Die
`fehler` sind für Paco, nicht für Peter.

Einschalten, sobald die Seite online ist: im Profil `stage: "live"` und
`seo.statistik` (`cloudflareSiteTag`, `searchConsole`, z. B.
`sc-domain:peterjarek.de`), dazu `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN` (nur
„Account Analytics: Read“) und `GSC_SERVICE_ACCOUNT` (JSON-Schlüssel eines
Google-Dienstkontos, in Search Console als Nutzer mit eingeschränkten Rechten
eingetragen) per `wrangler secret put`. Der Zähler ohne Cookies kommt als eine
Zeile in die Seite, die Datenschutzerklärung nennt ihn. Fehlt eine Quelle,
entfällt nur diese Prüfung. Der kostenlose Cloudflare-Plan erlaubt 50 Abrufe je
Lauf: WEBSI hört bei 45 auf und prüft höchstens 25 Links je Website.

## Neue KI oder neuer Ausführer

Eine weitere KI im Worker: ein Eintrag in `engines` in
[`runner/websi-worker.ts`](../runner/websi-worker.ts) und in
[`core/engines.ts`](../core/engines.ts).

Ein ganz anderer Ausführer (z. B. Paco direkt): eine Klasse, die `AgentAdapter`
aus [`core/agent/adapter.ts`](../core/agent/adapter.ts) erfüllt (`dispatch(job)`,
`sync`, `followUp`, `publish`, `discard`), und ein Eintrag in
[`core/agent/registry.ts`](../core/agent/registry.ts). `briefing(job)` liefert
den Auftrag als Klartext, auch für Sammelaufträge, samt Peters Stilregeln.

## Bridge-Protokoll

Nachrichten zwischen Dashboard und `public/websi-bridge.js` stehen in
[`core/bridge/protocol.ts`](../core/bridge/protocol.ts).
