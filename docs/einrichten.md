# WEBSI einrichten

Einmalig, zusammen mit Paco im Thread, etwa eine Stunde. Du meldest dich nur
an und fügst einen Schlüssel ein. Den Rest machen
[`scripts/einrichten-macbook.sh`](../scripts/einrichten-macbook.sh) und Paco.

| Teil | Gerät | Dauer |
| --- | --- | --- |
| 1. Skript starten | MacBook | 20 Min. |
| 2. WEBSI aufs iPhone | iPhone | 2 Min. |
| 3. Vorschau verbinden | MacBook, Browser | 10 Min. |
| 4. Helfer auf dem Mac mini | Mac mini | 10 Min. |
| 5. Erster Wunsch | iPhone | 15 Min. |

## Vorher

Cloudflare verlangt beim ersten Einschalten von Zero Trust eine Zahlungsart,
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

## 2. WEBSI aufs iPhone

In Safari die WEBSI-Adresse öffnen, anmelden, dann „Teilen“ und „Zum
Home-Bildschirm“.

## 3. Vorschau verbinden (MacBook, Browser)

Danach baut Cloudflare jeden Vorschlag als Vorschau-Link, ohne Terminal und
ohne GitHub-Minuten. Cloudflare ist dabei nur die Werkstatt: Deine Websites
bleiben bei All-Inkl.

[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages),
dann konzeptstudio, „Settings“, „Build“, „Connect“:

| Feld | Eintrag |
| --- | --- |
| Git repository | PsyPIOTY/psychologe-konzeptstudio |
| Git branch | main |
| Build command | `npm run build` |
| Deploy command | so lassen (`npx wrangler deploy`) |
| Preview command | `npx wrangler versions upload` |
| Branch control | Häkchen bei „Enable Preview Builds“ |

Dann „Connect“. Cloudflare baut erst beim nächsten Merge. Darum danach den
Konzeptstudio-Vorschlag mit der Praxisseite mergen; ab dann zeigt WEBSI die
Praxisseite unter `/praxis`. Ist er schon gemergt, hat Paco einen kleinen
Vorschlag für den ersten Bau bereit.

Optional genauso für websi selbst (Repo PsyPIOTY/websi, ohne Häkchen bei
„Enable Preview Builds“), sobald Paco die Datenbank aus dem Block „Für Paco“
eingetragen hat. Dann kommt jede neue WEBSI-Fassung nach deinem Merge-Klick
von selbst online.

## 4. Helfer auf dem Mac mini

Der Helfer setzt deine Wünsche in Vorschläge um ([`worker.md`](worker.md)):
alle 10 Minuten, mit deinem Claude-Abo, ohne GitHub-Minuten. Paco richtet ihn
über den Thread „Gesamttest und Urlaubsplan“ ein. Von dir braucht es dort nur
die Anmeldung bei Claude und einen GitHub-Schlüssel wie in Teil 1.

## 5. Erster Wunsch

In WEBSI auf dem iPhone unter einem Abschnitt der Praxisseite einen kleinen
Wunsch tippen, dann „Alle senden“. Nach etwa 10 Minuten steht der Vorschlag
am Abschnitt: „Vorschau öffnen“, dann „Veröffentlichen“ oder „Verwerfen“.
Ohne deinen Klick geht nichts online.

Unter „Stil“ stehen deine Regeln für alle Seiten, zum Beispiel „Ansprache mit
‚Sie‘“. Sie gehen mit jedem Wunsch mit. Dort kannst du sie ändern oder
abschalten.

## Später: Hinweise einschalten

Erst wenn die Praxisseite bei All-Inkl online ist, nicht am Termin. Dann
braucht es zwei Lese-Schlüssel (MacBook, etwa 15 Minuten, Paco führt dich):
einen bei Cloudflare für die Besucherzahlen, einen bei Google für Search
Console. Danach meldet sich WEBSI nur, wenn etwas zu tun ist: kaputter Link,
Google-Platz deutlich gefallen oder viel weniger Besucher.
