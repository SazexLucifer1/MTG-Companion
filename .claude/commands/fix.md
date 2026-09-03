---
description: Fehler beheben — gezielt, minimal, mit Verifikation
argument-hint: <Bereich>: <was passiert> statt <was passieren sollte>
---

Behebe diesen Fehler: $ARGUMENTS

Ablauf:

1. **Bereich bestimmen** über die Architektur-Karte in `CLAUDE.md` bzw. die Vokabular-Tabelle in `PROMPTING.md`. Erst wenn der Bereich danach immer noch unklar ist, breiter suchen.
2. **Gezielt greppen** statt große Dateien zu lesen. Bei den in `CLAUDE.md` gelisteten Dateien >1000 Zeilen mit `offset`/`limit` nur den relevanten Abschnitt lesen.
3. **Ursache verstehen, bevor du etwas änderst.** Wenn du das Verhalten nicht erklären kannst, ist die Änderung geraten — dann lieber nachfragen.
4. **Minimal reparieren.** Keine Refactorings, keine Umbauten am Umfeld, keine Verbesserungen nebenbei.
5. `npm run typecheck`, dann `npm run build`. Wurden dabei Dateien umbenannt oder angelegt, zusätzlich `npm run check:map` und die Karte in `CLAUDE.md` nachziehen.
6. **War der Fehler sichtbar, mit einem Screenshot belegen, dass er weg ist** — `npm start` und die Stelle in der laufenden App aufsuchen (Ablauf und Test-Accounts in `CLAUDE.md`). Bei reinen Logikfehlern ohne sichtbare Wirkung entfällt das.
7. Committen, pushen, PR anlegen (siehe `CLAUDE.md`).

Im PR-Text kurz benennen, _warum_ der Fehler auftrat — nicht nur, was geändert wurde.
