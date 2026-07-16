import { Injectable, computed, inject, signal } from '@angular/core';
import { DeckService, Deck, DeckCard, DeckChangeEntry, DeckGameStats } from './deck.service';

/**
 * Hält den Zustand der Deck-Detail-Vollbildansicht global (statt lokal in DeckList), damit die
 * Ansicht als eigene, root-level gerenderte Komponente existieren kann (analog IngameTracker in
 * app.html) - nur so lässt sich echtes position:fixed über den ganzen Viewport erreichen, ohne von
 * einem `.glass-card`-Vorfahren mit backdrop-filter eingefangen zu werden (backdrop-filter/filter/
 * transform auf einem Ahnen macht diesen zum Containing Block für fixed-Kinder).
 */
@Injectable({ providedIn: 'root' })
export class DeckViewerService {
  private readonly deckService = inject(DeckService);

  readonly viewingDeck = signal<Deck | null>(null);
  readonly viewingDeckCards = signal<DeckCard[]>([]);
  readonly viewingChangeLog = signal<DeckChangeEntry[]>([]);
  readonly viewingDeckGameStats = signal<DeckGameStats | null>(null);
  readonly detailBusy = signal(false);
  readonly viewMode = signal<'text' | 'visual'>('visual');
  readonly showChangeLog = signal(false);
  readonly showDeckStatsInfo = signal(false);

  readonly viewingTotalCards = computed(() =>
    this.viewingDeckCards().reduce((sum, c) => sum + c.quantity, 0)
  );

  /** Reihenfolge der Typ-Abschnitte (Commander steht immer separat ganz vorn). */
  private static readonly TYPE_ORDER: { label: string; test: (typeLine: string) => boolean }[] = [
    { label: 'Planeswalker', test: (t) => t.includes('Planeswalker') },
    { label: 'Battle', test: (t) => t.includes('Battle') },
    { label: 'Kreatur', test: (t) => t.includes('Creature') },
    { label: 'Spontanzauber', test: (t) => t.includes('Instant') },
    { label: 'Hexerei', test: (t) => t.includes('Sorcery') },
    { label: 'Artefakt', test: (t) => t.includes('Artifact') },
    { label: 'Verzauberung', test: (t) => t.includes('Enchantment') },
    { label: 'Land', test: (t) => t.includes('Land') },
  ];

  private categoryFor(card: DeckCard): string {
    const type = card.typeLine ?? '';
    return DeckViewerService.TYPE_ORDER.find((c) => c.test(type))?.label ?? 'Sonstiges';
  }

  private static sortByCmc(a: DeckCard, b: DeckCard): number {
    return a.cmc - b.cmc || a.cardName.localeCompare(b.cardName);
  }

  /** Karten gruppiert nach Commander -> Typ, innerhalb jeder Gruppe nach Manawert sortiert. */
  readonly groupedDeckCards = computed(() => {
    const commander = this.viewingDeckCards().filter((c) => c.isCommander);
    const rest = this.viewingDeckCards().filter((c) => !c.isCommander);

    const groups = new Map<string, DeckCard[]>();
    for (const card of rest) {
      const category = this.categoryFor(card);
      const list = groups.get(category) ?? [];
      list.push(card);
      groups.set(category, list);
    }

    const sections: { label: string; cards: DeckCard[] }[] = [];
    if (commander.length > 0) {
      sections.push({ label: 'Commander', cards: [...commander].sort(DeckViewerService.sortByCmc) });
    }
    for (const { label } of DeckViewerService.TYPE_ORDER) {
      const cards = groups.get(label);
      if (cards?.length) sections.push({ label, cards: [...cards].sort(DeckViewerService.sortByCmc) });
    }
    const other = groups.get('Sonstiges');
    if (other?.length) {
      sections.push({ label: 'Sonstiges', cards: [...other].sort(DeckViewerService.sortByCmc) });
    }

    return sections;
  });

  async open(deck: Deck): Promise<void> {
    this.viewingDeck.set(deck);
    this.detailBusy.set(true);
    this.showChangeLog.set(false);
    this.showDeckStatsInfo.set(false);
    this.viewMode.set('visual');

    const [cards, log, gameStats] = await Promise.all([
      this.deckService.loadDeckCards(deck.id),
      this.deckService.loadChangeLog(deck.id),
      this.deckService.getDeckStats(deck.id),
    ]);

    this.viewingDeckCards.set(cards);
    this.viewingChangeLog.set(log);
    this.viewingDeckGameStats.set(gameStats);
    this.detailBusy.set(false);
  }

  close(): void {
    this.viewingDeck.set(null);
    this.viewingDeckCards.set([]);
    this.viewingChangeLog.set([]);
    this.viewingDeckGameStats.set(null);
  }

  toggleChangeLog(): void {
    this.showChangeLog.update((v) => !v);
  }

  toggleDeckStatsInfo(): void {
    this.showDeckStatsInfo.update((v) => !v);
  }
}
