// NEU (komplette Datei)
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MtgService } from '../mtg.service';
import { ScryfallService, ScryfallSet } from '../scryfall.service';
import { GeminiService } from '../gemini.service';
import { GameSessionService } from '../game-session.service';
import { GroupService } from '../group.service';
import { PlayerAvatar } from '../player-avatar/player-avatar';
import { DeckService } from '../deck.service';
import { I18nService } from '../i18n.service';
import { GAME_MODES, TEAM_OPTIONS, Match, LIVE_TRACKING_START_DATE } from '../models';

@Component({
  selector: 'app-match-tab',
  imports: [FormsModule, DatePipe, PlayerAvatar],
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
    { deckId: string; deckName: string; isPrecon: boolean; ownerName?: string }[]
  >([]);
  readonly deckPickerBusy = signal(false);
  readonly deckPickerMessage = signal('');

  async openOwnDeckPicker(playerName: string): Promise<void> {
    const userId = this.mtg.playerUserIds()[playerName];
    if (!userId) return;

    this.deckPickerTarget.set(playerName);
    this.deckPickerMessage.set('');
    this.deckPickerBusy.set(true);

    const decks = await this.deckService.loadDecksForUser(userId);
    this.deckPickerOptions.set(
      decks.map((d) => ({ deckId: d.id, deckName: d.name, isPrecon: d.isPrecon }))
    );
    if (decks.length === 0) {
      this.deckPickerMessage.set(this.i18n.t('match.msg.noOwnDecksImported'));
    }
    this.deckPickerBusy.set(false);
  }

  async openBorrowDeckPicker(playerName: string): Promise<void> {
    this.deckPickerTarget.set(playerName);
    this.deckPickerMessage.set('');
    this.deckPickerBusy.set(true);

    const others = this.session
      .selectedPlayers()
      .map((p) => p.name)
      .filter((name) => name !== playerName && this.mtg.playerUserIds()[name]);

    const options: { deckId: string; deckName: string; isPrecon: boolean; ownerName?: string }[] = [];
    for (const owner of others) {
      const userId = this.mtg.playerUserIds()[owner]!;
      const decks = await this.deckService.loadDecksForUser(userId);
      for (const d of decks) {
        options.push({ deckId: d.id, deckName: d.name, isPrecon: d.isPrecon, ownerName: owner });
      }
    }

    this.deckPickerOptions.set(options);
    if (options.length === 0) {
      this.deckPickerMessage.set(this.i18n.t('match.msg.noOtherDecksFound'));
    }
    this.deckPickerBusy.set(false);
  }

  closeDeckPicker(): void {
    this.deckPickerTarget.set(null);
    this.deckPickerOptions.set([]);
    this.deckPickerMessage.set('');
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
    if (confirm(this.i18n.t('match.msg.confirmDeleteCube', { name }))) {
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

  readonly historyTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.visibleHistory().length / this.historyPageSize))
  );

  readonly pagedHistory = computed(() => {
    const start = this.historyPage() * this.historyPageSize;
    return this.visibleHistory().slice(start, start + this.historyPageSize);
  });

  readonly historyRangeEnd = computed(() =>
    Math.min((this.historyPage() + 1) * this.historyPageSize, this.visibleHistory().length)
  );

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
    if (confirm(this.i18n.t('match.msg.confirmDeleteMatch'))) {
      await this.mtg.deleteMatch(id);
    }
  }

  /** Gleiche Platzhalter-Werte wie im Stats-Tab (winnerDisplay), damit die Anzeige nach dem Ändern konsistent bleibt. */
  private readonly ARCHENEMY_OTHERS = '__OTHERS__';
  private readonly DRAW = '__DRAW__';

  readonly editingMatchId = signal<string | null>(null);

  startEditWinner(id: string): void {
    this.editingMatchId.set(this.editingMatchId() === id ? null : id);
  }

  async setMatchWinner(id: string, winner: string): Promise<void> {
    await this.mtg.updateMatchWinner(id, winner);
    this.editingMatchId.set(null);
  }

  // --- Platzierung nachträglich eintragen/ändern ---

  readonly editingPlacementsMatchId = signal<string | null>(null);
  readonly placementDraft = signal<Record<string, number | null>>({});

  startEditPlacements(match: Match): void {
    if (this.editingPlacementsMatchId() === match.id) {
      this.editingPlacementsMatchId.set(null);
      return;
    }
    this.placementDraft.set(Object.fromEntries(match.players.map((p) => [p.name, p.placement ?? null])));
    this.editingPlacementsMatchId.set(match.id);
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
    this.editingPlacementsMatchId.set(null);
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
