// NEU
import { Injectable, signal } from '@angular/core';

/**
 * Steuert das Overlay der öffentlichen Kartensuche (ohne Account nutzbar, siehe Fan-Content-Policy
 * "kostenfrei"-Anforderung). Gleiches Muster wie LegalPageService/CardPreviewService: kein Router
 * vorhanden, ein Signal steuert Sichtbarkeit, root-level in app.html eingebunden, damit die Suche
 * auch abgemeldet erreichbar ist.
 */
@Injectable({ providedIn: 'root' })
export class PublicCardSearchService {
  readonly active = signal(false);

  open(): void {
    this.active.set(true);
  }

  close(): void {
    this.active.set(false);
  }
}
