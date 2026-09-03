---
description: Beschriftung oder Übersetzung ändern (i18n)
argument-hint: <wo> "<alter Text>" → "<neuer Text>"
---

Ändere eine Beschriftung in der App: $ARGUMENTS

Ablauf:

1. Suche den Text gezielt: `grep -rn "<alter Text>" src/app/i18n/`
   Die Texte liegen je Bereich in einer eigenen Datei unter `src/app/i18n/`; das Key-Präfix sagt, in welcher (Tabelle in `CLAUDE.md`). Ist der Bereich schon klar, direkt dort greppen.
2. Falls der Text nicht in `src/app/i18n/` liegt, sondern fest im Template steht: den Fund in ein `i18n`-Key umziehen, statt ihn hart zu lassen.
3. **Beide Sprachblöcke anpassen** — `de` _und_ `en`. Ein Key, den es nur in einer Sprache gibt, ist ein Bug.
4. `npm run typecheck`
5. Committen, pushen, PR anlegen (siehe `CLAUDE.md`).

Nur die genannten Texte ändern — keine weiteren Formulierungen „nebenbei" verbessern.
