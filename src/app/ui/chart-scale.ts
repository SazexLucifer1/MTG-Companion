/**
 * Gemeinsame Skalierung für alle Balken der App.
 *
 * Die Logik stand vorher dreifach kopiert in deck-detail-view.ts, precon-browser.ts und
 * public-deck-browser.ts (curveBarHeight/pipBarWidth/typeBarWidth) und im Statistik-Tab gar
 * nicht - dort war die Balkenbreite direkt der Prozentwert, was für Absolutwerte wie "Spiele"
 * nicht funktioniert.
 */

/**
 * Mindestanteil in Prozent für Werte > 0.
 *
 * Ohne diese Untergrenze verschwindet ein Wert wie 1 neben einem Maximum von 40 zu einem
 * unsichtbaren Strich und ist von "gar kein Wert" nicht mehr zu unterscheiden.
 */
export const MIN_VISIBLE_PERCENT = 6;

/** Größter Wert einer Reihe, mindestens 1 - verhindert Division durch 0 bei leeren Datensätzen. */
export function maxValue(values: readonly number[]): number {
  return Math.max(1, ...values);
}

/** Anteil eines Werts am Maximum, in Prozent, mit Mindestsichtbarkeit für Werte > 0. */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(100, Math.max(MIN_VISIBLE_PERCENT, (value / max) * 100));
}
