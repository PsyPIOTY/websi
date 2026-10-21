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
  "pagePath": "/?concept=erstes-gespraech&frame=eigen",
  "status": "offen | in_arbeit | vorschlag | veroeffentlicht | verworfen",
  "external": { "adapter": "github-claude", "id": "42", "url": "…", "proposalUrl": "…" },
  "events": [{ "at": "ISO-Zeit", "kind": "erstellt", "text": "…", "by": "peter" }]
}
```

`sectionId` ist `ganze-seite` für Wünsche ohne einzelnen Abschnitt.

## HTTP-API

Alle Pfade unter `/api/websi/`, Antworten als JSON.

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `status` | Ausführer und ob sie bereit sind |
| GET | `sites` | Alle hinterlegten Websites |
| GET | `sites/:id` | Profil, Aufträge, letzter Bericht, Verzeichnisse einer Website |
| GET | `requests?site=:id` | Aufträge |
| POST | `requests` | Neuer Auftrag `{ siteId, sectionId, text, pagePath, pin?, send? }` |
| POST | `requests/:id/send` | Offenen Auftrag an den Ausführer geben |
| POST | `requests/:id/sync` | Stand beim Ausführer abfragen |
| POST | `requests/:id/followup` | Nachbessern `{ text }` |
| POST | `requests/:id/publish` | Vorschlag veröffentlichen (nur Peter) |
| POST | `requests/:id/discard` | Verwerfen |
| POST | `requests/:id/reopen` | Verworfenen Auftrag wieder öffnen |
| POST | `visibility/:id/scan` | Seiten-Check ausführen und speichern |
| PUT | `directories/:id/:dirId` | Verzeichnis-Status `{ status, note }` |

## Neuer Ausführer (z. B. OpenAI, Paco)

Eine Klasse, die `AgentAdapter` aus [`core/agent/adapter.ts`](../core/agent/adapter.ts)
erfüllt (`dispatch`, `sync`, `followUp`, `publish`, `discard`), und ein Eintrag in
[`core/agent/registry.ts`](../core/agent/registry.ts). `briefing()` liefert den
Auftrag als Klartext, den jeder Ausführer versteht.

## Bridge-Protokoll

Nachrichten zwischen Dashboard und `public/websi-bridge.js` stehen in
[`core/bridge/protocol.ts`](../core/bridge/protocol.ts).
