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

Zum Schluss: `npm run build`, dann committen, pushen, PR anlegen (siehe `CLAUDE.md`).
