// NEU
import { Component, inject, signal } from '@angular/core';
import { PublicCardSearch } from '../public-card-search/public-card-search';
import { CommanderRecommendations } from '../commander-recommendations/commander-recommendations';
import { I18nService } from '../i18n.service';

/**
 * "Suche"-Tab zwischen Match und Stats - ohne Account nutzbar (Fan-Content-Policy). Umschalter
 * zwischen Kartensuche (mit Filtern) und Commander-Empfehlungen (EDHREC). Ein öffentlicher, opt-in
 * Deck-Browser als dritte Unteransicht ist als Folge-Schritt geplant, sobald die dafür nötige
 * SQL-Migration gelaufen ist.
 */
@Component({
  selector: 'app-search-tab',
  imports: [PublicCardSearch, CommanderRecommendations],
  templateUrl: './search-tab.html',
  styleUrl: './search-tab.scss',
})
export class SearchTab {
  readonly i18n = inject(I18nService);
  readonly subView = signal<'cards' | 'commander'>('cards');
}
