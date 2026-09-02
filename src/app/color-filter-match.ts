/**
 * Auswahl und Abgleich der Farbfilter (Kartensuche, Deckbau, Deck- und Precon-Kartenlisten).
 *
 * Liegt außerhalb der Filter-Komponente, weil die Bedeutung einer Auswahl nicht der Bedienung
 * gehört: die Kartenlisten prüfen sie lokal gegen die Farbidentität, die Kartensuche baut daraus
 * eine Scryfall-Abfrage (siehe scryfall.service.ts). Beide müssen dasselbe meinen.
 */

/** Die fünf Manafarben in der üblichen WUBRG-Reihenfolge. */
export const FILTER_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/** Eigene Auswahl für "gar keine Farbe" - schließt die fünf Farben aus und wird von ihnen ausgeschlossen. */
export const COLORLESS = 'C';

/**
 * Gewählte Farben, immer in WUBRG-Reihenfolge. Leer = keine Einschränkung, ['C'] = nur farblose
 * Karten.
 */
export type ColorSelection = readonly string[];

/**
 * Schaltet eine Farbe an oder aus. "Farblos" und echte Farben schließen sich gegenseitig aus -
 * eine Karte ohne Farbidentität kann nicht gleichzeitig weiß sein, die Kombination wäre immer leer.
 */
export function toggleColorSelection(selection: ColorSelection, color: string): string[] {
  if (color === COLORLESS) return selection.includes(COLORLESS) ? [] : [COLORLESS];
  const withoutColorless = selection.filter((c) => c !== COLORLESS);
  const next = withoutColorless.includes(color)
    ? withoutColorless.filter((c) => c !== color)
    : [...withoutColorless, color];
  return FILTER_COLORS.filter((c) => next.includes(c));
}

/**
 * Passt eine Farbidentität zur Auswahl?
 *
 * Mehrere Farben sind UND-verknüpft: Weiß + Blau findet alles, was mindestens Weiß UND Blau in der
 * Identität hat - also genau die mehrfarbigen Karten dieser Kombination. Eine einzelne Farbe
 * bedeutet damit weiterhin "enthält diese Farbe" wie vorher, man kann jetzt nur weiter
 * einschränken.
 */
export function matchesColorSelection(identity: readonly string[], selection: ColorSelection): boolean {
  if (selection.length === 0) return true;
  if (selection.includes(COLORLESS)) return identity.length === 0;
  return selection.every((color) => identity.includes(color));
}
