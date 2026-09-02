/**
 * Geometrie des Netzdiagramms (ui/radar-chart).
 *
 * Liegt außerhalb der Komponente, weil es reine Mathematik ist - so bleibt sie ohne TestBed
 * testbar, dieselbe Aufteilung wie bei color-combo-names.ts und color-filter-match.ts.
 *
 * Koordinatensystem: ein Quadrat 0..100 mit dem Mittelpunkt (50|50). Es passt damit auf beides -
 * auf ein SVG mit viewBox "0 0 100 100" und auf Prozentangaben in einem quadratischen HTML-Kasten.
 * Das Diagramm braucht genau diese Doppelnutzung: die Fläche wird als SVG gezeichnet, die
 * Beschriftungen der Achsen werden als HTML darüber gelegt.
 */

export interface RadarPoint {
  readonly x: number;
  readonly y: number;
}

/** Mittelpunkt der 100er-Skala. */
const CENTER = 50;

/**
 * Punkt auf dem Strahl der index-ten von count Achsen, im Abstand radius vom Mittelpunkt.
 *
 * Die erste Achse zeigt nach oben (-90°), die weiteren folgen im Uhrzeigersinn. Oben statt rechts,
 * weil eine Spitze nach oben die gewohnte Ausrichtung eines Netzdiagramms ist - bei sechs Achsen
 * ergibt das ein stehendes Sechseck statt eines liegenden.
 */
export function axisPoint(index: number, count: number, radius: number): RadarPoint {
  if (count <= 0) return { x: CENTER, y: CENTER };
  const angle = (-90 + (360 / count) * index) * (Math.PI / 180);
  return {
    x: round(CENTER + Math.cos(angle) * radius),
    y: round(CENTER + Math.sin(angle) * radius),
  };
}

/**
 * Eckpunkte einer Fläche mit einem eigenen Radius je Achse, fertig für das points-Attribut eines
 * SVG-Polygons.
 */
export function polygonPoints(radii: readonly number[]): string {
  return radii.map((radius, index) => stringify(axisPoint(index, radii.length, radius))).join(' ');
}

/** Gleichmäßiges Vieleck für einen Gitterring - alle Achsen auf demselben Radius. */
export function ringPoints(count: number, radius: number): string {
  return polygonPoints(Array.from({ length: count }, () => radius));
}

function stringify(point: RadarPoint): string {
  return `${point.x},${point.y}`;
}

/** Drei Nachkommastellen reichen auf einer 100er-Skala und halten das erzeugte SVG lesbar. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
