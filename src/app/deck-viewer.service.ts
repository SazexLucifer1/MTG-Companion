import { Injectable, computed, inject, signal } from '@angular/core';
import { DeckService, Deck, DeckCard, DeckChangeEntry, DeckGameStats } from './deck.service';
import { ScryfallService, ScryfallCard } from './scryfall.service';

export interface ManaCurveBucket {
  label: string;
  count: number;
}

export interface PipCount {
  color: 'W' | 'U' | 'B' | 'R' | 'G';
  label: string;
  count: number;
}

export interface GameChangerEntry {
  cardName: string;
  quantity: number;
}

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
  private readonly scryfall = inject(ScryfallService);

  readonly viewingDeck = signal<Deck | null>(null);
  readonly viewingDeckCards = signal<DeckCard[]>([]);
  readonly viewingChangeLog = signal<DeckChangeEntry[]>([]);
  readonly viewingDeckGameStats = signal<DeckGameStats | null>(null);
  readonly detailBusy = signal(false);
  readonly viewMode = signal<'text' | 'visual'>('visual');
  readonly showChangeLog = signal(false);
  readonly showDeckStatsInfo = signal(false);
  readonly showDeckAnalysis = signal(false);

  /** Kartenname (lowercase) -> Scryfall-Zusatzdaten (Manakosten, Farbidentität, Game-Changer-Flag). */
  readonly viewingCardDetails = signal<Map<string, ScryfallCard>>(new Map());
  readonly analysisBusy = signal(false);

  readonly viewingTotalCards = computed(() =>
    this.viewingDeckCards().reduce((sum, c) => sum + c.quantity, 0)
  );

  /** Nicht-Land-Karten - Basis für Manakurve, Pip-Verteilung und Game-Changer-Auswertung. */
  private readonly nonLandCards = computed(() =>
    this.viewingDeckCards().filter((c) => !(c.typeLine ?? '').includes('Land'))
  );

  readonly manaCurve = computed<ManaCurveBucket[]>(() => {
    const buckets = [0, 1, 2, 3, 4, 5, 6].map((cmc) => ({ label: `${cmc}`, count: 0 }));
    const sevenPlus = { label: '7+', count: 0 };
    for (const card of this.nonLandCards()) {
      const bucket = card.cmc >= 7 ? sevenPlus : buckets[Math.min(6, Math.max(0, Math.round(card.cmc)))];
      bucket.count += card.quantity;
    }
    return [...buckets, sevenPlus];
  });

  private static readonly PIP_COLORS: { color: PipCount['color']; label: string }[] = [
    { color: 'W', label: 'Weiß' },
    { color: 'U', label: 'Blau' },
    { color: 'B', label: 'Schwarz' },
    { color: 'R', label: 'Rot' },
    { color: 'G', label: 'Grün' },
  ];

  readonly pipDistribution = computed<PipCount[]>(() => {
    const details = this.viewingCardDetails();
    const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const card of this.nonLandCards()) {
      const manaCost = details.get(card.cardName.toLowerCase())?.manaCost;
      if (!manaCost) continue;
      const symbols = manaCost.match(/\{([^}]+)\}/g) ?? [];
      for (const symbol of symbols) {
        const parts = symbol.slice(1, -1).split('/');
        for (const part of parts) {
          if (part in counts) counts[part] += card.quantity;
        }
      }
    }
    return DeckViewerService.PIP_COLORS.map(({ color, label }) => ({
      color,
      label,
      count: counts[color],
    }));
  });

  readonly gameChangerCards = computed<GameChangerEntry[]>(() => {
    const details = this.viewingCardDetails();
    return this.viewingDeckCards()
      .filter((c) => details.get(c.cardName.toLowerCase())?.gameChanger === true)
      .map((c) => ({ cardName: c.cardName, quantity: c.quantity }));
  });

  readonly gameChangerCount = computed(() =>
    this.gameChangerCards().reduce((sum, c) => sum + c.quantity, 0)
  );

  /**
   * Grobe Einordnung ausschließlich anhand der offiziellen Game-Changer-Grenzwerte
   * (Bracket 1-2: keine, Bracket 3: bis zu 3, Bracket 4-5: unbegrenzt). Andere offizielle
   * Bracket-Kriterien (Mass Land Denial, Extra-Turn-Ketten, Zwei-Karten-Combos, Tutor-Dichte)
   * lassen sich nicht zuverlässig aus der Kartenliste allein ableiten - deshalb nur ein Richtwert.
   */
  readonly estimatedBracketHint = computed(() => {
    const count = this.gameChangerCount();
    if (count === 0) return 'Bracket 1–3 möglich';
    if (count <= 3) return 'mindestens Bracket 3';
    return 'Bracket 4–5';
  });

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
    this.showDeckAnalysis.set(false);
    this.viewingCardDetails.set(new Map());
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

    this.loadCardDetails(cards);
  }

  /** Lädt Manakosten/Farbidentität/Game-Changer-Flag nach - unabhängig vom Kartenbild-Laden, da für die Deck-Analyse (Kurve/Pips/Bracket) benötigt. */
  private async loadCardDetails(cards: DeckCard[]): Promise<void> {
    this.analysisBusy.set(true);
    const names = [...new Set(cards.map((c) => c.cardName))];
    const found = await this.scryfall.findCardsBulk(names);
    this.viewingCardDetails.set(found);
    this.analysisBusy.set(false);
  }

  close(): void {
    this.viewingDeck.set(null);
    this.viewingDeckCards.set([]);
    this.viewingChangeLog.set([]);
    this.viewingDeckGameStats.set(null);
    this.viewingCardDetails.set(new Map());
  }

  toggleChangeLog(): void {
    this.showChangeLog.update((v) => !v);
  }

  toggleDeckStatsInfo(): void {
    this.showDeckStatsInfo.update((v) => !v);
  }

  toggleDeckAnalysis(): void {
    this.showDeckAnalysis.update((v) => !v);
  }
}
