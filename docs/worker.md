# WEBSI-Worker

Eigenes Programm, das WEBSI-Aufträge abarbeitet: [`runner/websi-worker.ts`](../runner/websi-worker.ts).
Eine Datei, keine Abhängigkeiten, Node 22.18 oder neuer.

## Ablauf

1. WEBSI legt den Auftrag als Issue mit Label `websi` im Repo der Website an.
2. Der Worker holt das Issue und legt den Branch `websi/issue-<Nr>-<titel>` an.
3. Das gewählte Modell ändert die Dateien.
4. Prüfung (`npm test` der Website oder `WEBSI_CHECK`). Ist sie rot, gibt es einen
   zweiten Versuch mit der Fehlermeldung. Bleibt sie rot, wird nichts
   hochgeladen; der Worker schreibt den Grund ins Issue.
5. Ist sie grün: Commit, Push, Pull Request mit „Closes #<Nr>“, Kommentar im Issue.
   WEBSI zeigt den Vorschlag am Abschnitt. Gemergt wird nur über „Veröffentlichen“.
6. Schreibt Peter in WEBSI nach („Nachbessern“), arbeitet der Worker auf
   demselben Branch weiter.

## Modell wählen

Peter wählt die KI pro Auftrag in WEBSI; sie steht in den Steuerdaten des
Issues (`<!-- websi:{"engine":"codex",…} -->`). Fehlt sie, gilt `WEBSI_ENGINE`.

| Wert | Was | Kosten | Anmeldung |
| --- | --- | --- | --- |
| `claude` (Standard) | Claude Code | Peters Claude-Abo | lokal `claude login`, in GitHub Secret `CLAUDE_CODE_OAUTH_TOKEN` aus `claude setup-token` |
| `codex` | Codex | ChatGPT-Abo | `codex login` (vor allem lokal) |
| `ollama` | lokales Modell, z. B. `qwen2.5-coder:14b` | keine | [Ollama](https://ollama.com) auf dem eigenen Rechner |

`WEBSI_MODEL` wählt das Modell innerhalb des Anbieters. Das Abo wird nur über
die offiziellen Werkzeuge genutzt, wie es die Nutzungsbedingungen verlangen.
Ein weiteres Modell ist ein neuer Eintrag in `engines`.

## Wo er läuft

Peters Regel (31.10.2026): **Der Mac mini hat Vorrang. GitHub übernimmt nur
Wünsche, die seit 24 Stunden liegen.**

**Auf dem Mac mini (Hauptweg).** Siehe unten. Holt alle 10 Minuten neue Aufträge.

**In GitHub (Ersatz).** Schaut alle 6 Stunden nach und bearbeitet nur, was seit
24 Stunden niemand angefasst hat (`--older-than 24`). Die Uhr läuft ab dem
Anlegen des Auftrags bzw. ab Peters erster unbeantworteter Nachbesserung.
Ist nichts fällig, endet der Lauf nach wenigen Sekunden (`--due` zählt nur).
1. [`templates/github-action/websi-worker.yml`](../templates/github-action/websi-worker.yml)
   nach `.github/workflows/` im Repo der Website kopieren.
2. `runner/websi-worker.ts` nach `.github/websi/websi-worker.ts` kopieren.
3. Secret `CLAUDE_CODE_OAUTH_TOKEN` im Repo der Website setzen.
4. Optional: Repository-Variable `WEBSI_WAIT_HOURS`, falls die 24 Stunden
   sich ändern sollen.

Private Repos haben 2.000 freie Actions-Minuten im Monat. Die Nachschau kostet
etwa 120 Minuten im Monat (4 kurze Läufe am Tag), ein Auftrag meist wenige
Minuten. Ein Secret gilt nur für sein Repo: Jede Website mit eigenem Repo
braucht Workflow, Worker-Datei und Secret einmal.

**Auf dem eigenen Rechner (Mac mini).** Keine Actions-Minuten,
nötig für `ollama`. Im lokalen Klon der Website:

```bash
export GITHUB_TOKEN=…            # fine-grained: Issues, Pull Requests, Contents
node pfad/zu/websi-worker.ts --poll --every 10   # alle 10 Minuten
node pfad/zu/websi-worker.ts --issue 12          # ein Auftrag
node pfad/zu/websi-worker.ts --poll --every 10 --only ollama  # nur lokale Aufträge
```

## Mehrere Entwürfe zur Auswahl

Schaltet Peter im Editor „3 Entwürfe“ ein, stehen die Richtungen in den
Steuerdaten (`"drafts":["knapp","ausführlich","mutig"]`, zwei bis drei, im
Reiter „Stil“ umbenennbar). Der Worker baut je Richtung einen eigenen Branch
`websi/issue-<Nr>-entwurf-<richtung>` mit eigenem Pull Request und meldet alle
in einem Kommentar (`"drafts":[{name,branch,url,preview}]`, `"runs":3`).
Cloudflare baut jeden Branch als eigene Vorschau.

WEBSI zeigt die Entwürfe nebeneinander (am Handy zum Wischen). „Diese nehmen“
schließt die anderen Pull Requests und löscht ihre Branches; danach laufen
Nachbessern und Veröffentlichen wie bei einem einzelnen Vorschlag. Vor der
Wahl sind beide gesperrt. Jede Richtung zählt im Kontingent als ein Lauf.

## Vorschau-Link

**Ohne Token (empfohlen): Cloudflare Workers Builds.** Einmal im
Cloudflare-Dashboard das Repo der Website verbinden: Workers & Pages → die
Website → Settings → Build → „Connect“ (GitHub-Repo wählen), den
vorgeschlagenen Preview command stehen lassen und unter „Branch control“
„Enable Preview Builds“ einschalten ([`einrichten.md`](einrichten.md), Teil 3).
Neue Verbindungen nutzen seit September 2026 Worker Previews
(`npx wrangler preview`). Das braucht im Repo der Website Wrangler ab 4.135
und einen `previews`-Block in `wrangler.jsonc`; das Konzeptstudio hat beides.
Der ältere Weg (`npx wrangler versions upload`) geht genauso. Danach baut
Cloudflare jeden Vorschlags-Branch selbst und meldet die Vorschau-Adresse als
Prüfung am Commit bzw. als Kommentar am Pull Request. WEBSI liest sie dort aus (nur Adressen
derselben Website, `…-<worker>.<konto>.workers.dev`). Kein Token, keine
Actions-Minuten.

**Mit Token (Alternative).** Ist `WEBSI_PREVIEW_CMD` gesetzt (in GitHub als
Repository-Variable), baut der Worker nach dem Push selbst eine Testversion:

```
npm run build && npx wrangler versions upload --preview-alias {alias}
```

`{alias}` wird zu `websi-<Issue-Nr>`. Dafür braucht das Repo das Secret
`CLOUDFLARE_API_TOKEN` und in `wrangler.jsonc` `"preview_urls": true`.
Meldet der Worker eine Vorschau, hat sie Vorrang.

## Rückmeldung an WEBSI

Jeder Worker-Kommentar beginnt mit `<!-- websi-worker {"engine","seconds","where","preview"} -->`.
Daraus zählt WEBSI das Kontingent (Läufe, Actions-Minuten) und findet die Vorschau.

Lokal kommentiert der Worker unter Peters Konto; WEBSI erkennt seine Antworten
an der Markierung `<!-- websi-worker -->`.

## Einstellungen

| Variable | Bedeutung |
| --- | --- |
| `GITHUB_TOKEN` / `GH_TOKEN` | Zugriff auf das Repo der Website |
| `WEBSI_ENGINE`, `WEBSI_MODEL` | Standard-KI, wenn der Auftrag keine nennt; Modellname darin |
| `WEBSI_PREVIEW_CMD` | Befehl für die Vorschau, `{alias}` wird ersetzt |
| `WEBSI_CHECK` | Prüfbefehl; `-` schaltet die Prüfung ab |
| `WEBSI_BASE` | Basis-Branch, sonst der Standard-Branch des Repos |
| `WEBSI_OLLAMA_URL` | Adresse von Ollama, Standard `http://localhost:11434` |
| `WEBSI_GIT_NAME`, `WEBSI_GIT_EMAIL` | Autor der Commits |
