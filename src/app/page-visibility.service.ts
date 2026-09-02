import { Injectable, signal } from '@angular/core';

/**
 * Ein einziger Ort, an dem "liegt der Tab gerade im Hintergrund?" als Signal bereitsteht.
 * Vorher hätte jede interessierte Stelle einen eigenen visibilitychange-Listener gebraucht; mit
 * dem Signal genügt ein effect().
 *
 * Nutzen: Hintergrund-Tabs werden von den Browsern ohnehin gedrosselt und bei Speicherdruck
 * weggeräumt. Dauerarbeit (Polling) im Hintergrund bringt also nichts, kostet aber Akku,
 * Datenvolumen und Speicher - und je mehr Speicher der Tab hält, desto eher räumt ihn vor allem
 * iOS ab, was beim Zurückkommen als weißer Bildschirm endet.
 */
@Injectable({ providedIn: 'root' })
export class PageVisibilityService {
  readonly visible = signal(document.visibilityState === 'visible');

  /** Wie lange der Tab beim letzten Mal im Hintergrund lag (ms, 0 = war noch nie weg). */
  readonly lastHiddenDurationMs = signal(0);

  private hiddenSince = 0;

  constructor() {
    document.addEventListener('visibilitychange', () => this.sync());

    // pageshow feuert zusätzlich, wenn die Seite aus dem Vor-/Zurück-Cache (bfcache) kommt - dabei
    // gibt es nicht zwangsläufig ein visibilitychange-Event.
    window.addEventListener('pageshow', () => this.sync());
  }

  private sync(): void {
    const isVisible = document.visibilityState === 'visible';
    if (isVisible === this.visible()) return;

    if (isVisible) {
      this.lastHiddenDurationMs.set(this.hiddenSince ? Date.now() - this.hiddenSince : 0);
      this.hiddenSince = 0;
    } else {
      this.hiddenSince = Date.now();
    }
    this.visible.set(isVisible);
  }
}
