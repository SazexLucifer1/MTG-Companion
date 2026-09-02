---
description: Layout, Aussehen und Bedienung anpassen
argument-hint: <Bereich>: <was stört> → <Zielzustand>
---

Passe Layout bzw. Aussehen an: $ARGUMENTS

Ablauf:

1. **Erst prüfen, was es schon gibt**, bevor etwas Neues gebaut wird:
   - `src/app/ui/` — `bar-chart`, `radar-chart`, `meter`, `split-bar`, `pager`, `overflow-menu`, `color-filter`, `cmc-filter`, `mana-symbol`
   - Design-Tokens in `src/styles.scss` — Abstände `--sp-*`, Rundungen `--r-*`, Flächen, Diagrammfarben
     Keine eigenen Pixelwerte, wo ein Token passt.
2. **Mobile-first.** Die App wird auf dem iPhone in Safari benutzt. Zuerst dort denken, Desktop danach. Breakpoints in `src/styles/_breakpoints.scss`.
3. **Style-Budget beachten:** 6 kB Warnung / 12 kB Fehler pro Komponenten-`.scss`. Die großen Dateien (`deck-detail-view.scss` 796, `ingame-tracker.scss` 747) nicht weiter aufblähen — dort eher aufräumen als anhängen.
4. Nur das Aussehen ändern. Logik, Datenfluss und Services bleiben unangetastet, sofern nicht ausdrücklich anders gefragt.
5. `npm run build` (prüft auch die Budgets).
6. Committen, pushen, PR anlegen (siehe `CLAUDE.md`).

Im PR darauf hinweisen, dass die Cloudflare-Preview am besten auf dem iPhone geprüft wird.
