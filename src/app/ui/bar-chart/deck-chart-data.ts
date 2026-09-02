import { BarChartDatum } from './bar-chart';

/**
 * Abbildung der Deck-Analysedaten auf Diagramm-Reihen.
 *
 * Als freie Funktionen statt als Methoden eines Services, weil die drei Deck-Ansichten ihre Daten
 * bewusst unterschiedlich beziehen: deck-detail-view über den DeckViewerService, precon-browser und
 * public-deck-browser mit eigenen lokalen Signalen (der DeckViewerService ist an Auth und
 * Mutationen gekoppelt und wäre dort fehl am Platz - siehe die Begründungen in beiden Dateien).
 * Gemeinsam ist ihnen nur die Form der Daten, und genau die kapseln diese Funktionen.
 */

/** Manakurve als Säulen. Nullwerte bleiben erhalten, damit die Kurve ihre Lücken zeigt. */
export function manaCurveChartData(
  buckets: readonly { label: string; count: number }[],
): BarChartDatum[] {
  return buckets.map((b) => ({ label: b.label, value: b.count }));
}

/** Farbverteilung, eingefärbt nach MTG-Farbe. */
export function pipChartData(
  pips: readonly { color: string; label: string; count: number }[],
): BarChartDatum[] {
  return pips
    .filter((p) => p.count > 0)
    .map((p) => ({
      label: p.label,
      value: p.count,
      color: `var(--pip-${p.color.toLowerCase()})`,
      symbol: p.color,
    }));
}

/** Kartentypen - eine Reihe, deshalb einfarbig. */
export function typeChartData(
  types: readonly { label: string; count: number }[],
): BarChartDatum[] {
  return types.filter((t) => t.count > 0).map((t) => ({ label: t.label, value: t.count }));
}
