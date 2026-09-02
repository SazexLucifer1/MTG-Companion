import { Component, computed, input } from '@angular/core';
import { barPercent } from '../chart-scale';

/**
 * Einzelner Balken (Schiene + Füllung) zum Einbetten in eine bestehende Zeile.
 *
 * Ersetzt die sieben handkopierten .bar/.bar-fill-Blöcke im Statistik-Tab. Bewusst nur der Balken
 * ohne Label/Wert: die Ranglisten-Zeilen dort haben schon Avatar, Namen, Kartenbild und Textwert
 * und sollen ihre Struktur behalten.
 *
 * Barrierefreiheit: An allen Einsatzorten steht der Zahlenwert bereits als Text direkt daneben.
 * Ohne ariaLabel meldet sich der Balken deshalb als rein dekorativ ab, statt Screenreadern
 * dieselbe Zahl ein zweites Mal vorzulesen.
 */
@Component({
  selector: 'app-meter',
  templateUrl: './meter.html',
  styleUrl: './meter.scss',
})
export class Meter {
  readonly value = input.required<number>();
  /** Bezugsgröße. Standard 100, damit Prozentwerte ohne weitere Angabe direkt passen. */
  readonly max = input(100);
  /** Eigene Füllfarbe (z.B. eine Pip-Farbe). Ohne Angabe der Akzent-Verlauf. */
  readonly color = input<string | null>(null);
  /** Gesetzt = der Balken wird selbst angesagt. Leer = dekorativ, weil der Wert daneben steht. */
  readonly ariaLabel = input<string | null>(null);
  /** Kräftigerer Balken für Stellen, an denen er das Hauptelement der Zeile ist. */
  readonly thick = input(false);

  readonly percent = computed(() => barPercent(this.value(), this.max()));
}
