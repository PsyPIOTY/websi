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

## Modell wählen (`WEBSI_ENGINE`)

| Wert | Was | Kosten | Anmeldung |
| --- | --- | --- | --- |
| `claude` (Standard) | Claude Code | Peters Claude-Abo | lokal `claude login`, in GitHub Secret `CLAUDE_CODE_OAUTH_TOKEN` aus `claude setup-token` |
| `codex` | Codex | ChatGPT-Abo | `codex login` (vor allem lokal) |
| `ollama` | lokales Modell, z. B. `qwen2.5-coder:14b` | keine | [Ollama](https://ollama.com) auf dem eigenen Rechner |

`WEBSI_MODEL` wählt das Modell innerhalb des Anbieters. Das Abo wird nur über
die offiziellen Werkzeuge genutzt, wie es die Nutzungsbedingungen verlangen.
Ein weiteres Modell ist ein neuer Eintrag in `engines`.

## Wo er läuft

**In GitHub (empfohlen).** Startet nur, wenn ein Auftrag kommt.
1. [`templates/github-action/websi-worker.yml`](../templates/github-action/websi-worker.yml)
   nach `.github/workflows/` im Repo der Website kopieren.
2. `runner/websi-worker.ts` nach `.github/websi/websi-worker.ts` kopieren.
3. Secret `CLAUDE_CODE_OAUTH_TOKEN` im Repo der Website setzen.

Private Repos haben 2.000 freie Actions-Minuten im Monat; ein Auftrag braucht
meist wenige Minuten. Hinweis: Ein Pull Request, den die Action anlegt, startet
selbst keine weiteren Workflows (Regel von GitHub).

**Auf dem eigenen Rechner.** Keine Actions-Minuten, nötig für `ollama`.
Im lokalen Klon der Website:

```bash
export GITHUB_TOKEN=…            # fine-grained: Issues, Pull Requests, Contents
node pfad/zu/websi-worker.ts --poll --every 10   # alle 10 Minuten
node pfad/zu/websi-worker.ts --issue 12          # ein Auftrag
```

Lokal kommentiert der Worker unter Peters Konto; WEBSI erkennt seine Antworten
an der Markierung `<!-- websi-worker -->`.

## Einstellungen

| Variable | Bedeutung |
| --- | --- |
| `GITHUB_TOKEN` / `GH_TOKEN` | Zugriff auf das Repo der Website |
| `WEBSI_ENGINE`, `WEBSI_MODEL` | Modell, siehe oben |
| `WEBSI_CHECK` | Prüfbefehl; `-` schaltet die Prüfung ab |
| `WEBSI_BASE` | Basis-Branch, sonst der Standard-Branch des Repos |
| `WEBSI_OLLAMA_URL` | Adresse von Ollama, Standard `http://localhost:11434` |
| `WEBSI_GIT_NAME`, `WEBSI_GIT_EMAIL` | Autor der Commits |
