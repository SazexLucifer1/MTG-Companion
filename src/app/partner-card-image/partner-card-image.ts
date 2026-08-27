import { Component, inject, input, output, signal } from '@angular/core';
import { ScryfallCard } from '../scryfall.service';
import { CardImage } from '../card-image/card-image';
import { I18nService } from '../i18n.service';

/**
 * Zeigt 1 Commander normal, bei einem Partner-Paar (2 Commander, siehe
 * ScryfallService.searchCommanderPairs()) BEIDE Karten als versetzter Stapel - vordere Karte groß
 * und dominant, hintere Karte deutlich kleiner oben rechts als Ecke sichtbar (wie EDHREC es auf
 * seinen Partner-Seiten macht: eine Karte klar im Vordergrund, die andere nur als Hinweis). Klick
 * auf die kleine hintere Karte tauscht die beiden (um sie in Ruhe lesen zu können, ohne extra die
 * Vorschau zu öffnen); Klick auf die vordere Karte öffnet wie gewohnt die Vorschau (imageClick).
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

  readonly frontIndex = signal(0);

  get frontCard(): ScryfallCard {
    return this.cards()[this.frontIndex()] ?? this.cards()[0];
  }

  get backCard(): ScryfallCard {
    return this.cards()[1 - this.frontIndex()] ?? this.cards()[0];
  }

  onFrontClick(event: Event): void {
    event.stopPropagation();
    this.imageClick.emit(this.frontCard);
  }

  swapToFront(event: Event): void {
    // Bringt die hintere Karte nach vorne, um sie lesen zu können - bewusst KEIN imageClick hier,
    // sonst würde ein Antippen der kleinen hinteren Karte sofort die (unpassend große) Vorschau
    // öffnen statt sie erstmal nur im Stapel nach vorne zu holen.
    event.stopPropagation();
    this.frontIndex.update((i) => 1 - i);
  }
}
