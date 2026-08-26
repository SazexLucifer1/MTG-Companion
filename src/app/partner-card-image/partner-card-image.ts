import { Component, inject, input, output, signal } from '@angular/core';
import { ScryfallCard } from '../scryfall.service';
import { CardImage } from '../card-image/card-image';
import { I18nService } from '../i18n.service';

/**
 * Zeigt 1 Commander normal, bei einem Partner-Paar (2 Commander, siehe
 * ScryfallService.searchCommanderPairs()) IMMER nur eine der beiden Karten groß - mit einem
 * Umschalt-Button, welche vorne/lesbar ist (wie EDHREC es bei Partner-Seiten macht). Ersetzt die
 * vorherige "beide Karten nebeneinander in halber Größe"-Darstellung, die dafür sorgte, dass
 * Paar-Kacheln nur halb so hoch wie Solo-Kacheln wirkten (aspect-ratio wurde pro Kartenhälfte statt
 * pro Kachel berechnet). Eigenes lokales frontIndex-Signal pro Komponenteninstanz - jede @for-
 * Schleifen-Instanz bekommt ihren eigenen Zustand automatisch, ganz wie showingBack() in
 * card-image.ts (siehe dessen Kommentar).
 */
@Component({
  selector: 'app-partner-card-image',
  imports: [CardImage],
  templateUrl: './partner-card-image.html',
  styleUrl: './partner-card-image.scss',
  host: {
    '[class.compact]': 'compact()',
  },
})
export class PartnerCardImage {
  readonly i18n = inject(I18nService);

  readonly cards = input.required<ScryfallCard[]>();
  readonly compact = input(false);

  /** Karte, die gerade den Vorschau-Klick auslöst (immer die aktuell vorne stehende). */
  readonly imageClick = output<ScryfallCard>();

  readonly frontIndex = signal(0);

  get frontCard(): ScryfallCard {
    return this.cards()[this.frontIndex()] ?? this.cards()[0];
  }

  swapFront(event: Event): void {
    // Verhindert, dass der Umschalt-Klick eine umschließende klickbare Kachel/Zeile mit-auslöst -
    // gleiches Muster wie CardImage.toggleFlip().
    event.stopPropagation();
    this.frontIndex.update((i) => (i === 0 ? 1 : 0));
  }

  onImageClick(): void {
    this.imageClick.emit(this.frontCard);
  }
}
