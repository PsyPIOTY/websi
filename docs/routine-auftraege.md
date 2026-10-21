# Weg B: Claude-Routine im Abo

Eine Routine in Peters Claude-Konto arbeitet offene WEBSI-Aufträge in festen
Abständen ab. Keine API-Kosten, keine GitHub-Actions-Minuten. Für WEBSI ist es
derselbe Ablauf wie Weg A: Issue rein, Branch bzw. Pull Request raus.

**Repository:** das Repo der Website (z. B. `PsyPIOTY/psychologe-konzeptstudio`)
**Rhythmus:** z. B. alle 30 Minuten

## Auftrag an die Routine

```
Arbeite offene WEBSI-Aufträge in diesem Repository ab.

1. Suche offene Issues mit dem Label "websi", zu denen es noch keinen Branch
   "claude/issue-<Nummer>-…" und keinen Pull Request gibt. Gibt es keine: beenden.
   Bei Issues mit einem neuen Kommentar von PsyPIOTY nach deinem letzten
   Vorschlag gilt der Kommentar als Nachbesserung zum bestehenden Branch.
2. Pro Issue: Branch "claude/issue-<Nummer>-<kurzer-titel>" von main anlegen.
3. Genau das umsetzen, was im Issue steht, nur im genannten Abschnitt.
   Peters Ton und Stil beibehalten. Keine KI-artig aussehenden Bilder.
4. Tests, Typprüfung und Lint ausführen; alles muss grün sein.
5. Pull Request nach main öffnen, Beschreibung auf Deutsch, mit "Closes #<Nummer>".
   Nicht mergen: Peter veröffentlicht selbst in WEBSI.
6. Im Issue kurz kommentieren, was geändert wurde (2–4 Sätze).
```
