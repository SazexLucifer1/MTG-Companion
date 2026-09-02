import { Component, computed, input } from '@angular/core';
import { ManaSymbol } from '../mana-symbol/mana-symbol';
import { barPercent, maxValue } from '../chart-scale';
import { axisPoint, polygonPoints, ringPoints } from './radar-geometry';

export interface RadarChartDatum {
  /** Name der Achse - trägt die Identität, wenn kein Manasymbol gesetzt ist, und beschriftet es sonst. */
  label: string;
  value: number;
  /** Eigene Farbe des Achsenpunkts, z.B. eine Pip-Farbe. Ohne Angabe der Akzentton. */
  color?: string;
  /** Manafarbe (W/U/B/R/G/C), die als Symbol an der Achse steht - siehe BarChartDatum.symbol. */
  symbol?: string;
}

/**
 * Radius des äußersten Gitterrings, im Koordinatensystem 0..100 mit dem Mittelpunkt 50.
 *
 * Deutlich kleiner als 50: der Rand gehört den Beschriftungen. Das SVG selbst füllt die ganze
 * quadratische Fläche aus, statt eingerückt darin zu sitzen - so ist eine SVG-Einheit exakt ein
 * Prozent der Fläche und die als HTML gesetzten Beschriftungen sitzen ohne Umrechnung auf
 * denselben Achsen wie die gezeichneten Punkte.
 */
const PLOT_RADIUS = 34;

/**
 * Gitterringe als Anteil des äußeren Radius. Drei Ringe: der äußere begrenzt die Fläche, die
 * beiden inneren geben dem Auge eine grobe Skala ("ungefähr die Hälfte"), ohne dass Zahlen an den
 * Ringen stehen müssten - die exakten Werte stehen ohnehin an den Achsen.
 */
const RING_STEPS = [1, 0.66, 0.33];

/**
 * Abstand der Achsenbeschriftungen vom Mittelpunkt, in derselben Skala. Kleiner als 50, damit die
 * Beschriftungen innerhalb der Fläche bleiben und in der schmalsten Rasterspalte des Profils nicht
 * am Kartenrand abgeschnitten werden.
 */
const LABEL_RADIUS = 44;

/**
 * Netzdiagramm ("Radar") für eine feste, immer gleiche Menge von Achsen.
 *
 * Der Unterschied zum Balkendiagramm ist nicht der Geschmack, sondern die Frage: Balken beantworten
 * "wer liegt vorn", ein Netz beantwortet "wie sieht das Profil aus". Für die Lieblingsfarben im
 * Profil ist Letzteres gemeint - die Achsen stehen immer in derselben Reihenfolge, damit die
 * entstehende Form wiedererkennbar bleibt und mit sich selbst über die Zeit vergleichbar ist.
 * Deshalb: NIE die Daten nach Wert sortiert hereingeben.
 *
 * Barrierefreiheit: Die Zeichnung selbst ist dekorativ und meldet sich als solche ab. Weder die
 * Fläche noch die Farbe der Achsenpunkte trägt die Identität - das tun die Beschriftungen, die als
 * echter Text (Manasymbol mit Farbnamen plus Zahl) neben den Achsen stehen. Dieselbe Regel wie in
 * meter.ts und bar-chart.ts.
 */
@Component({
  selector: 'app-radar-chart',
  imports: [ManaSymbol],
  templateUrl: './radar-chart.html',
  styleUrl: './radar-chart.scss',
})
export class RadarChart {
  /** Eine Achse je Eintrag, in fester Reihenfolge - siehe Klassenkommentar. */
  readonly data = input.required<readonly RadarChartDatum[]>();

  /** Größter Wert der Reihe, mindestens 1 - dieselbe Skalierung wie bei allen Balken der App. */
  private readonly reference = computed(() => maxValue(this.data().map((d) => d.value)));

  /**
   * Radius je Achse. Über barPercent, damit ein Wert von 1 neben einem Maximum von 40 nicht exakt
   * im Mittelpunkt verschwindet und von "gar nicht gespielt" unterscheidbar bleibt.
   */
  private readonly radii = computed(() =>
    this.data().map((d) => (barPercent(d.value, this.reference()) / 100) * PLOT_RADIUS),
  );

  /** Ohne einen einzigen Wert > 0 bliebe die Fläche ein Punkt im Zentrum - dann nur das Gitter. */
  readonly hasValues = computed(() => this.data().some((d) => d.value > 0));

  readonly rings = computed(() =>
    RING_STEPS.map((step) => ringPoints(this.data().length, PLOT_RADIUS * step)),
  );

  readonly spokes = computed(() =>
    this.data().map((_, index) => axisPoint(index, this.data().length, PLOT_RADIUS)),
  );

  readonly area = computed(() => polygonPoints(this.radii()));

  /**
   * Datenpunkte auf den Achsen. Nur Achsen mit einem Wert - ein Punkt für 0 läge exakt im
   * Mittelpunkt, wo sich alle leeren Achsen zu einem farbigen Klecks stapeln würden, der wie ein
   * Messwert aussieht.
   */
  readonly vertices = computed(() =>
    this.data()
      .map((d, index) => ({
        ...axisPoint(index, this.data().length, this.radii()[index]),
        label: d.label,
        value: d.value,
        color: d.color ?? 'var(--accent)',
      }))
      .filter((v) => v.value > 0),
  );

  readonly labels = computed(() =>
    this.data().map((d, index) => ({
      ...axisPoint(index, this.data().length, LABEL_RADIUS),
      label: d.label,
      value: d.value,
      symbol: d.symbol ?? null,
    })),
  );
}
