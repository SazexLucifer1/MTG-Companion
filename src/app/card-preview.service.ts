import { Injectable, signal } from '@angular/core';

/**
 * Globaler Zustand für die "Karte groß anzeigen"-Vorschau - überall dort einsetzbar, wo ein kleines
 * Kartenbild angezeigt wird und man es zum Durchlesen vergrößern können soll (z.B. Stats- und
 * Profil-Tab). Gleiches Muster wie DeckPdfService/ManualDeckLinkService: eigener Overlay-Dialog,
 * einmal root-level in app.html gerendert.
 */
@Injectable({ providedIn: 'root' })
export class CardPreviewService {
  readonly imageUrl = signal<string | null>(null);
  readonly backImageUrl = signal<string | null>(null);
  readonly alt = signal('');

  open(imageUrl: string, backImageUrl: string | null | undefined, alt: string | undefined): void {
    this.imageUrl.set(imageUrl);
    this.backImageUrl.set(backImageUrl ?? null);
    this.alt.set(alt ?? '');
  }

  close(): void {
    this.imageUrl.set(null);
  }
}
