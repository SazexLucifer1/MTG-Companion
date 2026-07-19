import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeckService, Deck, DeckGameStats } from '../deck.service';
import { DeckViewerService } from '../deck-viewer.service';
import { DeckImportService } from '../deck-import.service';
import { ScryfallService } from '../scryfall.service';

export type DeckSortMode = 'alpha' | 'winRate' | 'games';

interface DeckWithStats extends Deck {
  games: number;
  wins: number;
  winRate: number;
  commander?: string;
}

const PAGE_SIZE = 10;

@Component({
  selector: 'app-deck-list',
  imports: [DatePipe, DecimalPipe, FormsModule],
  templateUrl: './deck-list.html',
  styleUrl: './deck-list.scss',
})
export class DeckList {
  readonly userId = input.required<string>();
  /** Wenn true, sind Import/Bearbeiten/Löschen ausgeblendet - reine Ansicht fremder Decks. */
  readonly readonlyMode = input(false);

  private readonly deckService = inject(DeckService);
  readonly viewer = inject(DeckViewerService);
  readonly importService = inject(DeckImportService);
  private readonly scryfall = inject(ScryfallService);

  readonly decks = signal<Deck[]>([]);
  private readonly deckStats = signal<Map<string, DeckGameStats>>(new Map());
  readonly loading = signal(true);

  readonly searchQuery = signal('');
  readonly sortMode = signal<DeckSortMode>('alpha');
  readonly page = signal(0);

  /** Kartenname (lowercase) -> Bild-URL oder null (nicht gefunden). Nur für aktuell sichtbare Einträge geladen. */
  private readonly cardImages = signal<Record<string, string | null>>({});

  constructor() {
    effect(() => {
      const uid = this.userId();
      this.loading.set(true);
      this.page.set(0);
      this.deckService.loadDecksForUser(uid).then(async (decks) => {
        this.decks.set(decks);
        this.deckStats.set(await this.deckService.getDeckStatsForDecks(decks.map((d) => d.id)));
        this.loading.set(false);
      });
    });

    effect(() => {
      const names = this.pagedDecks()
        .map((d) => d.commander)
        .filter((n): n is string => !!n);
      const cache = this.cardImages();
      const missing = [...new Set(names)].filter((n) => !(n.toLowerCase() in cache));
      if (missing.length === 0) return;

      this.scryfall.findCardsBulk(missing).then((found) => {
        this.cardImages.update((current) => {
          const next = { ...current };
          for (const name of missing) {
            next[name.toLowerCase()] = found.get(name.toLowerCase())?.imageUrl ?? null;
          }
          return next;
        });
      });
    });
  }

  /** Kartenbild-URL für einen Commander-Namen, falls schon geladen. */
  commanderImage(name: string | undefined): string | null {
    if (!name) return null;
    return this.cardImages()[name.toLowerCase()] ?? null;
  }

  private readonly decksWithStats = computed<DeckWithStats[]>(() =>
    this.decks().map((d) => {
      const s = this.deckStats().get(d.id) ?? { games: 0, wins: 0, winRate: 0 };
      return { ...d, ...s };
    })
  );

  readonly filteredSortedDecks = computed<DeckWithStats[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    let list = this.decksWithStats();
    if (query) {
      list = list.filter((d) => d.name.toLowerCase().includes(query));
    }

    const mode = this.sortMode();
    list = [...list];
    if (mode === 'alpha') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (mode === 'winRate') {
      list.sort((a, b) => b.winRate - a.winRate || b.games - a.games);
    } else {
      list.sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    }
    return list;
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredSortedDecks().length / PAGE_SIZE)));

  readonly pagedDecks = computed<DeckWithStats[]>(() => {
    const start = this.page() * PAGE_SIZE;
    return this.filteredSortedDecks().slice(start, start + PAGE_SIZE);
  });

  readonly pageRangeEnd = computed(() =>
    Math.min((this.page() + 1) * PAGE_SIZE, this.filteredSortedDecks().length)
  );

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.page.set(0);
  }

  setSortMode(mode: DeckSortMode): void {
    this.sortMode.set(mode);
    this.page.set(0);
  }

  prevPage(): void {
    this.page.update((p) => Math.max(0, p - 1));
  }

  nextPage(): void {
    this.page.update((p) => Math.min(this.totalPages() - 1, p + 1));
  }

  async refreshDecks(): Promise<void> {
    const decks = await this.deckService.loadDecksForUser(this.userId());
    this.decks.set(decks);
    this.deckStats.set(await this.deckService.getDeckStatsForDecks(decks.map((d) => d.id)));
  }

  openNewDeckDialog(): void {
    this.importService.openNewDeckDialog(this.userId(), () => this.refreshDecks());
  }

  openNewEmptyDeckDialog(): void {
    this.importService.openNewEmptyDeckDialog(this.userId(), async (deck) => {
      await this.refreshDecks();
      await this.viewer.open(deck);
      this.viewer.toggleEditMode();
    });
  }

  openEditDeckDialog(deck: Deck): void {
    this.importService.openEditDeckDialog(this.userId(), deck, () => this.refreshDecks());
  }

  openPreconDialog(): void {
    this.importService.openPreconDialog(this.userId(), () => this.refreshDecks());
  }

  async deleteDeck(deck: Deck): Promise<void> {
    if (!confirm(`Deck „${deck.name}" wirklich löschen?`)) return;
    await this.deckService.deleteDeck(deck.id);
    if (this.viewer.viewingDeck()?.id === deck.id) this.viewer.close();
    await this.refreshDecks();
  }

  openDeckDetail(deck: Deck): void {
    this.viewer.open(deck);
  }
}
