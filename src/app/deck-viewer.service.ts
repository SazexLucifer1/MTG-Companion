import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DeckService, Deck, DeckCard, DeckChangeEntry, DeckGameStats } from './deck.service';
import { ScryfallService, ScryfallCard, ScryfallPrinting } from './scryfall.service';
import {
  CommanderSpellbookService,
  BracketEstimate,
  BracketCombo,
  SPELLBOOK_BRACKET_LABELS,
} from './commander-spellbook.service';
import { EdhrecService, EdhrecCardlist, EdhrecTag } from './edhrec.service';
import { AuthService } from './auth.service';

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
  private readonly edhrec = inject(EdhrecService);
  private readonly auth = inject(AuthService);

  readonly viewingDeck = signal<Deck | null>(null);

  /**
   * Ob das gerade angesehene Deck dem eingeloggten User selbst gehört - alle Bearbeiten-Aktionen
   * (Karten hinzufügen/entfernen, Commander markieren, Name/Tag ändern, neu einfügen) sind sonst
   * gesperrt. Wichtig für "Profil ansehen" bei anderen Usern: die Deckliste dort ist zwar
   * readonlyMode (kein Stift/Löschen-Button), aber "Ansehen" öffnet dieselbe Detailansicht wie bei
   * eigenen Decks - ohne diesen Check ließe sich darüber trotzdem fremde Decks bearbeiten.
   */
  readonly canEditViewingDeck = computed(() => {
    const deck = this.viewingDeck();
    const uid = this.auth.currentUser()?.id;
    return !!deck && !!uid && deck.userId === uid;
  });
  readonly viewingDeckCards = signal<DeckCard[]>([]);
  readonly viewingChangeLog = signal<DeckChangeEntry[]>([]);
  readonly viewingDeckGameStats = signal<DeckGameStats | null>(null);
  readonly detailBusy = signal(false);
  readonly viewMode = signal<'text' | 'visual'>('visual');
  readonly showChangeLog = signal(false);
  readonly showDeckStatsInfo = signal(false);
  readonly showDeckAnalysis = signal(false);
  readonly showDeckAnalysisInfo = signal(false);

  // NEU - Name/Tag sind immer (nicht nur im Bearbeitungsmodus) im Kopfbereich der Detailansicht
  // änderbar, damit dafür kein separater Dialog mehr nötig ist (siehe deck-list.ts, der frühere
  // Stift-Button wurde entfernt).
  readonly deckNameDraft = signal('');
  readonly deckTagDraft = signal<string | null>(null);
  readonly deckInfoSaving = signal(false);

  readonly deckInfoDirty = computed(() => {
    const deck = this.viewingDeck();
    if (!deck) return false;
    return this.deckNameDraft().trim() !== deck.name || this.deckTagDraft() !== deck.edhrecTag;
  });

  /** Verwirft Name/Tag-Entwurf und setzt auf die gespeicherten Werte zurück. */
  resetDeckInfoDraft(): void {
    const deck = this.viewingDeck();
    this.deckNameDraft.set(deck?.name ?? '');
    this.deckTagDraft.set(deck?.edhrecTag ?? null);
  }

  async saveDeckInfo(): Promise<void> {
    const deck = this.viewingDeck();
    const name = this.deckNameDraft().trim();
    if (!deck || !name || !this.canEditViewingDeck()) return;

    this.deckInfoSaving.set(true);
    const tag = this.deckTagDraft();
    const ok = await this.deckService.updateDeckInfo(deck.id, name, tag);
    this.deckInfoSaving.set(false);
    if (ok) {
      this.viewingDeck.set({ ...deck, name, edhrecTag: tag });
      this.deckNameDraft.set(name);
    }
  }

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
  readonly keywordFilter = signal('all');
  readonly effectFilter = signal('all');
  /** Ergebnis der letzten Effekt-Abfrage (lowercase Kartennamen) - null solange kein Effekt-Filter aktiv oder noch nicht geladen. */
  readonly effectMatchNames = signal<Set<string> | null>(null);
  readonly effectFilterBusy = signal(false);

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

    const keyword = this.keywordFilter();
    if (keyword !== 'all') {
      const keywords = this.viewingCardDetails().get(card.cardName.toLowerCase())?.keywords ?? [];
      if (!keywords.some((k) => k.toLowerCase() === keyword)) return false;
    }

    const effect = this.effectFilter();
    if (effect !== 'all') {
      const matches = this.effectMatchNames();
      if (!matches?.has(card.cardName.toLowerCase())) return false;
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
      this.colorFilter() !== 'all' ||
      this.keywordFilter() !== 'all' ||
      this.effectFilter() !== 'all'
  );

  resetCardFilters(): void {
    this.cardSearchQuery.set('');
    this.cmcFilter.set('all');
    this.typeFilterValue.set('all');
    this.creatureTypeFilter.set('all');
    this.colorFilter.set('all');
    this.keywordFilter.set('all');
    this.effectFilter.set('all');
    this.effectMatchNames.set(null);
  }

  setEffectFilter(value: string): void {
    this.effectFilter.set(value);
    this.loadEffectMatches();
  }

  /** Effekt-Kategorien sind kein Feld auf der Karte, sondern nur über eine Scryfall-Suche abfragbar - deshalb async statt wie die übrigen Filter rein lokal. */
  private async loadEffectMatches(): Promise<void> {
    const effect = this.effectFilter();
    const tagQuery = this.effectFilters.find((f) => f.value === effect)?.query;
    if (!tagQuery) {
      this.effectMatchNames.set(null);
      return;
    }
    this.effectFilterBusy.set(true);
    const names = this.viewingDeckCards().map((c) => c.cardName);
    const matched = await this.scryfall.filterNamesByQuery(tagQuery, names);
    this.effectMatchNames.set(matched);
    this.effectFilterBusy.set(false);
  }

  // NEU - Bearbeitungsmodus: Karten hinzufügen/entfernen
  readonly editMode = signal(false);
  /** Blendet die Kronen-Buttons auf den Kartenkacheln ein/aus - standardmäßig aus, da sie sonst auf jeder einzelnen Karte stören, obwohl man sie nur selten braucht. */
  readonly showCommanderToggle = signal(false);
  readonly addCardQuery = signal('');
  readonly addCardTypeFilter = signal<'all' | string>('all');
  readonly addCardCreatureTypeFilter = signal('');
  readonly addCardColorFilter = signal<'all' | 'W' | 'U' | 'B' | 'R' | 'G' | 'C'>('all');
  readonly addCardCmcFilter = signal<'all' | number>('all');
  readonly addCardEffectFilter = signal('all');
  readonly addCardKeywordFilter = signal('all');
  readonly addCardResults = signal<ScryfallCard[]>([]);
  readonly addCardBusy = signal(false);
  readonly addCardMessage = signal('');
  private addCardSearchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Funktions-Kategorien (was eine Karte TUT) über Scryfalls community-gepflegte Oracle-Tags
   * (otag:) - viel zuverlässiger als eine eigene Texterkennung. Bewusst getrennt von den
   * Fähigkeits-Keywords unten (keywordFilters): Lifelink z.B. ist eine feste Eigenschaft der
   * Karte, kein Effekt wie "Lebenspunkte gewinnen" (otag:lifegain, eigene Kategorie). "Marken
   * erzeugen" nutzt mangels passendem Tag eine Oracle-Text-Näherung.
   */
  readonly effectFilters: { value: string; label: string; query: string }[] = [
    { value: 'tokens', label: 'Marken erzeugen', query: 'o:"create a" o:token' },
    { value: 'draw', label: 'Kartenziehen', query: 'otag:draw' },
    { value: 'removal', label: 'Entfernung', query: 'otag:removal' },
    { value: 'boardwipe', label: 'Bretträumung', query: 'otag:board-wipe' },
    { value: 'ramp', label: 'Rampe', query: 'otag:ramp' },
    { value: 'lifegain', label: 'Lebenspunkte gewinnen', query: 'otag:lifegain' },
    { value: 'counters', label: '+1/+1-Zähler', query: 'otag:counters-matter' },
    { value: 'proliferate', label: 'Proliferate', query: 'keyword:proliferate' },
    { value: 'protection', label: 'Schutz gewähren', query: 'otag:protection' },
    { value: 'reanimate', label: 'Wiederbelebung', query: 'otag:reanimate' },
    { value: 'recursion', label: 'Rekursion', query: 'otag:recursion' },
    { value: 'tutor', label: 'Tutor', query: 'otag:tutor' },
    { value: 'sacrifice', label: 'Opfern', query: 'otag:sacrifice-outlet' },
    { value: 'extraturn', label: 'Extra-Runde', query: 'otag:extra-turn' },
    { value: 'extracombat', label: 'Extra-Kampfphase', query: 'otag:extra-combat' },
    { value: 'mld', label: 'Mass Land Denial', query: 'otag:mass-land-denial' },
  ];

  /** Fähigkeits-Keywords (feste Eigenschaft der Karte, nicht Tagger-Tags, sondern echte Scryfall-Keyword-Abfragen). */
  readonly keywordFilters: { value: string; label: string }[] = [
    { value: 'lifelink', label: 'Lifelink' },
    { value: 'deathtouch', label: 'Deathtouch' },
    { value: 'flying', label: 'Flugfähigkeit' },
    { value: 'trample', label: 'Trample' },
    { value: 'vigilance', label: 'Wachsamkeit' },
    { value: 'haste', label: 'Eile' },
    { value: 'hexproof', label: 'Hexenschutz' },
    { value: 'indestructible', label: 'Unzerstörbar' },
    { value: 'menace', label: 'Bedrohlich' },
    { value: 'reach', label: 'Reichweite' },
    { value: 'first strike', label: 'Erstschlag' },
    { value: 'double strike', label: 'Doppelschlag' },
    { value: 'ward', label: 'Ward' },
    { value: 'flash', label: 'Blitzschnelle' },
    { value: 'defender', label: 'Verteidiger' },
  ];

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
  /** Kartenname (lowercase) -> neuer Commander-Status, ebenfalls nur lokal bis saveEdits(). */
  readonly pendingCommanderChanges = signal<Map<string, boolean>>(new Map());
  readonly editSaveBusy = signal(false);

  /** Kartenname (lowercase) -> gespeicherte Anzahl, als schnelle Nachschlagehilfe für Diff-Berechnungen. */
  private readonly savedQuantityByKey = computed(() => {
    const map = new Map<string, number>();
    for (const c of this.viewingDeckCards()) map.set(c.cardName.toLowerCase(), c.quantity);
    return map;
  });

  /** Kartenname (lowercase) -> gespeicherter Commander-Status, analog savedQuantityByKey. */
  private readonly savedCommanderByKey = computed(() => {
    const map = new Map<string, boolean>();
    for (const c of this.viewingDeckCards()) map.set(c.cardName.toLowerCase(), c.isCommander);
    return map;
  });

  /** viewingDeckCards, überlagert von den noch ungespeicherten Änderungen - das, was während des Bearbeitens angezeigt wird. */
  readonly editedDeckCards = computed<DeckCard[]>(() => {
    if (!this.editMode()) return this.viewingDeckCards();

    const pending = this.pendingChanges();
    const commanderChanges = this.pendingCommanderChanges();
    const result: DeckCard[] = [];
    for (const card of this.viewingDeckCards()) {
      const key = card.cardName.toLowerCase();
      const change = pending.get(key);
      const isCommander = commanderChanges.get(key) ?? card.isCommander;
      if (!change) {
        result.push(isCommander === card.isCommander ? card : { ...card, isCommander });
      } else if (change.quantity > 0) {
        result.push({ ...card, quantity: change.quantity, isCommander });
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
          isCommander: commanderChanges.get(change.cardName.toLowerCase()) ?? false,
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
    const savedCommanders = this.savedCommanderByKey();
    for (const [key, isCommander] of this.pendingCommanderChanges()) {
      if (isCommander !== (savedCommanders.get(key) ?? false)) return true;
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

  /** Karten, deren Commander-Status sich geändert hat (noch ungespeichert) - für die Anzeige vor dem Speichern. */
  readonly pendingCommanderChangeDetails = computed(() => {
    const saved = this.savedCommanderByKey();
    const changed: { cardName: string; isCommander: boolean }[] = [];
    for (const [key, isCommander] of this.pendingCommanderChanges()) {
      if (isCommander !== (saved.get(key) ?? false)) {
        const cardName =
          this.editedDeckCards().find((c) => c.cardName.toLowerCase() === key)?.cardName ?? key;
        changed.push({ cardName, isCommander });
      }
    }
    return changed;
  });

  readonly commanderMarkError = signal<string | null>(null);

  /**
   * Grobe Prüfung, ob eine Karte überhaupt als Commander infrage kommt - blendet die Krone auf
   * offensichtlich ungeeigneten Karten (Zaubersprüche, normale Kreaturen, Länder, ...) aus, statt
   * sie auf jeder einzelnen Karte anzuzeigen. Legendäre Kreaturen sind der Regelfall, manche
   * Planeswalker/Sagas haben zusätzlich explizit "can be your commander" im Kartentext stehen.
   * Background-Karten zählen ebenfalls dazu - die wandern bei "Choose a background" mit in die
   * Kommandozone und sind damit genauso markierbar (siehe canBeSecondCommander()).
   */
  isCommanderEligible(card: DeckCard): boolean {
    const typeLine = card.typeLine ?? '';
    if (typeLine.includes('Legendary') && typeLine.includes('Creature')) return true;
    if (typeLine.includes('Background')) return true;
    const oracleText = this.viewingCardDetails().get(card.cardName.toLowerCase())?.oracleText ?? '';
    return oracleText.includes('can be your commander');
  }

  /**
   * Prüft, ob zwei Karten zusammen als Commander-Paar erlaubt wären: Partner (inkl. "Partner
   * with" und "Friends forever" - Scryfall führt beide unter dem Keyword "Partner"), "Choose a
   * Background" + eine Background-Karte, oder Doctor Who "Doctor's companion" + ein Time Lord
   * Doctor.
   */
  private canBeSecondCommander(existing: DeckCard, candidate: DeckCard): boolean {
    const details = this.viewingCardDetails();
    const existingKw = details.get(existing.cardName.toLowerCase())?.keywords ?? [];
    const candidateKw = details.get(candidate.cardName.toLowerCase())?.keywords ?? [];
    const existingType = existing.typeLine ?? '';
    const candidateType = candidate.typeLine ?? '';

    if (existingKw.includes('Partner') && candidateKw.includes('Partner')) return true;
    if (existingKw.includes('Choose a background') && candidateType.includes('Background')) return true;
    if (candidateKw.includes('Choose a background') && existingType.includes('Background')) return true;
    if (existingKw.includes("Doctor's companion") && candidateType.includes('Time Lord Doctor')) return true;
    if (candidateKw.includes("Doctor's companion") && existingType.includes('Time Lord Doctor')) return true;

    return false;
  }

  /**
   * Markiert/entmarkiert eine Karte im Bearbeitungsmodus als Commander - nur lokal, bis
   * saveEdits(). Entmarkieren geht immer; ein zweiter Commander nur, wenn er mit dem
   * bestehenden zusammen als Partner/Background/Doctor's companion gültig wäre, ein dritter
   * gar nicht.
   */
  toggleCommanderMark(card: DeckCard): void {
    if (!this.canEditViewingDeck()) return;
    this.commanderMarkError.set(null);

    if (card.isCommander) {
      this.pendingCommanderChanges.update((map) => new Map(map).set(card.cardName.toLowerCase(), false));
      return;
    }

    const currentCommanders = this.editedDeckCards().filter((c) => c.isCommander);
    if (currentCommanders.length >= 2) {
      this.commanderMarkError.set('Es können maximal 2 Commander gleichzeitig markiert sein.');
      return;
    }
    if (currentCommanders.length === 1) {
      const existing = currentCommanders[0];
      if (!this.canBeSecondCommander(existing, card)) {
        this.commanderMarkError.set(
          `${existing.cardName} ist bereits Commander. ${card.cardName} kann nur zusätzlich markiert werden, wenn eine der beiden Karten Partner, Background oder Doctor's companion hat - sonst zuerst ${existing.cardName} entmarkieren.`
        );
        return;
      }
    }

    this.pendingCommanderChanges.update((map) => new Map(map).set(card.cardName.toLowerCase(), true));
  }

  // NEU - Artwork/Edition einer Karte wechseln (Bearbeitungsmodus)
  readonly artworkPickerCard = signal<DeckCard | null>(null);
  readonly artworkOptions = signal<ScryfallPrinting[]>([]);
  readonly artworkPickerBusy = signal(false);
  readonly artworkPickerError = signal<string | null>(null);

  async openArtworkPicker(card: DeckCard): Promise<void> {
    if (!this.canEditViewingDeck()) return;
    this.artworkPickerCard.set(card);
    this.artworkOptions.set([]);
    this.artworkPickerError.set(null);
    this.artworkPickerBusy.set(true);
    const printings = await this.scryfall.getPrintings(card.cardName);
    this.artworkPickerBusy.set(false);
    if (printings.length === 0) {
      this.artworkPickerError.set('Keine weiteren Editionen gefunden.');
    }
    this.artworkOptions.set(printings);
  }

  closeArtworkPicker(): void {
    this.artworkPickerCard.set(null);
    this.artworkOptions.set([]);
    this.artworkPickerError.set(null);
  }

  /** Schreibt das gewählte Artwork direkt in die DB (unabhängig vom Bearbeitungsmodus-Speichern-Button, wie Name/Tag im Kopfbereich). */
  async selectArtwork(imageUrl: string): Promise<void> {
    const deck = this.viewingDeck();
    const card = this.artworkPickerCard();
    if (!deck || !card || !this.canEditViewingDeck()) return;

    this.artworkPickerBusy.set(true);
    const ok = await this.deckService.updateCardImage(deck.id, card.cardName, imageUrl);
    this.artworkPickerBusy.set(false);

    if (!ok) {
      this.artworkPickerError.set('Bild konnte nicht gespeichert werden.');
      return;
    }

    const key = card.cardName.toLowerCase();
    this.viewingDeckCards.update((cards) =>
      cards.map((c) => (c.cardName.toLowerCase() === key ? { ...c, imageUrl } : c))
    );
    this.closeArtworkPicker();
  }

  /** Eigenes Bild statt einer Scryfall-Edition hochladen und direkt als Artwork setzen. */
  async uploadCustomArtwork(file: File): Promise<void> {
    const uid = this.auth.currentUser()?.id;
    if (!uid || !this.canEditViewingDeck()) return;

    this.artworkPickerBusy.set(true);
    this.artworkPickerError.set(null);
    const url = await this.deckService.uploadCustomCardArt(uid, file);
    this.artworkPickerBusy.set(false);

    if (!url) {
      this.artworkPickerError.set('Hochladen fehlgeschlagen (nur Bilder bis 10 MB).');
      return;
    }
    await this.selectArtwork(url);
  }

  toggleEditMode(): void {
    if (this.editMode() || !this.canEditViewingDeck()) return; // Verlassen geht nur bewusst über saveEdits()/cancelEdits()
    this.editMode.set(true);
    this.showCommanderToggle.set(false);
    this.artworkPickerCard.set(null);
    this.artworkOptions.set([]);
    this.pendingChanges.set(new Map());
    this.pendingCommanderChanges.set(new Map());
    this.commanderMarkError.set(null);
    this.addCardQuery.set('');
    this.addCardTypeFilter.set('all');
    this.addCardCreatureTypeFilter.set('');
    this.addCardColorFilter.set('all');
    this.addCardCmcFilter.set('all');
    this.addCardEffectFilter.set('all');
    this.addCardKeywordFilter.set('all');
    this.addCardResults.set([]);
    this.addCardMessage.set('');
    this.addCardMode.set('search');
    this.edhrecLists.set(null);
    this.edhrecCardDetails.set(new Map());
    this.edhrecCategoryImagesBusy.set(new Set());
    this.edhrecBrowseTagActive.set(false);
    this.edhrecBrowseTag.set(null);
    this.edhrecAvailableTags.set([]);
    this.edhrecTagsBusy.set(false);
    // Auslöser, damit die Auto-Load-Effekte oben garantiert neu laden, selbst wenn sich der
    // Commander-Name dabei textlich nicht ändert (siehe Kommentar bei edhrecRefreshTick).
    this.edhrecRefreshTick.update((v) => v + 1);
    this.edhrecBusy.set(false);
    this.edhrecFailed.set(false);
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
    if (!deck || !this.canEditViewingDeck()) return;
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

    const savedCommanders = this.savedCommanderByKey();
    for (const [key, isCommander] of this.pendingCommanderChanges()) {
      if (isCommander === (savedCommanders.get(key) ?? false)) continue;
      const cardName =
        this.editedDeckCards().find((c) => c.cardName.toLowerCase() === key)?.cardName ?? key;
      await this.deckService.setCardCommanderFlag(deck.id, cardName, isCommander);
    }

    this.pendingChanges.set(new Map());
    this.pendingCommanderChanges.set(new Map());
    this.commanderMarkError.set(null);
    this.editMode.set(false);
    this.showCommanderToggle.set(false);
    this.artworkPickerCard.set(null);
    this.artworkOptions.set([]);
    this.addCardMode.set('search');
    await this.reloadDeckCards();
    this.editSaveBusy.set(false);
  }

  cancelEdits(): void {
    this.pendingChanges.set(new Map());
    this.pendingCommanderChanges.set(new Map());
    this.commanderMarkError.set(null);
    this.editMode.set(false);
    this.showCommanderToggle.set(false);
    this.artworkPickerCard.set(null);
    this.artworkOptions.set([]);
    this.addCardQuery.set('');
    this.addCardResults.set([]);
    this.addCardMessage.set('');
    this.addCardMode.set('search');
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

  setAddCardEffectFilter(value: string): void {
    this.addCardEffectFilter.set(value);
    this.triggerAddCardSearch();
  }

  setAddCardKeywordFilter(value: string): void {
    this.addCardKeywordFilter.set(value);
    this.triggerAddCardSearch();
  }

  private triggerAddCardSearch(): void {
    if (this.addCardSearchTimer) clearTimeout(this.addCardSearchTimer);
    const query = this.addCardQuery();
    const type = this.addCardTypeFilter();
    const creatureType = this.addCardCreatureTypeFilter();
    const color = this.addCardColorFilter();
    const cmc = this.addCardCmcFilter();
    const effect = this.addCardEffectFilter();
    const keyword = this.addCardKeywordFilter();

    if (
      !query.trim() &&
      type === 'all' &&
      !creatureType.trim() &&
      color === 'all' &&
      cmc === 'all' &&
      effect === 'all' &&
      keyword === 'all'
    ) {
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
        effectQuery: effect === 'all' ? undefined : this.effectFilters.find((f) => f.value === effect)?.query,
        keyword: keyword === 'all' ? undefined : keyword,
        colorIdentitySubset: this.deckColorIdentitySubset(),
      });
      this.addCardResults.set(results);
      this.addCardBusy.set(false);
    }, 300);
  }

  /** Fügt eine Karte aus den Suchergebnissen nur lokal zu pendingChanges hinzu - noch nicht gespeichert. */
  addCard(card: ScryfallCard): void {
    if (!this.canEditViewingDeck()) return;
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
    // Direkt mit in viewingCardDetails übernehmen, damit z.B. die Partner-Prüfung beim
    // Commander-Markieren auch für gerade erst (noch ungespeichert) hinzugefügte Karten
    // funktioniert, ohne auf den nächsten vollen Reload zu warten.
    this.viewingCardDetails.update((map) => new Map(map).set(key, card));
    this.addCardMessage.set(`"${card.name}" hinzugefügt (noch nicht gespeichert).`);
    this.triggerFlash(card.name, 'add');
  }

  // NEU - EDHREC-Vorschläge im Add-Karten-Panel
  readonly addCardMode = signal<'search' | 'edhrec'>('search');
  readonly edhrecLists = signal<EdhrecCardlist[] | null>(null);
  readonly edhrecBusy = signal(false);
  readonly edhrecFailed = signal(false);
  /** Kartenname (lowercase) -> Scryfall-Daten (Bild, Typenzeile) für alle EDHREC-Vorschläge, damit man die Karte ansehen kann. */
  readonly edhrecCardDetails = signal<Map<string, ScryfallCard>>(new Map());
  /**
   * Nur der erste/Haupt-Commander - EDHRECs Slug-Schema für Partner-/Background-Paare liess sich
   * nicht zuverlässig ermitteln. Liest bewusst aus editedDeckCards() (nicht viewingDeckCards()),
   * damit eine noch ungespeicherte Krone-Markierung im Bearbeitungsmodus sofort neue
   * Vorschläge/Tags nachlädt, ohne erst Speichern + neu öffnen zu erfordern.
   */
  readonly edhrecCommanderName = computed(() => this.editedDeckCards().find((c) => c.isCommander)?.cardName ?? null);
  /** Beim Deck-Anlegen gewählter EDHREC-Theme-Tag (z.B. "ramp") - kombiniert die Vorschläge mit dem Commander statt nur Commander allein. */
  readonly edhrecTagSlug = computed(() => this.viewingDeck()?.edhrecTag ?? null);

  // Temporärer Tag-Wechsel nur zum Durchstöbern anderer Vorschlagslisten - ändert NICHT den
  // dauerhaft gespeicherten Deck-Tag, nur was gerade angezeigt wird. Setzt sich beim erneuten
  // Öffnen des Decks/Bearbeitungsmodus automatisch zurück auf den gespeicherten Tag.
  readonly edhrecBrowseTagActive = signal(false);
  readonly edhrecBrowseTag = signal<string | null>(null);
  readonly edhrecAvailableTags = signal<EdhrecTag[]>([]);
  readonly edhrecTagsBusy = signal(false);

  /** Der gerade tatsächlich für die Vorschläge verwendete Tag - Browse-Override hat Vorrang vor dem gespeicherten Deck-Tag. */
  readonly effectiveEdhrecTag = computed(() =>
    this.edhrecBrowseTagActive() ? this.edhrecBrowseTag() : this.edhrecTagSlug()
  );

  /** Grob lesbarer Name aus dem Tag-Slug, ohne extra Netzwerk-Anfrage (z.B. "group-hug" -> "Group Hug"). */
  readonly edhrecTagLabel = computed(() => {
    const slug = this.effectiveEdhrecTag();
    if (!slug) return null;
    return slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  });

  setAddCardMode(mode: 'search' | 'edhrec'): void {
    this.addCardMode.set(mode);
  }

  /**
   * Reiner Auslöser-Zähler (kein echter Zustand) - wird bei jedem Reset der EDHREC-Anzeige
   * (open()/close()/toggleEditMode()) hochgezählt, damit die beiden Auto-Load-Effekte unten
   * GARANTIERT neu auswerten, auch wenn sich der Commander-Name dabei textlich nicht geändert hat.
   * Vorherige Version verglich stattdessen mit einem einfachen (nicht-reaktiven) Klassenfeld - das
   * hat effect() nie zum Neu-Laufen gebracht, wenn NUR dieses Feld von außen zurückgesetzt wurde,
   * ohne dass sich ein tatsächlich gelesenes Signal änderte. Ergebnis war eine dauerhaft leere
   * EDHREC-Anzeige nach Speichern + erneutem Bearbeiten.
   */
  private readonly edhrecRefreshTick = signal(0);

  /**
   * Lädt EDHREC-Vorschläge automatisch (neu), sobald der EDHREC-Tab offen ist und sich der (ggf.
   * noch ungespeicherte) Commander ändert - deckt sowohl das erste Öffnen des Tabs als auch eine
   * Krone-Markierung währenddessen einheitlich ab.
   */
  private readonly edhrecListsAutoLoad = effect(() => {
    const mode = this.addCardMode();
    const commander = this.edhrecCommanderName();
    this.edhrecRefreshTick();
    if (mode !== 'edhrec') return;
    this.edhrecLists.set(null);
    this.edhrecFailed.set(false);
    this.edhrecBrowseTagActive.set(false);
    this.edhrecBrowseTag.set(null);
    if (!commander) {
      this.edhrecFailed.set(true);
      return;
    }
    this.loadEdhrecRecommendations();
  });

  /**
   * Lädt die verfügbaren EDHREC-Tags unabhängig vom EDHREC-Tab, sobald sich der Commander ändert -
   * wird auch für die immer sichtbare Tag-Auswahl im Kopfbereich der Detailansicht gebraucht.
   */
  private readonly edhrecTagsAutoLoad = effect(() => {
    const commander = this.edhrecCommanderName();
    this.edhrecRefreshTick();
    this.edhrecAvailableTags.set([]);
    if (!commander) return;
    this.loadEdhrecAvailableTags(commander);
  });

  /** Wechselt die angezeigten Vorschläge testweise auf einen anderen Tag - nur für diese Sitzung, nicht gespeichert. */
  setEdhrecBrowseTag(slug: string | null): void {
    this.edhrecBrowseTagActive.set(true);
    this.edhrecBrowseTag.set(slug);
    this.edhrecLists.set(null);
    this.edhrecFailed.set(false);
    this.loadEdhrecRecommendations();
  }

  /** Zurück zum dauerhaft im Deck gespeicherten Tag. */
  resetEdhrecBrowseTag(): void {
    if (!this.edhrecBrowseTagActive()) return;
    this.edhrecBrowseTagActive.set(false);
    this.edhrecBrowseTag.set(null);
    this.edhrecLists.set(null);
    this.edhrecFailed.set(false);
    this.loadEdhrecRecommendations();
  }

  private async loadEdhrecAvailableTags(commander: string): Promise<void> {
    this.edhrecTagsBusy.set(true);
    const tags = await this.edhrec.getCommanderTags(commander);
    this.edhrecTagsBusy.set(false);

    let list = tags ?? [];
    // Aktuell gespeicherten/im Entwurf stehenden Tag immer als Option anbieten, auch falls er in
    // der frisch geladenen Liste fehlen sollte (z.B. EDHREC hat ihn seither umbenannt) - sonst
    // würde die Kopfbereich-Auswahl unsichtbar auf "nichts ausgewählt" zurückfallen.
    const keepTag = this.deckTagDraft() ?? this.viewingDeck()?.edhrecTag ?? null;
    if (keepTag && !list.some((t) => t.slug === keepTag)) {
      list = [{ slug: keepTag, value: keepTag, count: 0 }, ...list];
    }
    this.edhrecAvailableTags.set(list);
  }

  private async loadEdhrecRecommendations(): Promise<void> {
    const commander = this.edhrecCommanderName();
    if (!commander) {
      this.edhrecFailed.set(true);
      return;
    }
    this.edhrecBusy.set(true);
    this.edhrecFailed.set(false);
    const tag = this.effectiveEdhrecTag();
    let lists = await this.edhrec.getCommanderRecommendations(commander, tag);
    if (lists === null && tag) {
      // Commander+Tag-Kombo evtl. nicht verfügbar (zu seltene Kombination) - auf reine
      // Commander-Vorschläge zurückfallen statt gar nichts anzuzeigen.
      lists = await this.edhrec.getCommanderRecommendations(commander);
    }
    this.edhrecLists.set(lists);
    this.edhrecFailed.set(lists === null);
    this.edhrecBusy.set(false);
    // Bilder werden bewusst NICHT hier für alle ~300 Vorschläge auf einmal geladen - das machte
    // das Öffnen des EDHREC-Tabs spürbar langsam, obwohl die meisten Kategorien eingeklappt bleiben
    // und ihre Bilder nie zu sehen sind. Stattdessen holt loadEdhrecCategoryImages() sie erst,
    // wenn eine Kategorie tatsächlich aufgeklappt wird (siehe toggleEdhrecCategory im Component).
  }

  readonly edhrecCategoryImagesBusy = signal<Set<string>>(new Set());

  /** Lädt Bilder nur für die Karten EINER Kategorie nach, sobald sie aufgeklappt wird - bereits geladene Karten werden übersprungen. */
  async loadEdhrecCategoryImages(tag: string, cardNames: string[]): Promise<void> {
    const known = this.edhrecCardDetails();
    const missing = cardNames.filter((n) => !known.has(n.toLowerCase()));
    if (missing.length === 0) return;

    this.edhrecCategoryImagesBusy.update((set) => new Set(set).add(tag));
    const found = await this.scryfall.findCardsBulk(missing);
    this.edhrecCardDetails.update((current) => new Map([...current, ...found]));
    this.edhrecCategoryImagesBusy.update((set) => {
      const next = new Set(set);
      next.delete(tag);
      return next;
    });
  }

  isEdhrecCategoryImagesBusy(tag: string): boolean {
    return this.edhrecCategoryImagesBusy().has(tag);
  }

  edhrecCardImage(cardName: string): string | null {
    return this.edhrecCardDetails().get(cardName.toLowerCase())?.imageUrl ?? null;
  }

  isCardInDeck(cardName: string): boolean {
    return this.editedDeckCards().some((c) => c.cardName.toLowerCase() === cardName.toLowerCase());
  }

  /**
   * Bild einer Deck-Karte - fällt auf die frisch geladenen Scryfall-Zusatzdaten zurück, falls in
   * deck_cards.image_url nichts (mehr) gespeichert ist (z.B. weil der Bild-Lookup beim ursprünglichen
   * Anlegen fehlschlug). Heilt die Anzeige dadurch von selbst, ohne die Datenbank zu reparieren.
   */
  resolvedCardImage(card: DeckCard): string | null {
    return card.imageUrl ?? this.viewingCardDetails().get(card.cardName.toLowerCase())?.imageUrl ?? null;
  }

  /** Löst den EDHREC-Kartennamen zu vollen Scryfall-Daten auf (EDHREC selbst liefert nur Name+Statistik) und staged ihn wie addCard(). */
  async addEdhrecCard(cardName: string): Promise<void> {
    this.addCardBusy.set(true);
    const found = await this.scryfall.findCard(cardName);
    this.addCardBusy.set(false);
    if (!found) {
      this.addCardMessage.set(`"${cardName}" nicht bei Scryfall gefunden.`);
      return;
    }
    this.addCard(found);
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
    this.deckNameDraft.set(deck.name);
    this.deckTagDraft.set(deck.edhrecTag);
    this.deckInfoSaving.set(false);
    this.detailBusy.set(true);
    this.showChangeLog.set(false);
    this.showDeckStatsInfo.set(false);
    this.showDeckAnalysis.set(false);
    this.resetCardFilters();
    this.effectFilterBusy.set(false);
    this.editMode.set(false);
    this.showCommanderToggle.set(false);
    this.artworkPickerCard.set(null);
    this.artworkOptions.set([]);
    this.pendingChanges.set(new Map());
    this.pendingCommanderChanges.set(new Map());
    this.commanderMarkError.set(null);
    this.flashState.set(null);
    this.addCardResults.set([]);
    this.addCardMessage.set('');
    this.addCardMode.set('search');
    this.edhrecRefreshTick.update((v) => v + 1);
    this.edhrecLists.set(null);
    this.edhrecCardDetails.set(new Map());
    this.edhrecCategoryImagesBusy.set(new Set());
    this.edhrecBrowseTagActive.set(false);
    this.edhrecBrowseTag.set(null);
    this.edhrecAvailableTags.set([]);
    this.edhrecTagsBusy.set(false);
    this.edhrecBusy.set(false);
    this.edhrecFailed.set(false);
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
    this.deckNameDraft.set('');
    this.deckTagDraft.set(null);
    this.deckInfoSaving.set(false);
    this.viewingDeckCards.set([]);
    this.viewingChangeLog.set([]);
    this.viewingDeckGameStats.set(null);
    this.viewingCardDetails.set(new Map());
    this.bracketEstimate.set(null);
    this.bracketEstimateBusy.set(false);
    this.bracketEstimateFailed.set(false);
    this.bracketEstimateErrorDetail.set(null);
    this.editMode.set(false);
    this.showCommanderToggle.set(false);
    this.artworkPickerCard.set(null);
    this.artworkOptions.set([]);
    this.pendingChanges.set(new Map());
    this.pendingCommanderChanges.set(new Map());
    this.commanderMarkError.set(null);
    this.flashState.set(null);
    this.addCardResults.set([]);
    this.addCardMessage.set('');
    this.addCardMode.set('search');
    this.edhrecRefreshTick.update((v) => v + 1);
    this.edhrecLists.set(null);
    this.edhrecCardDetails.set(new Map());
    this.edhrecCategoryImagesBusy.set(new Set());
    this.edhrecBrowseTagActive.set(false);
    this.edhrecBrowseTag.set(null);
    this.edhrecAvailableTags.set([]);
    this.edhrecTagsBusy.set(false);
    this.edhrecBusy.set(false);
    this.edhrecFailed.set(false);
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
