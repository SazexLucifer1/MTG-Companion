import { Component, computed, input } from '@angular/core';

export interface SplitSegment {
  label: string;
  value: number;
  /** CSS-Farbe des Abschnitts, z.B. 'var(--series-1)'. */
  color: string;
}

/**
 * Ein einzelner, in Abschnitte geteilter Balken - für Vergleiche, bei denen sich die Teile zu
 * einem Ganzen addieren.
 *
 * Gebaut für den Head-to-Head-Vergleich, der vorher aus drei zusammenhanglosen Zahlenkacheln
 * bestand ("Spiele", "Siege A", "Siege B"). Als geteilter Balken ist auf einen Blick sichtbar, wer
 * vorn liegt und wie deutlich.
 *
 * Zwei oder mehr Reihen bedeuten: Legende ist Pflicht. Sie steht deshalb immer unter dem Balken
 * und nennt Farbe, Name und Wert - die Identität hängt nie an der Farbe allein.
 */
@Component({
  selector: 'app-split-bar',
  templateUrl: './split-bar.html',
  styleUrl: './split-bar.scss',
})
export class SplitBar {
  readonly segments = input.required<readonly SplitSegment[]>();

  readonly total = computed(() => this.segments().reduce((sum, s) => sum + s.value, 0));

  /** Sichtbare Abschnitte - Nullwerte würden sonst als Fuge im Balken erscheinen. */
  readonly visible = computed(() => this.segments().filter((s) => s.value > 0));

  share(value: number): number {
    const total = this.total();
    return total <= 0 ? 0 : (value / total) * 100;
  }
}
