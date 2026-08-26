// NEU
import { Component, inject, signal } from '@angular/core';
import { PublicCardSearch } from '../public-card-search/public-card-search';
import { CommanderRecommendations } from '../commander-recommendations/commander-recommendations';
import { PreconBrowser } from '../precon-browser/precon-browser';
import { PublicDeckBrowser } from '../public-deck-browser/public-deck-browser';
import { I18nService } from '../i18n.service';

/**
 * "Suche"-Tab zwischen Match und Stats - ohne Account nutzbar (Fan-Content-Policy). Umschalter
 * zwischen Kartensuche (mit Filtern), Commander-Empfehlungen (EDHREC), Precon-Browser (MTGJSON) und
 * öffentlichem Deck-Browser (andere Nutzer, nicht-private Decks - siehe public-deck.service.ts und
 * sql/public-deck-browse-2026-08-26.sql).
 */
@Component({
  selector: 'app-search-tab',
  imports: [PublicCardSearch, CommanderRecommendations, PreconBrowser, PublicDeckBrowser],
  templateUrl: './search-tab.html',
  styleUrl: './search-tab.scss',
})
export class SearchTab {
  readonly i18n = inject(I18nService);
  readonly subView = signal<'cards' | 'commander' | 'precons' | 'decks'>('cards');
}
