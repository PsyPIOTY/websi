# WEBSI

Peters Werkstatt für alle seine Websites: ansehen, Abschnitt für Abschnitt
ändern lassen, Sichtbarkeit in Google verbessern. Nur Peter nutzt WEBSI, und
nur Peter veröffentlicht.

## Was WEBSI kann

**Editor.** Die aktive Website erscheint live. Unter jedem Abschnitt hängt ein
Nachrichtenfeld: Wunsch tippen, optional eine Stelle markieren, sammeln. Unten
erscheinen alle gesammelten Wünsche; „Alle senden“ schickt sie als **einen
Sammelauftrag** an die gewählte KI (Claude, Codex oder lokales Modell). Wer
lieber einzeln schickt, schaltet „Sammeln“ aus. Status, Antworten und Vorschlag
erscheinen direkt am Abschnitt und im Auftragsverlauf.

**Vorschau und Vorher/Nachher.** Jeder Vorschlag kann eine eigene Testversion
der Website bekommen. WEBSI legt Live-Fassung und Vorschlag übereinander; ein
Schieber zeigt den Unterschied, beide scrollen gemeinsam. „Veröffentlichen“
führt den Vorschlag zusammen; ohne diesen Klick geht nichts live.

**Stil-Gedächtnis.** Regeln wie „Du statt Sie“ gehen mit jedem Auftrag mit, für
eine Website oder für alle. WEBSI schlägt Regeln aus Nachbesserungen und
Verwerf-Gründen vor.

**Kontingent.** Oben rechts: Läufe je KI heute und in den letzten 5 Stunden,
gemessen an Peters Richtwert, dazu die GitHub-Actions-Minuten im Monat.

**Sichtbarkeit.** Seiten-Check mit Punktzahl (0–100) und Verlauf, die drei
wichtigsten nächsten Schritte (jeweils mit einem Klick als Auftrag), Abdeckung
der Suchbegriffe, alle Prüfungen nach Technik, Inhalte, Lokal und KI-Suche,
Stand der Verzeichniseinträge (Google-Profil, Bing, therapie.de …).

**Aufträge.** Alle Wünsche der aktiven Website mit Filter nach Status.

**MCP-Brücke.** Paco, das KI-Betriebssystem oder ein Claude-Client sprechen
WEBSI über MCP an (`/api/websi/mcp`). Siehe [`docs/schnittstellen.md`](docs/schnittstellen.md).

Bearbeitet wird immer genau eine Website. Beim Wechsel lädt WEBSI deren Profil
(`sites/*.ts`) und alle zugehörigen Daten.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `core/` | Kernmodell und Schnittstellen, ohne Abhängigkeit zu React, Cloudflare oder KI-Anbieter |
| `core/agent/` | Agent-Adapter: WEBSI-Worker über GitHub, Testmodus |
| `core/engines.ts` | Die wählbaren KIs: Claude, Codex, lokales Modell |
| `core/seo/` | Seiten-Check und Maßnahmen |
| `sites/` | Ein Profil pro Website: Adresse, Repo, Abschnitte, Suchbegriffe, Verzeichnisse |
| `worker/` | Cloudflare Worker: API, Speicher (D1), Live-Vorschau |
| `public/websi-bridge.js` | Läuft in der angezeigten Website und hängt die Nachrichtenfelder ein |
| `src/` | Dashboard (React) |
| `runner/` | WEBSI-Worker: arbeitet Aufträge mit austauschbarem Modell ab |
| `templates/`, `docs/` | Vorlagen für die Abarbeitung der Aufträge, Schnittstellen |

Die Schnittstellen für andere Systeme (Paco, KI-Betriebssystem) stehen in
[`docs/schnittstellen.md`](docs/schnittstellen.md).

## Lokal starten

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run typecheck
```

Ohne `GITHUB_TOKEN` läuft der Agent im **Testmodus**: Aufträge durchlaufen alle
Stationen, ändern aber nichts.

## KI-Anschluss (ohne API-Kosten)

WEBSI legt jeden Auftrag als Issue mit Label `websi` im Repo der Website an.
Abgearbeitet wird vom eigenen **WEBSI-Worker** ([`docs/worker.md`](docs/worker.md)):
ein kleines Programm, das das Issue liest, das Modell die Dateien ändern lässt,
prüft und einen Pull Request anlegt. Das Modell ist austauschbar: Claude über
Peters Abo (Standard), Codex über ein ChatGPT-Abo oder ein lokales Modell.
Er läuft in GitHub (nur bei neuem Auftrag) oder auf dem eigenen Rechner.

Alternativen mit demselben Ablauf: die offizielle Claude-Action
([`templates/github-action/websi-claude.yml`](templates/github-action/websi-claude.yml))
oder eine Claude-Routine ([`docs/routine-auftraege.md`](docs/routine-auftraege.md)).
Nur einen Weg pro Website einschalten.

WEBSI selbst braucht dafür ein GitHub-Token (fine-grained, nur für die
Website-Repos: Issues, Pull Requests und Contents lesen/schreiben).

## Veröffentlichen auf Cloudflare

1. `npx wrangler d1 create websi` und die ausgegebene `database_id` in
   `wrangler.jsonc` eintragen. Die Tabellen legt der Worker selbst an.
2. `npx wrangler secret put GITHUB_TOKEN` und für die MCP-Brücke
   `npx wrangler secret put MCP_TOKEN` (langes Zufallswort)
3. `ALLOWED_EMAIL` in `wrangler.jsonc` auf Peters Adresse setzen und im
   Cloudflare-Dashboard unter Zero Trust → Access eine Anwendung für die
   WEBSI-Adresse anlegen (nur diese E-Mail).
4. `npm run deploy`

## Neue Website hinzufügen

1. `sites/<name>.ts` nach Vorbild von `sites/humansource.ts` anlegen:
   Adresse, Repo, Abschnitte mit CSS-Selektor, Suchbegriffe, Verzeichnisse.
2. In `sites/index.ts` eintragen.
3. Im Editor prüfen: Die Abschnittsliste zeigt „nicht gefunden“, wenn ein
   Selektor nicht passt.
