import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { PublicDeckService, PublicDeck, PublicDeckStats } from '../public-deck.service';
import { ScryfallCard, ScryfallService } from '../scryfall.service';
import { CardPreviewService } from '../card-preview.service';
import { I18nService } from '../i18n.service';
import { CardImage } from '../card-image/card-image';
import { PartnerCardImage } from '../partner-card-image/partner-card-image';

interface PublicDeckCardEntry {
  card: ScryfallCard;
  quantity: number;
}

/**
 * Öffentliche Decks anderer Nutzer durchsuchen (Name/Farbe/Archetyp/Kreaturtyp, sortiert nach
 * "neu"/Winrate) und rein lesend ansehen - ohne Account nutzbar, eigener Umschalter im Suche-Tab
 * (siehe sql/public-deck-browse-2026-08-26.sql für die zugrundeliegende RLS-/Schema-Änderung).
 * Hält den Zustand komplett lokal statt DeckViewerService zu injizieren - gleiche Entscheidung wie
 * commander-recommendations.ts/precon-browser.ts.
 */
@Component({
  selector: 'app-public-deck-browser',
  imports: [FormsModule, CardImage, PartnerCardImage, DecimalPipe],
  templateUrl: './public-deck-browser.html',
  styleUrl: './public-deck-browser.scss',
})
export class PublicDeckBrowser {
  private readonly publicDecks = inject(PublicDeckService);
  private readonly scryfall = inject(ScryfallService);
  private readonly cardPreview = inject(CardPreviewService);
  readonly i18n = inject(I18nService);

  readonly nameFilter = signal('');
  readonly colorOptions = ['W', 'U', 'B', 'R', 'G'];
  readonly browseColors = signal<Set<string>>(new Set());
  readonly sort = signal<'recent' | 'winRate'>('recent');
  readonly archetype = signal<string | null>(null);
  readonly archetypeOptions = signal<string[]>([]);
  readonly creatureType = signal<string | null>(null);
  readonly creatureTypeOptions = signal<string[]>([]);
  readonly creatureTypesLoading = signal(false);

  readonly results = signal<PublicDeck[]>([]);
  readonly stats = signal<Map<string, PublicDeckStats>>(new Map());
  readonly commanderCardsByDeck = signal<Map<string, ScryfallCard[]>>(new Map());
  readonly busy = signal(false);
  readonly page = signal(0);

  private static readonly PAGE_SIZE = 30;

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.results().length / PublicDeckBrowser.PAGE_SIZE)));
  readonly effectivePage = computed(() => Math.min(this.page(), this.totalPages() - 1));
  readonly pagedResults = computed(() => {
    const start = this.effectivePage() * PublicDeckBrowser.PAGE_SIZE;
    return this.results().slice(start, start + PublicDeckBrowser.PAGE_SIZE);
  });

  readonly selectedDeck = signal<PublicDeck | null>(null);
  readonly selectedDeckCommanderCards = signal<ScryfallCard[]>([]);
  readonly mainCards = signal<PublicDeckCardEntry[]>([]);
  readonly deckBusy = signal(false);

  constructor() {
    this.publicDecks.archetypeOptions().then((options) => this.archetypeOptions.set(options));
    this.loadCreatureTypes();
    this.search();
  }

  private async loadCreatureTypes(): Promise<void> {
    this.creatureTypesLoading.set(true);
    this.creatureTypeOptions.set(await this.scryfall.creatureTypes());
    this.creatureTypesLoading.set(false);
  }

  toggleColor(color: string): void {
    const next = new Set(this.browseColors());
    if (next.has(color)) next.delete(color);
    else next.add(color);
    this.browseColors.set(next);
  }

  setSort(value: string): void {
    this.sort.set(value === 'winRate' ? 'winRate' : 'recent');
    this.search();
  }

  setArchetype(value: string): void {
    this.archetype.set(value === 'all' ? null : value);
  }

  setCreatureType(value: string): void {
    this.creatureType.set(value === 'all' ? null : value);
  }

  async search(): Promise<void> {
    this.busy.set(true);
    const { decks, stats } = await this.publicDecks.searchPublicDecks({
      name: this.nameFilter(),
      colors: [...this.browseColors()],
      archetype: this.archetype(),
      creatureType: this.creatureType(),
      sort: this.sort(),
    });

    this.results.set(decks);
    this.stats.set(stats);
    this.page.set(0);

    const allCommanderNames = [...new Set(decks.flatMap((d) => d.commanderNames))];
    const cardMap = await this.scryfall.findCardsBulk(allCommanderNames);
    const byDeck = new Map<string, ScryfallCard[]>();
    for (const deck of decks) {
      const cards = deck.commanderNames.map((n) => cardMap.get(n.toLowerCase())).filter((c): c is ScryfallCard => !!c);
      byDeck.set(deck.id, cards);
    }
    this.commanderCardsByDeck.set(byDeck);

    this.busy.set(false);
  }

  resetFilters(): void {
    this.nameFilter.set('');
    this.browseColors.set(new Set());
    this.archetype.set(null);
    this.creatureType.set(null);
    this.sort.set('recent');
    this.search();
  }

  statsFor(deckId: string): PublicDeckStats | null {
    return this.stats().get(deckId) ?? null;
  }

  commanderCardsFor(deckId: string): ScryfallCard[] {
    return this.commanderCardsByDeck().get(deckId) ?? [];
  }

  prevPage(): void {
    this.page.update((p) => Math.max(0, p - 1));
  }

  nextPage(): void {
    this.page.update((p) => Math.min(this.totalPages() - 1, p + 1));
  }

  async openDeck(deck: PublicDeck): Promise<void> {
    this.selectedDeck.set(deck);
    this.selectedDeckCommanderCards.set(this.commanderCardsFor(deck.id));
    this.mainCards.set([]);
    this.deckBusy.set(true);

    const entries = await this.publicDecks.loadDeckCards(deck.id);
    const cardMap = await this.scryfall.findCardsBulk(entries.map((e) => e.name));

    const main: PublicDeckCardEntry[] = [];
    for (const entry of entries) {
      if (entry.isCommander) continue;
      const card = cardMap.get(entry.name.toLowerCase());
      if (card) main.push({ card, quantity: entry.quantity });
    }

    this.mainCards.set(main);
    this.deckBusy.set(false);
  }

  backToList(): void {
    this.selectedDeck.set(null);
    this.selectedDeckCommanderCards.set([]);
    this.mainCards.set([]);
  }

  openPreview(card: ScryfallCard): void {
    if (!card.imageUrl) return;
    this.cardPreview.open(card.imageUrl, card.backImageUrl, card.name);
  }
}
