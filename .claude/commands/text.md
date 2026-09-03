---
description: Beschriftung oder Übersetzung ändern (i18n)
argument-hint: <wo> "<alter Text>" → "<neuer Text>"
---

Ändere eine Beschriftung in der App: $ARGUMENTS

Ablauf:

1. Suche den Text gezielt: `grep -rn "<alter Text>" src/app/i18n/`
   Die Texte liegen je Bereich in einer eigenen Datei unter `src/app/i18n/`; das Key-Präfix sagt, in welcher (Tabelle in `CLAUDE.md`). Ist der Bereich schon klar, direkt dort greppen.
2. Falls der Text nicht in `src/app/i18n/` liegt, sondern fest im Template steht: **erst nachfragen**, ob er ins i18n umziehen soll. Der Umzug ist mehr als eine Textänderung — er berührt Template und Übersetzungsmodul und gehört damit nicht ungefragt in einen PR, der nur eine Beschriftung ändern sollte. Sagt der User nein, den Text an Ort und Stelle ändern.
3. **Beide Sprachblöcke anpassen** — `de` _und_ `en`. Ein Key, den es nur in einer Sprache gibt, ist ein Bug.
4. `npm run typecheck`, dann `npm run build` (`CLAUDE.md` verlangt den Prod-Build vor jedem PR).
5. Committen, pushen, PR anlegen (siehe `CLAUDE.md`).

Nur die genannten Texte ändern — keine weiteren Formulierungen „nebenbei" verbessern.
