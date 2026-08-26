// NEU
import { Component } from '@angular/core';
import { PublicCardSearch } from '../public-card-search/public-card-search';

/**
 * "Suche"-Tab zwischen Match und Stats - ohne Account nutzbar (Fan-Content-Policy). Zeigt aktuell
 * nur die Kartensuche; ein öffentlicher, opt-in Deck-Browser als zweite Unteransicht (mit
 * Umschalter) ist als Folge-Schritt geplant, sobald die dafür nötige SQL-Migration gelaufen ist.
 */
@Component({
  selector: 'app-search-tab',
  imports: [PublicCardSearch],
  templateUrl: './search-tab.html',
  styleUrl: './search-tab.scss',
})
export class SearchTab {}
