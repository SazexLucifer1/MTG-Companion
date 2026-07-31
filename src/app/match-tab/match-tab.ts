// NEU (komplette Datei)
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MtgService } from '../mtg.service';
import { ScryfallService, ScryfallSet } from '../scryfall.service';
import { GeminiService } from '../gemini.service';
import { GameSessionService } from '../game-session.service';
import { GroupService } from '../group.service';
import { PlayerAvatar } from '../player-avatar/player-avatar';
import { DeckService } from '../deck.service';
import { I18nService } from '../i18n.service';
import { TournamentService } from '../tournament.service';
import { DialogService } from '../dialog.service';
import { GAME_MODES, TEAM_OPTIONS, Match, LIVE_TRACKING_START_DATE } from '../models';

/** Ein einzelnes Spiel oder eine zu einer Karte zusammengefasste BO3-Turnierpartie (2-3 Einzelspiele) im Verlauf. */
export type HistoryRow =
  | { kind: 'single'; match: Match }
  | {
      kind: 'group';
      tournamentMatchId: string;
      date: string;
      mode: Match['mode'];
      players: [string, string];
      scores: [number, number];
      games: Match[];
    };

@Component({
  selector: 'app-match-tab',
  imports: [FormsModule, DatePipe, NgTemplateOutlet, PlayerAvatar],
  templateUrl: './match-tab.html',
  styleUrl: './match-tab.scss',
})
export class MatchTab {
  readonly mtg = inject(MtgService);
  readonly session = inject(GameSessionService);
  readonly groupService = inject(GroupService);
  private readonly scryfall = inject(ScryfallService);
  private readonly gemini = inject(GeminiService);
  private readonly deckService = inject(DeckService);
  readonly i18n = inject(I18nService);
  readonly tournament = inject(TournamentService);
  private readonly dialog = inject(DialogService);

  openTournamentPanel(): void {
    this.tournament.openPanel();
  }

  readonly modes = GAME_MODES;
  readonly teamOptions = TEAM_OPTIONS;

  // --- Cubes ---
  readonly newCubeName = signal('');
  readonly newCubeIsCommander = signal(false);

  // Commander-Suche (auch für optionalen Partner/Background)
  readonly searchTarget = signal<{ player: string; slot: 'commander' | 'partner' } | null>(null);
  readonly searchQuery = signal('');
  readonly suggestions = signal<string[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Foto-Erkennung
  readonly recognizing = signal(false);
  readonly recognizedCards = signal<string[]>([]);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly hasGeminiKey = computed(() => this.mtg.geminiApiKey().length > 0);

  // Draft sets
  readonly draftSearchQuery = signal('');
  readonly draftSuggestions = signal<ScryfallSet[]>([] as any);
  readonly draftYear = signal<number | null>(null);
  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Spielerauswahl ---

  togglePlayer(name: string): void {
    this.session.togglePlayer(name);
    if (this.searchTarget()?.player === name) this.closeSearch();
  }

  isSelected(name: string): boolean {
    return this.session.isSelected(name);
  }

  // --- Commander-Suche ---

  openSearch(playerName: string, slot: 'commander' | 'partner' = 'commander'): void {
    this.searchTarget.set({ player: playerName, slot });
    this.searchQuery.set('');
    this.suggestions.set([]);
  }

  closeSearch(): void {
    this.searchTarget.set(null);
    this.searchQuery.set('');
    this.suggestions.set([]);
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(async () => {
      this.suggestions.set(await this.scryfall.autocomplete(value));
    }, 250);
  }

  assignSearchResult(cardName: string): void {
    const target = this.searchTarget();
    if (!target) return;
    if (target.slot === 'partner') {
      this.assignPartnerCommander(target.player, cardName);
    } else {
      this.assignCommander(target.player, cardName);
    }
  }

  async onDraftSearchInput(value: string): Promise<void> {
    this.draftSearchQuery.set(value);
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.updateDraftSuggestions(), 250);
  }

  async filterDraftsByYear(yearParam: string | number | null): Promise<void> {
    const year = yearParam === null || yearParam === '' ? null : Number(yearParam);

    if (yearParam !== null && yearParam !== '' && Number.isNaN(year)) {
      return;
    }

    this.draftYear.set(year);
    await this.updateDraftSuggestions();
  }

  private async updateDraftSuggestions(): Promise<void> {
    const query = this.draftSearchQuery().trim();
    const year = this.draftYear();

    if (!query && year === null) {
      this.draftSuggestions.set([] as any);
      return;
    }

    const results = await this.scryfall.searchSets(query, year);
    this.draftSuggestions.set(results as any);
  }

  selectDraftSet(
    set: { id: string; code?: string; name: string; released_at?: string; set_type?: string } | null
  ): void {
    this.session.selectDraftSet(set);
  }

  assignCommander(playerName: string, commander: string): void {
    this.session.assignCommander(playerName, commander);
    this.recognizedCards.update((cards) => cards.filter((c) => c !== commander));
    this.closeSearch();
  }

  clearCommander(playerName: string): void {
    this.session.clearCommander(playerName);
  }

  assignPartnerCommander(playerName: string, commander: string): void {
    this.session.assignPartnerCommander(playerName, commander);
    this.recognizedCards.update((cards) => cards.filter((c) => c !== commander));
    this.closeSearch();
  }

  clearPartnerCommander(playerName: string): void {
    this.session.clearPartnerCommander(playerName);
  }

  // --- Deck-Auswahl (eigenes Deck oder von jemand anderem geliehen) ---

  readonly deckPickerTarget = signal<string | null>(null);
  readonly deckPickerOptions = signal<
    {
      deckId: string;
      deckName: string;
      isPrecon: boolean;
      ownerName?: string;
      commanderName?: string;
      commanderImageUrl?: string | null;
    }[]
  >([]);
  readonly deckPickerBusy = signal(false);
  readonly deckPickerMessage = signal('');
  /** Kartenname (lowercase) -> Bild-URL oder null (nicht gefunden) - Fallback fürs Vorschaubild, wenn das Deck kein individuell gewähltes Artwork hinterlegt hat. */
  readonly deckPickerImages = signal<Record<string, string | null>>({});
  /** true = "Deck ausleihen"-Fluss, in dem zuerst die leihgebende Person und erst danach deren Decks gewählt werden. */
  readonly deckPickerBorrowMode = signal(false);
  /** Andere mitspielende Personen mit eigenem Account, von denen geliehen werden kann - Zwischenschritt vor der eigentlichen Deck-Liste. */
  readonly borrowOwnerOptions = signal<string[]>([]);
  /** Gewählte leihgebende Person im Borrow-Flow, oder null solange noch die Personen-Auswahl angezeigt wird. */
  readonly borrowFromOwner = signal<string | null>(null);

  async openOwnDeckPicker(playerName: string): Promise<void> {
    const userId = this.mtg.playerUserIds()[playerName];
    if (!userId) return;

    this.deckPickerTarget.set(playerName);
    this.deckPickerBorrowMode.set(false);
    this.borrowFromOwner.set(null);
    this.deckPickerMessage.set('');
    this.deckPickerBusy.set(true);
    this.deckPickerImages.set({});

    const decks = await this.deckService.loadDecksForUser(userId);
    const options = decks.map((d) => ({ deckId: d.id, deckName: d.name, isPrecon: d.isPrecon }));
    this.deckPickerOptions.set(options);
    if (decks.length === 0) {
      this.deckPickerMessage.set(this.i18n.t('match.msg.noOwnDecksImported'));
    }
    this.deckPickerBusy.set(false);
    await this.loadDeckPickerCommanders(options);
  }

  openBorrowDeckPicker(playerName: string): void {
    this.deckPickerTarget.set(playerName);
    this.deckPickerBorrowMode.set(true);
    this.borrowFromOwner.set(null);
    this.deckPickerMessage.set('');
    this.deckPickerOptions.set([]);

    const others = this.session
      .selectedPlayers()
      .map((p) => p.name)
      .filter((name) => name !== playerName && this.mtg.playerUserIds()[name]);

    this.borrowOwnerOptions.set(others);
    if (others.length === 0) {
      this.deckPickerMessage.set(this.i18n.t('match.msg.noOtherDecksFound'));
    }
  }

  async selectBorrowOwner(owner: string): Promise<void> {
    this.borrowFromOwner.set(owner);
    this.deckPickerMessage.set('');
    this.deckPickerBusy.set(true);
    this.deckPickerImages.set({});

    const userId = this.mtg.playerUserIds()[owner]!;
    const decks = await this.deckService.loadDecksForUser(userId);
    const options = decks.map((d) => ({ deckId: d.id, deckName: d.name, isPrecon: d.isPrecon, ownerName: owner }));
    this.deckPickerOptions.set(options);
    if (decks.length === 0) {
      this.deckPickerMessage.set(this.i18n.t('match.msg.noOwnDecksImported'));
    }
    this.deckPickerBusy.set(false);
    await this.loadDeckPickerCommanders(options);
  }

  backToBorrowOwners(): void {
    this.borrowFromOwner.set(null);
    this.deckPickerOptions.set([]);
    this.deckPickerMessage.set('');
    this.deckPickerImages.set({});
  }

  /** Lädt den hinterlegten Commander je Deck (inkl. individuell gewähltem Artwork) und lädt fehlende Bilder per Scryfall nach, damit die Deck-Auswahl Vorschaubilder statt nur Namen zeigt. */
  private async loadDeckPickerCommanders(
    options: { deckId: string; deckName: string; isPrecon: boolean; ownerName?: string }[]
  ): Promise<void> {
    if (options.length === 0) return;

    const stored = await this.deckService.getStoredCommanders(options.map((o) => o.deckId));
    this.deckPickerOptions.update((current) =>
      current.map((o) => {
        const commander = stored.get(o.deckId);
        return commander ? { ...o, commanderName: commander.name, commanderImageUrl: commander.imageUrl } : o;
      })
    );

    const missing = [
      ...new Set(
        this.deckPickerOptions()
          .filter((o) => !o.commanderImageUrl && o.commanderName)
          .map((o) => o.commanderName!)
      ),
    ];
    if (missing.length === 0) return;

    const found = await this.scryfall.findCardsBulk(missing);
    this.deckPickerImages.update((current) => {
      const next = { ...current };
      for (const name of missing) {
        next[name.toLowerCase()] = found.get(name.toLowerCase())?.imageUrl ?? null;
      }
      return next;
    });
  }

  /** Vorschaubild für eine Deck-Option - individuell gewähltes Artwork hat Vorrang vor dem generischen Scryfall-Bild zum Commander-Namen. */
  deckPickerThumb(option: { commanderName?: string; commanderImageUrl?: string | null }): string | null {
    if (option.commanderImageUrl) return option.commanderImageUrl;
    if (!option.commanderName) return null;
    return this.deckPickerImages()[option.commanderName.toLowerCase()] ?? null;
  }

  closeDeckPicker(): void {
    this.deckPickerTarget.set(null);
    this.deckPickerOptions.set([]);
    this.deckPickerMessage.set('');
    this.deckPickerImages.set({});
    this.deckPickerBorrowMode.set(false);
    this.borrowFromOwner.set(null);
    this.borrowOwnerOptions.set([]);
  }

  async selectDeck(deckId: string): Promise<void> {
    const playerName = this.deckPickerTarget();
    if (!playerName) return;

    const cards = await this.deckService.loadDeckCards(deckId);
    const commanders = cards.filter((c) => c.isCommander);

    if (commanders.length === 0) {
      this.deckPickerMessage.set(this.i18n.t('match.msg.noCommanderInDeck'));
      return;
    }

    this.session.assignDeck(playerName, deckId, commanders[0].cardName, commanders[1]?.cardName);
    this.recognizedCards.update((cards) =>
      cards.filter((c) => c !== commanders[0].cardName && c !== commanders[1]?.cardName)
    );
    this.closeDeckPicker();
  }

  setPlayerTeam(playerName: string, team: string): void {
    this.session.setPlayerTeam(playerName, team);
  }

  toggleArchenemy(playerName: string): void {
    this.session.toggleArchenemy(playerName);
  }

  // --- Foto-Erkennung ---

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.errorMessage.set('');
    this.recognizing.set(true);
    try {
      const cards = await this.gemini.recognizeCommanders(file);
      if (cards.length === 0) {
        this.errorMessage.set(this.i18n.t('match.msg.noCommandersRecognized'));
      }
      this.recognizedCards.set(cards);
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('match.msg.photoRecognitionFailed'));
    } finally {
      this.recognizing.set(false);
    }
  }

  assignRecognizedCard(card: string, playerName: string): void {
    this.assignCommander(playerName, card);
  }

  // --- Cubes ---

  async addNewCube(): Promise<void> {
    const name = this.newCubeName().trim();
    if (!name) return;
    const created = await this.mtg.addCube(name, this.newCubeIsCommander());
    if (created) {
      this.session.selectedCubeId.set(created.id);
      this.newCubeName.set('');
      this.newCubeIsCommander.set(false);
      this.successMessage.set(this.i18n.t('match.msg.cubeAdded'));
      setTimeout(() => this.successMessage.set(''), 2000);
    } else {
      this.errorMessage.set(this.i18n.t('match.msg.cubeAddFailed'));
      setTimeout(() => this.errorMessage.set(''), 2500);
    }
  }
  async deleteCube(id: string, name: string): Promise<void> {
    if (await this.dialog.confirm(this.i18n.t('match.msg.confirmDeleteCube', { name }))) {
      if (this.session.selectedCubeId() === id) {
        this.session.selectedCubeId.set(null);
      }
      await this.mtg.deleteCube(id);
    }
  }
  // --- Verlauf ---

  readonly historyExpanded = signal(false);
  readonly historyPage = signal(0);
  readonly historyPageSize = 10;

  /**
   * Alte Excel-Import-Spiele (vor dem 17.07.2026) werden hier nur ausgeblendet, nicht gelöscht -
   * sie zählen weiterhin ganz normal in der Statistik mit (die liest direkt aus mtg.history()),
   * nur die Anzeige im Verlauf lässt sie weg.
   */
  readonly visibleHistory = computed(() =>
    this.mtg.history().filter((m) => new Date(m.date) >= LIVE_TRACKING_START_DATE)
  );

  /**
   * Fasst die 2-3 Einzelspiele eines BO3-Turniertisches zu einer Karte zusammen (aufklappbar, siehe
   * expandedGroupId) - sonst müsste man beim Nachtragen/Korrigieren eines Endstands durch 3 einzelne
   * Verlaufseinträge klicken. Pod-Tische (nur ein Spiel) und normale Spiele bleiben einzelne Einträge.
   */
  readonly historyRows = computed<HistoryRow[]>(() => {
    const matches = this.visibleHistory();
    const seen = new Set<string>();
    const rows: HistoryRow[] = [];

    for (const m of matches) {
      if (m.tournamentMatchId && m.players.length === 2) {
        if (seen.has(m.tournamentMatchId)) continue;
        seen.add(m.tournamentMatchId);

        const games = matches
          .filter((g) => g.tournamentMatchId === m.tournamentMatchId)
          .sort((a, b) => (a.tournamentGameNumber ?? 0) - (b.tournamentGameNumber ?? 0));

        if (games.length > 1) {
          const [p1, p2] = m.players.map((p) => p.name);
          rows.push({
            kind: 'group',
            tournamentMatchId: m.tournamentMatchId,
            date: m.date,
            mode: m.mode,
            players: [p1, p2],
            scores: [games.filter((g) => g.winner === p1).length, games.filter((g) => g.winner === p2).length],
            games,
          });
          continue;
        }
      }
      rows.push({ kind: 'single', match: m });
    }

    return rows;
  });

  readonly expandedGroupId = signal<string | null>(null);

  toggleGroup(tournamentMatchId: string): void {
    this.expandedGroupId.update((id) => (id === tournamentMatchId ? null : tournamentMatchId));
  }

  readonly historyTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.historyRows().length / this.historyPageSize))
  );

  readonly pagedHistory = computed(() => {
    const start = this.historyPage() * this.historyPageSize;
    return this.historyRows().slice(start, start + this.historyPageSize);
  });

  readonly historyRangeEnd = computed(() =>
    Math.min((this.historyPage() + 1) * this.historyPageSize, this.historyRows().length)
  );

  /** Findet zu einer Account-User-ID den Spielernamen in der aktuellen Gruppe (für "ausgeliehen von X" im Verlauf). */
  deckOwnerName(ownerId: string | undefined): string | null {
    if (!ownerId) return null;
    const entry = Object.entries(this.mtg.playerUserIds()).find(([, uid]) => uid === ownerId);
    return entry?.[0] ?? null;
  }

  /** true, wenn das im Verlauf gezeigte Deck nicht dem Account der spielenden Person gehört (also geliehen wurde). */
  isBorrowedDeck(player: { name: string; deckOwnerId?: string }): boolean {
    if (!player.deckOwnerId) return false;
    return this.mtg.playerUserIds()[player.name] !== player.deckOwnerId;
  }

  toggleHistory(): void {
    this.historyExpanded.update((v) => !v);
  }

  prevHistoryPage(): void {
    this.historyPage.update((p) => Math.max(0, p - 1));
  }

  nextHistoryPage(): void {
    this.historyPage.update((p) => Math.min(this.historyTotalPages() - 1, p + 1));
  }

  async deleteMatch(id: string): Promise<void> {
    if (await this.dialog.confirm(this.i18n.t('match.msg.confirmDeleteMatch'))) {
      await this.mtg.deleteMatch(id);
    }
  }

  /** Gleiche Platzhalter-Werte wie im Stats-Tab (winnerDisplay), damit die Anzeige nach dem Ändern konsistent bleibt. */
  private readonly ARCHENEMY_OTHERS = '__OTHERS__';
  private readonly DRAW = '__DRAW__';

  // --- Ergebnis nachträglich bearbeiten (Sieger + Platzierung zusammen in einem Panel) ---

  readonly editingResultMatchId = signal<string | null>(null);
  readonly placementDraft = signal<Record<string, number | null>>({});

  startEditResult(match: Match): void {
    if (this.editingResultMatchId() === match.id) {
      this.editingResultMatchId.set(null);
      return;
    }
    this.placementDraft.set(Object.fromEntries(match.players.map((p) => [p.name, p.placement ?? null])));
    this.editingResultMatchId.set(match.id);
  }

  closeEditResult(): void {
    this.editingResultMatchId.set(null);
  }

  /**
   * Ändert den Sieger eines Matches im Verlauf - bei einem Turnier-Spiel wird zusätzlich der
   * zugehörige Tisch neu berechnet (Spielstand/Tisch-Sieger), sonst würde eine Korrektur hier nur
   * die normale Statistik ändern, aber nicht die Turnier-Ansicht - siehe TournamentService.
   */
  async setMatchWinner(id: string, winner: string): Promise<void> {
    const match = this.mtg.history().find((m) => m.id === id);
    await this.mtg.updateMatchWinner(id, winner);

    if (match?.tournamentMatchId) {
      if (match.players.length === 2) {
        await this.tournament.correctGameWinner(match.tournamentMatchId, id, winner);
      } else {
        const winnerPlayerId = this.mtg.playerIdFor(winner);
        if (winnerPlayerId) await this.tournament.correctWinner(match.tournamentMatchId, winnerPlayerId);
      }
    }
  }

  setPlacementDraft(name: string, value: string): void {
    this.placementDraft.update((d) => ({ ...d, [name]: value === '' ? null : Number(value) }));
  }

  async savePlacements(match: Match): Promise<void> {
    const draft = this.placementDraft();
    await this.mtg.setPlacements(
      match.id,
      match.players.map((p) => ({ name: p.name, placement: draft[p.name] ?? null }))
    );
    this.editingResultMatchId.set(null);
  }
  /** Mögliche Gewinner-Optionen für ein Match, abhängig vom Spielmodus. */
  winnerOptions(match: Match): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];

    if (match.mode === 'Two-Headed Giant') {
      const teams = [...new Set(match.players.filter((p) => p.team).map((p) => p.team as string))];
      options.push(...teams.map((t) => ({ value: t, label: t })));
    } else if (match.mode === 'Archenemy') {
      const archenemy = match.players.find((p) => p.isArchenemy);
      if (archenemy) {
        options.push({
          value: archenemy.name,
          label: `👹 ${archenemy.name}${this.i18n.t('match.archenemySuffix')}`,
        });
      }
      options.push({ value: this.ARCHENEMY_OTHERS, label: this.i18n.t('match.theOthers') });
    } else {
      options.push(...match.players.map((p) => ({ value: p.name, label: p.name })));
    }

    options.push({ value: this.DRAW, label: this.i18n.t('match.draw') });
    return options;
  }
}
