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

interface PendingCardChange {
  cardName: string;
  quantity: number;
  imageUrl: string | null;
  typeLine: string | null;
  cmc: number;
  isCommander: boolean;
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
    this.editedDeckCards().reduce((sum, c) => sum + c.quantity, 0)
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
    const commander = this.editedDeckCards().filter((c) => c.isCommander);
    const rest = this.editedDeckCards().filter((c) => !c.isCommander);

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

  // NEU - Bearbeitungsmodus: Karten hinzufügen/entfernen
  readonly editMode = signal(false);
  readonly addCardQuery = signal('');
  readonly addCardTypeFilter = signal<'all' | string>('all');
  readonly addCardCreatureTypeFilter = signal('');
  readonly addCardColorFilter = signal<'all' | 'W' | 'U' | 'B' | 'R' | 'G' | 'C'>('all');
  readonly addCardCmcFilter = signal<'all' | number>('all');
  readonly addCardResults = signal<ScryfallCard[]>([]);
  readonly addCardBusy = signal(false);
  readonly addCardMessage = signal('');
  private addCardSearchTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly TYPE_TO_SCRYFALL: Record<string, string> = {
    Planeswalker: 'planeswalker',
    Battle: 'battle',
    Kreatur: 'creature',
    Spontanzauber: 'instant',
    Hexerei: 'sorcery',
    Artefakt: 'artifact',
    Verzauberung: 'enchantment',
    Land: 'land',
  };

  /**
   * Farbidentität des/der Commander (für die "id<="-Teilmengen-Beschränkung der Add-Karten-Suche,
   * damit nur wirklich regelkonform ins Deck passende Karten vorgeschlagen werden). null, solange
   * die Scryfall-Zusatzdaten (viewingCardDetails) noch nicht geladen sind oder kein Commander
   * gesetzt ist - dann bleibt die Suche unbeschränkt.
   */
  readonly deckColorIdentitySubset = computed<string[] | null>(() => {
    const commanders = this.viewingDeckCards().filter((c) => c.isCommander);
    if (commanders.length === 0) return null;
    const details = this.viewingCardDetails();
    const identities = commanders.map((c) => details.get(c.cardName.toLowerCase())?.colorIdentity);
    if (identities.some((i) => i === undefined)) return null;
    const union = new Set<string>();
    for (const id of identities) for (const c of id ?? []) union.add(c);
    return [...union];
  });

  /**
   * Änderungen im Bearbeitungsmodus (Karten hinzufügen/entfernen, Anzahl anpassen) werden NUR
   * lokal in pendingChanges gesammelt - erst saveEdits() schreibt sie in die Datenbank. So
   * verwirft cancelEdits() (oder Schließen der Ansicht/App ohne zu speichern) sie einfach wieder,
   * ohne dass vorher irgendetwas gespeichert wurde.
   */
  readonly pendingChanges = signal<Map<string, PendingCardChange>>(new Map());
  readonly editSaveBusy = signal(false);

  /** Kartenname (lowercase) -> gespeicherte Anzahl, als schnelle Nachschlagehilfe für Diff-Berechnungen. */
  private readonly savedQuantityByKey = computed(() => {
    const map = new Map<string, number>();
    for (const c of this.viewingDeckCards()) map.set(c.cardName.toLowerCase(), c.quantity);
    return map;
  });

  /** viewingDeckCards, überlagert von den noch ungespeicherten Änderungen - das, was während des Bearbeitens angezeigt wird. */
  readonly editedDeckCards = computed<DeckCard[]>(() => {
    if (!this.editMode()) return this.viewingDeckCards();

    const pending = this.pendingChanges();
    const result: DeckCard[] = [];
    for (const card of this.viewingDeckCards()) {
      const change = pending.get(card.cardName.toLowerCase());
      if (!change) {
        result.push(card);
      } else if (change.quantity > 0) {
        result.push({ ...card, quantity: change.quantity });
      }
    }
    const savedKeys = this.savedQuantityByKey();
    for (const change of pending.values()) {
      if (!savedKeys.has(change.cardName.toLowerCase()) && change.quantity > 0) {
        result.push({
          cardName: change.cardName,
          quantity: change.quantity,
          imageUrl: change.imageUrl,
          typeLine: change.typeLine,
          cmc: change.cmc,
          isCommander: false,
        });
      }
    }
    return result;
  });

  readonly hasPendingChanges = computed(() => {
    const saved = this.savedQuantityByKey();
    for (const change of this.pendingChanges().values()) {
      if (change.quantity !== (saved.get(change.cardName.toLowerCase()) ?? 0)) return true;
    }
    return false;
  });

  /** Welche Karten in welcher Menge noch ungespeichert hinzugefügt/entfernt wurden - für die Anzeige vor dem Speichern. */
  readonly pendingChangeDetails = computed(() => {
    const saved = this.savedQuantityByKey();
    const added: GameChangerEntry[] = [];
    const removed: GameChangerEntry[] = [];
    for (const change of this.pendingChanges().values()) {
      const diff = change.quantity - (saved.get(change.cardName.toLowerCase()) ?? 0);
      if (diff > 0) added.push({ cardName: change.cardName, quantity: diff });
      else if (diff < 0) removed.push({ cardName: change.cardName, quantity: -diff });
    }
    added.sort((a, b) => a.cardName.localeCompare(b.cardName));
    removed.sort((a, b) => a.cardName.localeCompare(b.cardName));
    return { added, removed };
  });

  toggleEditMode(): void {
    if (this.editMode()) return; // Verlassen geht nur bewusst über saveEdits()/cancelEdits()
    this.editMode.set(true);
    this.pendingChanges.set(new Map());
    this.addCardQuery.set('');
    this.addCardTypeFilter.set('all');
    this.addCardCreatureTypeFilter.set('');
    this.addCardColorFilter.set('all');
    this.addCardCmcFilter.set('all');
    this.addCardResults.set([]);
    this.addCardMessage.set('');
  }

  private setPendingQuantity(card: DeckCard, quantity: number): void {
    this.pendingChanges.update((map) => {
      const next = new Map(map);
      next.set(card.cardName.toLowerCase(), {
        cardName: card.cardName,
        quantity: Math.max(0, quantity),
        imageUrl: card.imageUrl,
        typeLine: card.typeLine,
        cmc: card.cmc,
        isCommander: card.isCommander,
      });
      return next;
    });
  }

  /** Kurzes grünes/rotes Aufleuchten des zuletzt geklickten +/--Buttons als Klick-Feedback. */
  readonly flashState = signal<{ key: string; type: 'add' | 'remove' } | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  private triggerFlash(cardName: string, type: 'add' | 'remove'): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashState.set({ key: cardName.toLowerCase(), type });
    this.flashTimer = setTimeout(() => this.flashState.set(null), 400);
  }

  isFlashing(cardName: string, type: 'add' | 'remove'): boolean {
    const state = this.flashState();
    return state?.key === cardName.toLowerCase() && state.type === type;
  }

  /** card.quantity ist hier bereits der aktuell angezeigte (ggf. schon angepasste) Stand aus editedDeckCards(). */
  incrementCard(card: DeckCard): void {
    this.setPendingQuantity(card, card.quantity + 1);
    this.triggerFlash(card.cardName, 'add');
  }

  decrementCard(card: DeckCard): void {
    this.setPendingQuantity(card, card.quantity - 1);
    this.triggerFlash(card.cardName, 'remove');
  }

  async saveEdits(): Promise<void> {
    const deck = this.viewingDeck();
    if (!deck) return;
    this.editSaveBusy.set(true);

    const saved = this.savedQuantityByKey();
    for (const change of this.pendingChanges().values()) {
      const savedQty = saved.get(change.cardName.toLowerCase()) ?? 0;
      const diff = change.quantity - savedQty;
      if (diff === 0) continue;

      if (diff > 0) {
        await this.deckService.addCardToDeck(
          deck.id,
          {
            name: change.cardName,
            imageUrl: change.imageUrl ?? undefined,
            typeLine: change.typeLine ?? undefined,
            cmc: change.cmc,
          },
          diff
        );
      } else {
        await this.deckService.removeCardFromDeck(deck.id, change.cardName, -diff);
      }
    }

    this.pendingChanges.set(new Map());
    this.editMode.set(false);
    await this.reloadDeckCards();
    this.editSaveBusy.set(false);
  }

  cancelEdits(): void {
    this.pendingChanges.set(new Map());
    this.editMode.set(false);
    this.addCardQuery.set('');
    this.addCardResults.set([]);
    this.addCardMessage.set('');
  }

  onAddCardSearchInput(value: string): void {
    this.addCardQuery.set(value);
    this.triggerAddCardSearch();
  }

  onAddCardCreatureTypeInput(value: string): void {
    this.addCardCreatureTypeFilter.set(value);
    this.triggerAddCardSearch();
  }

  setAddCardTypeFilter(value: 'all' | string): void {
    this.addCardTypeFilter.set(value);
    this.triggerAddCardSearch();
  }

  setAddCardColorFilter(value: 'all' | 'W' | 'U' | 'B' | 'R' | 'G' | 'C'): void {
    this.addCardColorFilter.set(value);
    this.triggerAddCardSearch();
  }

  setAddCardCmcFilter(value: 'all' | number): void {
    this.addCardCmcFilter.set(value);
    this.triggerAddCardSearch();
  }

  private triggerAddCardSearch(): void {
    if (this.addCardSearchTimer) clearTimeout(this.addCardSearchTimer);
    const query = this.addCardQuery();
    const type = this.addCardTypeFilter();
    const creatureType = this.addCardCreatureTypeFilter();
    const color = this.addCardColorFilter();
    const cmc = this.addCardCmcFilter();

    if (!query.trim() && type === 'all' && !creatureType.trim() && color === 'all' && cmc === 'all') {
      this.addCardResults.set([]);
      return;
    }

    this.addCardSearchTimer = setTimeout(async () => {
      this.addCardBusy.set(true);
      const results = await this.scryfall.searchCards(query, {
        type: type === 'all' ? undefined : DeckViewerService.TYPE_TO_SCRYFALL[type] ?? type.toLowerCase(),
        creatureType: creatureType.trim() || undefined,
        color: color === 'all' ? null : color,
        cmc: cmc === 'all' ? null : cmc,
        colorIdentitySubset: this.deckColorIdentitySubset(),
      });
      this.addCardResults.set(results);
      this.addCardBusy.set(false);
    }, 300);
  }

  /** Fügt eine Karte aus den Suchergebnissen nur lokal zu pendingChanges hinzu - noch nicht gespeichert. */
  addCard(card: ScryfallCard): void {
    const key = card.name.toLowerCase();
    const currentQty = this.editedDeckCards().find((c) => c.cardName.toLowerCase() === key)?.quantity ?? 0;
    const existingInDeck = this.viewingDeckCards().find((c) => c.cardName.toLowerCase() === key);

    this.pendingChanges.update((map) => {
      const next = new Map(map);
      next.set(key, {
        cardName: card.name,
        quantity: currentQty + 1,
        imageUrl: card.imageUrl ?? existingInDeck?.imageUrl ?? null,
        typeLine: card.typeLine ?? existingInDeck?.typeLine ?? null,
        cmc: card.cmc ?? existingInDeck?.cmc ?? 0,
        isCommander: existingInDeck?.isCommander ?? false,
      });
      return next;
    });
    this.addCardMessage.set(`"${card.name}" hinzugefügt (noch nicht gespeichert).`);
    this.triggerFlash(card.name, 'add');
  }

  private async reloadDeckCards(): Promise<void> {
    const deck = this.viewingDeck();
    if (!deck) return;
    const [cards, log] = await Promise.all([
      this.deckService.loadDeckCards(deck.id),
      this.deckService.loadChangeLog(deck.id),
    ]);
    this.viewingDeckCards.set(cards);
    this.viewingChangeLog.set(log);
    this.loadCardDetails(cards);
    this.loadBracketEstimate(cards);
  }

  async open(deck: Deck): Promise<void> {
    this.viewingDeck.set(deck);
    this.detailBusy.set(true);
    this.showChangeLog.set(false);
    this.showDeckStatsInfo.set(false);
    this.showDeckAnalysis.set(false);
    this.resetCardFilters();
    this.editMode.set(false);
    this.pendingChanges.set(new Map());
    this.flashState.set(null);
    this.addCardResults.set([]);
    this.addCardMessage.set('');
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
    this.editMode.set(false);
    this.pendingChanges.set(new Map());
    this.flashState.set(null);
    this.addCardResults.set([]);
    this.addCardMessage.set('');
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
