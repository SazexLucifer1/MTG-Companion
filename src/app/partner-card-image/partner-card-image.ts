import { Component, inject, input, output } from '@angular/core';
import { ScryfallCard } from '../scryfall.service';
import { CardImage } from '../card-image/card-image';
import { I18nService } from '../i18n.service';

/**
 * Zeigt 1 Commander normal, bei einem Partner-Paar (2 Commander, siehe
 * ScryfallService.searchCommanderPairs()) BEIDE Karten gleichzeitig als versetzter Stapel - vordere
 * Karte unten links groß, hintere Karte oben rechts nur teilweise sichtbar, wie EDHREC es auf
 * seinen Partner-Seiten macht. Ersetzt die vorherige "1 Karte + Umschalt-Button"-Darstellung, die
 * optisch nicht dem von EDHREC bekannten Bild entsprach. Beide Kartenhälften bleiben einzeln
 * anklickbar (eigene Vorschau je Karte, siehe imageClick).
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

  readonly imageClick = output<ScryfallCard>();

  onCardClick(card: ScryfallCard, event: Event): void {
    // Verhindert, dass ein Klick auf die hintere (teils verdeckte) Karte auch die davor liegende
    // Karten-Fläche mit-auslöst - beide Kacheln überlappen sich absichtlich.
    event.stopPropagation();
    this.imageClick.emit(card);
  }
}
