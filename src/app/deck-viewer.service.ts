import { Injectable, computed, inject, signal } from '@angular/core';
import { DeckService, Deck, DeckCard, DeckChangeEntry, DeckGameStats } from './deck.service';
import { ScryfallService, ScryfallCard } from './scryfall.service';
import {
  CommanderSpellbookService,
  BracketEstimate,
  BracketCombo,
  SPELLBOOK_BRACKET_LABELS,
} from './commander-spellbook.service';

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
  private readonly commanderSpellbook = inject(CommanderSpellbookService);

  readonly viewingDeck = signal<Deck | null>(null);
  readonly viewingDeckCards = signal<DeckCard[]>([]);
  readonly viewingChangeLog = signal<DeckChangeEntry[]>([]);
  readonly viewingDeckGameStats = signal<DeckGameStats | null>(null);
  readonly detailBusy = signal(false);
  readonly viewMode = signal<'text' | 'visual'>('visual');
  readonly showChangeLog = signal(false);
  readonly showDeckStatsInfo = signal(false);
  readonly showDeckAnalysis = signal(false);
  readonly showDeckAnalysisInfo = signal(false);

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
   * (Bracket 1-2: keine, Bracket 3: bis zu 3, Bracket 4-5: unbegrenzt). Ergänzt durch die
   * Commander-Spellbook-Auswertung (Mass Land Denial, Extra-Turns, Combos) weiter unten -
   * Tutor-Dichte lässt sich damit immer noch nicht scharf gewichten, deshalb bleibt das ein
   * Richtwert statt einer verbindlichen Einstufung.
   */
  readonly estimatedBracketHint = computed(() => {
    const count = this.gameChangerCount();
    if (count === 0) return 'Bracket 1–3 möglich';
    if (count <= 3) return 'mindestens Bracket 3';
    return 'Bracket 4–5';
  });

  // NEU
  private static readonly TUTOR_RE =
    /search(?:es)?\s+(?:your|a|their|that player'?s)\s+library\s+for/i;
  // Erfasst neben "... for a land card" auch Karten, die eine Basisland-Art direkt beim Namen
  // nennen statt "land" zu schreiben (z.B. Farseek: "... for a Plains, Island, Swamp, or
  // Mountain card"; Landcycling-Karten: "... for a Forest card").
  private static readonly LAND_TUTOR_RE =
    /search(?:es)?\s+(?:your|a|their|that player'?s)\s+library\s+for\s+(?:up to \w+\s+)?(?:an?|the|\d+)?\s*(?:[a-z]+\s+){0,2}(?:lands?|plains|islands?|swamps?|mountains?|forests?)\b/i;

  /**
   * Tutoren (außer für Länder, wie im offiziellen Bracket-Kriterium) - per Texterkennung im
   * Oracle-Text ("search your library for ..."), da Scryfall dafür kein eigenes Flag hat (anders
   * als bei Game Changers). Nur eine Näherung, keine exakte Erkennung.
   */
  readonly tutorCards = computed<GameChangerEntry[]>(() => {
    const details = this.viewingCardDetails();
    return this.viewingDeckCards()
      .filter((c) => {
        const text = details.get(c.cardName.toLowerCase())?.oracleText ?? '';
        return DeckViewerService.TUTOR_RE.test(text) && !DeckViewerService.LAND_TUTOR_RE.test(text);
      })
      .map((c) => ({ cardName: c.cardName, quantity: c.quantity }));
  });

  /**
   * Mass Land Denial, Extra-Turns und Zwei-Karten-Combos kommen von Commander Spellbooks
   * Bracket-API (über unseren eigenen Server-Proxy, siehe commander-spellbook.service.ts) - das
   * ist die einzige praktikable Quelle dafür, eine reine Kartenlisten-Heuristik wäre hier zu
   * unzuverlässig. Bleibt null, wenn der Aufruf fehlschlägt (z.B. lokale Entwicklung ohne
   * Cloudflare Pages Functions, oder Commander Spellbook nicht erreichbar) - die übrige Analyse
   * bleibt davon unberührt.
   */
  readonly bracketEstimate = signal<BracketEstimate | null>(null);
  readonly bracketEstimateBusy = signal(false);
  readonly bracketEstimateFailed = signal(false);
  readonly bracketEstimateErrorDetail = signal<string | null>(null);

  readonly massLandDenialCards = computed<GameChangerEntry[]>(() =>
    (this.bracketEstimate()?.cards ?? [])
      .filter((c) => c.massLandDenial)
      .map((c) => ({ cardName: c.cardName, quantity: c.quantity }))
  );

  readonly extraTurnCards = computed<GameChangerEntry[]>(() =>
    (this.bracketEstimate()?.cards ?? [])
      .filter((c) => c.extraTurn)
      .map((c) => ({ cardName: c.cardName, quantity: c.quantity }))
  );

  readonly twoCardCombos = computed<BracketCombo[]>(() =>
    (this.bracketEstimate()?.combos ?? []).filter((c) => c.definitelyTwoCard || c.arguablyTwoCard)
  );

  readonly spellbookBracketLabel = computed(() => {
    const tag = this.bracketEstimate()?.bracketTag;
    return tag ? SPELLBOOK_BRACKET_LABELS[tag] : null;
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

  // NEU
  readonly cardSearchQuery = signal('');
  readonly cmcFilter = signal<'all' | number>('all');
  readonly typeFilterValue = signal<'all' | string>('all');
  readonly creatureTypeFilter = signal<'all' | string>('all');
  readonly colorFilter = signal<'all' | 'W' | 'U' | 'B' | 'R' | 'G' | 'C'>('all');

  /** Kreaturtypen (Untertypen nach dem Gedankenstrich), die tatsächlich im Deck vorkommen - für das Filter-Dropdown. */
  readonly availableCreatureTypes = computed(() => {
    const types = new Set<string>();
    for (const card of this.viewingDeckCards()) {
      if (!(card.typeLine ?? '').includes('Creature')) continue;
      for (const t of DeckViewerService.parseSubtypes(card.typeLine)) types.add(t);
    }
    return [...types].sort((a, b) => a.localeCompare(b));
  });

  readonly availableTypeSections = computed(() => this.groupedDeckCards().map((s) => s.label));

  private static parseSubtypes(typeLine: string | null): string[] {
    const parts = (typeLine ?? '').split('—');
    if (parts.length < 2) return [];
    return parts[1].trim().split(/\s+/).filter(Boolean);
  }

  private cardMatchesFilters(card: DeckCard): boolean {
    const query = this.cardSearchQuery().trim().toLowerCase();
    if (query && !card.cardName.toLowerCase().includes(query)) return false;

    const cmc = this.cmcFilter();
    if (cmc !== 'all') {
      const bucket = card.cmc >= 7 ? 7 : Math.round(card.cmc);
      if (bucket !== cmc) return false;
    }

    const creatureType = this.creatureTypeFilter();
    if (creatureType !== 'all' && !DeckViewerService.parseSubtypes(card.typeLine).includes(creatureType)) {
      return false;
    }

    const color = this.colorFilter();
    if (color !== 'all') {
      const identity = this.viewingCardDetails().get(card.cardName.toLowerCase())?.colorIdentity ?? [];
      if (color === 'C' ? identity.length > 0 : !identity.includes(color)) return false;
    }

    return true;
  }

  /** groupedDeckCards, gefiltert nach Suchtext/Manawert/Typ/Kreaturtyp/Farbe - leere Abschnitte fallen weg. */
  readonly filteredGroupedDeckCards = computed(() => {
    const typeFilter = this.typeFilterValue();
    return this.groupedDeckCards()
      .filter((section) => typeFilter === 'all' || section.label === typeFilter)
      .map((section) => ({
        label: section.label,
        cards: section.cards.filter((c) => this.cardMatchesFilters(c)),
      }))
      .filter((section) => section.cards.length > 0);
  });

  readonly hasActiveCardFilters = computed(
    () =>
      this.cardSearchQuery().trim() !== '' ||
      this.cmcFilter() !== 'all' ||
      this.typeFilterValue() !== 'all' ||
      this.creatureTypeFilter() !== 'all' ||
      this.colorFilter() !== 'all'
  );

  resetCardFilters(): void {
    this.cardSearchQuery.set('');
    this.cmcFilter.set('all');
    this.typeFilterValue.set('all');
    this.creatureTypeFilter.set('all');
    this.colorFilter.set('all');
  }

  async open(deck: Deck): Promise<void> {
    this.viewingDeck.set(deck);
    this.detailBusy.set(true);
    this.showChangeLog.set(false);
    this.showDeckStatsInfo.set(false);
    this.showDeckAnalysis.set(false);
    this.resetCardFilters();
    this.showDeckAnalysisInfo.set(false);
    this.viewingCardDetails.set(new Map());
    this.bracketEstimate.set(null);
    this.bracketEstimateFailed.set(false);
    this.bracketEstimateErrorDetail.set(null);
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
    this.loadBracketEstimate(cards);
  }

  /** Lädt Manakosten/Farbidentität/Game-Changer-Flag/Oracle-Text nach - unabhängig vom Kartenbild-Laden, da für die Deck-Analyse (Kurve/Pips/Tutoren) benötigt. */
  private async loadCardDetails(cards: DeckCard[]): Promise<void> {
    this.analysisBusy.set(true);
    const names = [...new Set(cards.map((c) => c.cardName))];
    const found = await this.scryfall.findCardsBulk(names);
    this.viewingCardDetails.set(found);
    this.analysisBusy.set(false);
  }

  /** Lädt Mass-Land-Denial/Extra-Turn/Combo-Auswertung von Commander Spellbook nach (siehe bracketEstimate). */
  private async loadBracketEstimate(cards: DeckCard[]): Promise<void> {
    this.bracketEstimateBusy.set(true);
    const commanders = cards
      .filter((c) => c.isCommander)
      .map((c) => ({ card: c.cardName, quantity: c.quantity }));
    const main = cards
      .filter((c) => !c.isCommander)
      .map((c) => ({ card: c.cardName, quantity: c.quantity }));

    const { estimate, errorDetail } = await this.commanderSpellbook.estimateBracket(commanders, main);
    this.bracketEstimate.set(estimate);
    this.bracketEstimateFailed.set(estimate === null);
    this.bracketEstimateErrorDetail.set(errorDetail);
    this.bracketEstimateBusy.set(false);
  }

  close(): void {
    this.viewingDeck.set(null);
    this.viewingDeckCards.set([]);
    this.viewingChangeLog.set([]);
    this.viewingDeckGameStats.set(null);
    this.viewingCardDetails.set(new Map());
    this.bracketEstimate.set(null);
    this.bracketEstimateBusy.set(false);
    this.bracketEstimateFailed.set(false);
    this.bracketEstimateErrorDetail.set(null);
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

  toggleDeckAnalysisInfo(): void {
    this.showDeckAnalysisInfo.update((v) => !v);
  }
}
