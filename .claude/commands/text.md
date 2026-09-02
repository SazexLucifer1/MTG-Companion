---
description: Beschriftung oder Übersetzung ändern (i18n)
argument-hint: <wo> "<alter Text>" → "<neuer Text>"
---

Ändere eine Beschriftung in der App: $ARGUMENTS

Ablauf:

1. Suche den Text gezielt — **niemals `i18n.service.ts` am Stück lesen** (2673 Zeilen):
   `grep -n "<alter Text>" src/app/i18n.service.ts`
   Wenn der Text nicht wörtlich bekannt ist, über das Key-Präfix suchen (`'match.`, `'nav.`, `'stats.` …).
2. Falls der Text nicht in `i18n.service.ts` liegt, sondern fest im Template steht: den Fund in ein `i18n`-Key umziehen, statt ihn hart zu lassen.
3. **Beide Sprachblöcke anpassen** — `de` _und_ `en`. Ein Key, den es nur in einer Sprache gibt, ist ein Bug.
4. `npm run typecheck`
5. Committen, pushen, PR anlegen (siehe `CLAUDE.md`).

Nur die genannten Texte ändern — keine weiteren Formulierungen „nebenbei" verbessern.
