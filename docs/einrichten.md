# WEBSI einrichten

Einmalig am **MacBook**, etwa 20 Minuten, am besten zusammen mit Paco im
Thread. Du meldest dich nur an und fügst einen Schlüssel ein. Den Rest macht
[`scripts/einrichten-macbook.sh`](../scripts/einrichten-macbook.sh).

## Vorher

- Der WEBSI-Vorschlag mit diesem Skript ist gemergt.
- Cloudflare verlangt beim ersten Einschalten von Zero Trust eine Zahlungsart,
  auch für den Plan „Free“. Der kostet 0 €. Ohne Zero Trust gibt es keinen
  Zugangsschutz, und WEBSI bleibt für alle gesperrt.

## 1. Skript starten (MacBook)

1. Cmd+Leertaste, „Terminal“ tippen, Enter.
2. Diese Zeile einfügen, Enter:

   ```
   curl -fsSL https://raw.githubusercontent.com/PsyPIOTY/websi/main/scripts/einrichten-macbook.sh -o /tmp/websi.sh && bash /tmp/websi.sh
   ```

3. Das Skript sagt jeden Schritt an. Von dir braucht es nur:
   - **Cloudflare:** Im Browser anmelden und „Allow“ klicken.
   - **GitHub-Schlüssel:** Die Seite öffnet sich fast fertig ausgefüllt. Bei
     „Repository access“ „Only select repositories“ und
     psychologe-konzeptstudio wählen, unten „Generate token“, den Schlüssel
     kopieren und im Terminal einfügen.
   - **Zugangsschutz:** Bei websi den Reiter „Access“, dann „Protect this
     Worker behind Access“, „All traffic“, „Cloudflare account“ und
     „Apply Access“. Fragt Cloudflare nach einem Teamnamen: z. B.
     peterjarek, Plan „Free“.
4. Am Ende öffnet sich WEBSI. Der Block „Für Paco“ liegt schon in der
   Zwischenablage: im Thread einfügen. Darin stehen keine Geheimnisse.

Geht etwas schief: Bildschirmfoto an Paco, dann dieselbe Zeile noch einmal.
Das Skript erkennt, was schon fertig ist. Dieselbe Zeile bringt auch später
eine neue WEBSI-Fassung online.

## 2. iPhone

In Safari die WEBSI-Adresse öffnen, anmelden, dann „Teilen“ und „Zum
Home-Bildschirm“.

## 3. Veröffentlichen (nach deiner Antwort zu E2)

Empfehlung: Cloudflare baut die Website selbst, sobald du einen Vorschlag
mergst, und zeigt vorher eine Vorschau. Kein Terminal, keine GitHub-Minuten.

[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages),
dann konzeptstudio, „Settings“, „Builds“, „Connect“:

| Feld | Eintrag |
| --- | --- |
| Git repository | PsyPIOTY/psychologe-konzeptstudio |
| Git branch | main |
| Build command | `npm run build` |
| Deploy command, Preview command | so lassen |

Cloudflare baut erst beim nächsten Merge. Darum danach den
Konzeptstudio-Vorschlag mit der Praxisseite mergen; ab dann zeigt WEBSI die
Praxisseite unter `/praxis`. Ist er schon gemergt, hat Paco einen kleinen
Vorschlag für den ersten Bau bereit.

Optional genauso für websi selbst (Repo PsyPIOTY/websi), sobald Paco die
Datenbank aus dem Block „Für Paco“ eingetragen hat. Dann kommt jede neue
WEBSI-Fassung nach deinem Merge-Klick von selbst online.

## 4. WEBSI-Worker (nach deiner Antwort zu E1)

Der Worker setzt deine Wünsche in Vorschläge um
([`worker.md`](worker.md)). Empfehlung: auf dem Mac mini. Das richtet Paco
über den Thread „Gesamttest und Urlaubsplan“ ein.
