# WEBSI

Peters Werkstatt für alle seine Websites: ansehen, Abschnitt für Abschnitt
ändern lassen, Sichtbarkeit in Google verbessern. Nur Peter nutzt WEBSI, und
nur Peter veröffentlicht.

## Was WEBSI kann

**Editor.** Die aktive Website erscheint live. Unter jedem Abschnitt hängt ein
Nachrichtenfeld: Wunsch tippen, optional eine Stelle markieren, senden. Der
Wunsch wird ein Auftrag an den Agenten. Status, Antworten und Vorschlag
erscheinen direkt am Abschnitt und im Auftragsverlauf. „Veröffentlichen“ führt
den Vorschlag zusammen; ohne diesen Klick geht nichts live.

**Sichtbarkeit.** Seiten-Check mit Punktzahl (0–100) und Verlauf, die drei
wichtigsten nächsten Schritte (jeweils mit einem Klick als Auftrag), Abdeckung
der Suchbegriffe, alle Prüfungen nach Technik, Inhalte, Lokal und KI-Suche,
Stand der Verzeichniseinträge (Google-Profil, Bing, therapie.de …).

**Aufträge.** Alle Wünsche der aktiven Website mit Filter nach Status.

Bearbeitet wird immer genau eine Website. Beim Wechsel lädt WEBSI deren Profil
(`sites/*.ts`) und alle zugehörigen Daten.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `core/` | Kernmodell und Schnittstellen, ohne Abhängigkeit zu React, Cloudflare oder KI-Anbieter |
| `core/agent/` | Agent-Adapter: Claude über GitHub (Abo), Testmodus; OpenAI folgt |
| `core/seo/` | Seiten-Check und Maßnahmen |
| `sites/` | Ein Profil pro Website: Adresse, Repo, Abschnitte, Suchbegriffe, Verzeichnisse |
| `worker/` | Cloudflare Worker: API, Speicher (D1), Live-Vorschau |
| `public/websi-bridge.js` | Läuft in der angezeigten Website und hängt die Nachrichtenfelder ein |
| `src/` | Dashboard (React) |
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
Abgearbeitet wird über Peters Claude-Abo, auf einem von zwei Wegen:

- **Weg A, GitHub Action:** [`templates/github-action/websi-claude.yml`](templates/github-action/websi-claude.yml)
  ins Repo der Website kopieren, Secret `CLAUDE_CODE_OAUTH_TOKEN` setzen
  (`claude setup-token`). Sofort, verbraucht Actions-Minuten.
- **Weg B, Claude-Routine:** [`docs/routine-auftraege.md`](docs/routine-auftraege.md).
  Holt in festen Abständen ab, keine Actions-Minuten.

WEBSI selbst braucht dafür ein GitHub-Token (fine-grained, nur für die
Website-Repos: Issues, Pull Requests und Contents lesen/schreiben).

## Veröffentlichen auf Cloudflare

1. `npx wrangler d1 create websi` und die ausgegebene `database_id` in
   `wrangler.jsonc` eintragen. Die Tabellen legt der Worker selbst an.
2. `npx wrangler secret put GITHUB_TOKEN`
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
