---
description: Neue Funktion — erst abstimmen, dann bauen
argument-hint: <was die Funktion können soll>
---

Baue diese neue Funktion: $ARGUMENTS

**Erst planen, dann schreiben.** Bevor du eine Zeile änderst:

1. Bestimme über die Architektur-Karte in `CLAUDE.md`, welche Dateien betroffen sind — Komponente, Service, `models.ts`, das passende Modul in `src/app/i18n/`, ggf. `sql/` und `public/_headers`.
2. Prüfe, was schon existiert: Bausteine in `src/app/ui/`, passende Services, ähnliche Funktionen an anderer Stelle. Wiederverwenden schlägt neu bauen.
3. Nenne dem User in wenigen Zeilen: welche Dateien du anfasst, wie sich die Funktion bedienen lässt, und was du bewusst _nicht_ machst.
4. **Stelle offene Fragen jetzt** — nicht mitten in der Umsetzung und nicht durch Raten. Nutze dafür `AskUserQuestion`.

Beim Umsetzen:

- Neue Komponenten bekommen keine Spec-Datei (`skipTests: true`).
- Alle sichtbaren Texte über das passende Modul in `src/app/i18n/`, in **beiden** Sprachen (stehen dort direkt untereinander) — nichts fest ins Template schreiben. Ein neues Key-Präfix muss zusätzlich in `src/app/i18n/i18n-keys.spec.ts` eingetragen werden.
- Neue Datenfelder brauchen einen Eintrag in `models.ts` bzw. `tournament.models.ts`.
- Neue externe Domains müssen in die CSP in `public/_headers`.
- Datenbankänderungen als datiertes Skript in `sql/`.
- **Neue Dateien gehören in die Architektur-Karte.** Wer eine Komponente, einen Service, einen Baustein in `src/app/ui/` oder ein i18n-Modul anlegt, trägt sie im selben PR in `CLAUDE.md` ein — sonst schickt die Karte die nächste Session ins Leere.

Zum Schluss:

1. `npm run build`
2. `npm run check:map` — prüft, ob die Karte in `CLAUDE.md` noch zum Repo passt. Meldet er etwas, ist die Karte nachzuziehen, nicht der Check zu umgehen.
3. **Screenshot als Nachweis**, wenn die Funktion sichtbar ist: `npm start` und die Funktion in der laufenden App durchklicken (Ablauf und Test-Accounts stehen in `CLAUDE.md`). Ein grüner Build belegt nicht, dass die Funktion bedienbar ist.
4. Committen, pushen, PR anlegen (siehe `CLAUDE.md`).
