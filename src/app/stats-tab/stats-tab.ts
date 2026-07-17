// NEU (komplette Datei)
import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MtgService } from '../mtg.service';
import { GroupService } from '../group.service';
import { PlayerAvatar } from '../player-avatar/player-avatar';
import {
  ExcelImportService,
  IMPORT_LOSS_PLACEHOLDER,
  IMPORT_ARCHENEMY_LOSS_PLACEHOLDER,
} from '../excel-import.service';
import { CommanderStats, DeckStats, GAME_MODES, GameMode, Match, PlayerStats } from '../models';

export type RankSortMode = 'wins' | 'winRate' | 'games';

interface ImportMappingRow {
  sheetName: string;
  /** '' = überspringen, '__NEW__' = neuer Spieler (siehe newName), sonst ein Name aus mtg.allPlayers() */
  selection: string;
  newName: string;
}

@Component({
  selector: 'app-stats-tab',
  imports: [DecimalPipe, PlayerAvatar, FormsModule],
  templateUrl: './stats-tab.html',
  styleUrl: './stats-tab.scss',
})
export class StatsTab {
  readonly mtg = inject(MtgService);
  readonly groupService = inject(GroupService);
  private readonly excelImport = inject(ExcelImportService);

  // --- Sortierung der Ranglisten: nach Siegen, Winrate oder Spielanzahl umschaltbar ---

  private compareBySortMode<T extends { wins: number; winRate: number; games: number }>(
    mode: RankSortMode
  ): (a: T, b: T) => number {
    switch (mode) {
      case 'wins':
        return (a, b) => b.wins - a.wins || b.winRate - a.winRate;
      case 'games':
        return (a, b) => b.games - a.games || b.winRate - a.winRate;
      case 'winRate':
        return (a, b) => b.winRate - a.winRate || b.games - a.games;
    }
  }

  readonly playerSortMode = signal<RankSortMode>('winRate');
  readonly deckSortMode = signal<RankSortMode>('winRate');
  readonly commanderSortMode = signal<RankSortMode>('winRate');
  readonly playerDeckSortMode = signal<RankSortMode>('winRate');
  readonly playerCommanderSortMode = signal<RankSortMode>('winRate');

  // --- Stats-Sichtbarkeit ---

  /**
   * Ob der aktuelle Nutzer die Stats von `name` im Modus `mode` sehen darf: der Host sieht
   * alles, jeder sieht seine eigenen Stats, alle anderen nur falls der Host sie für diesen
   * Modus freigegeben hat.
   */
  private canSeePlayerStats(name: string, mode: GameMode): boolean {
    if (this.groupService.isOwner()) return true;
    if (name === this.mtg.myPlayerName()) return true;
    return this.mtg.statVisibility().get(name)?.has(mode) ?? false;
  }

  /** Spieler, für die der aktuelle Nutzer in mindestens einem Modus Stats sehen darf. */
  readonly visiblePlayers = computed<string[]>(() =>
    this.mtg.allPlayers().filter((name) =>
      this.groupService.isOwner() ||
      name === this.mtg.myPlayerName() ||
      (this.mtg.statVisibility().get(name)?.size ?? 0) > 0
    )
  );

  // --- Zeitraum-Filter (Jahr) ---

  readonly selectedYear = signal<number | 'Alle'>('Alle');

  readonly availableYears = computed<number[]>(() => {
    const years = new Set<number>();
    for (const m of this.mtg.history()) {
      years.add(new Date(m.date).getFullYear());
    }
    return [...years].sort((a, b) => b - a);
  });

  setSelectedYear(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedYear.set(value === 'Alle' ? 'Alle' : Number(value));
    this.selectedCommanderDetail.set(null);
  }

  private readonly yearFilteredMatches = computed<Match[]>(() => {
    const year = this.selectedYear();
    return year === 'Alle'
      ? this.mtg.history()
      : this.mtg.history().filter((m) => new Date(m.date).getFullYear() === year);
  });

  // --- Modus-Filter ---

  readonly filterOptions: readonly (GameMode | 'Alle')[] = ['Alle', ...GAME_MODES];
  readonly selectedMode = signal<GameMode | 'Alle'>('Alle');

  readonly filteredMatches = computed<Match[]>(() => {
    const mode = this.selectedMode();
    const base = this.yearFilteredMatches();
    return mode === 'Alle' ? base : base.filter((m) => m.mode === mode);
  });

  // NEU
  /**
   * "Echte" Match-Anzahl statt roher Datensatz-Anzahl: der Excel-Import legt
   * pro real gespieltem Match mehrere Datensätze an (1x Sieger + 1x pro
   * Verlierer mit Platzhalter-Gewinner). Diese Verlierer-Duplikate zählen hier
   * nicht mit, sonst wäre "Spiele gesamt" ein Vielfaches der echten Zahl.
   * Betrifft nur Commander/Cube/Archenemy-Team-Import; bei live getrackten
   * Matches gibt's diese Duplikate ohnehin nicht (1 Match = 1 Datensatz).
   */
  readonly totalGames = computed(
    () =>
      this.filteredMatches().filter(
        (m) =>
          m.winner !== IMPORT_LOSS_PLACEHOLDER && m.winner !== IMPORT_ARCHENEMY_LOSS_PLACEHOLDER
      ).length
  );

  readonly playerStats = computed<PlayerStats[]>(() => {
    const stats = new Map<string, { games: number; wins: number }>();
    for (const match of this.filteredMatches()) {
      for (const p of match.players) {
        if (!this.canSeePlayerStats(p.name, match.mode)) continue;
        const entry = stats.get(p.name) ?? { games: 0, wins: 0 };
        entry.games++;
        if (this.isPlayerWinner(match, p.name)) entry.wins++;
        stats.set(p.name, entry);
      }
    }
    return [...stats.entries()]
      .map(([name, s]) => ({ name, ...s, winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0 }))
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
  });

  /**
   * Mindestanzahl Spiele (innerhalb des aktuellen Jahr+Modus-Filters), ab der
   * ein Spieler/Commander in der Rangliste nach Winrate auftaucht. Bei "Alle"
   * Modi gilt eine höhere Schwelle als bei einem einzelnen Modus.
   */
  readonly qualificationThreshold = computed(() => (this.selectedMode() === 'Alle' ? 10 : 3));

  /** Rangliste: nur qualifizierte Spieler (>= Schwelle), sortiert nach Winrate statt nach Siegen. */
  readonly rankedPlayerStats = computed<PlayerStats[]>(() =>
    this.playerStats()
      .filter((p) => p.games >= this.qualificationThreshold())
      .sort(this.compareBySortMode(this.playerSortMode()))
  );

  /** Spieler unterhalb der Schwelle, mit Anzeige wie viele Spiele noch bis zur Qualifikation fehlen. */
  readonly playersInQualification = computed(() =>
    this.playerStats()
      .filter((p) => p.games < this.qualificationThreshold())
      .map((p) => ({ ...p, gamesNeeded: this.qualificationThreshold() - p.games }))
      .sort((a, b) => a.gamesNeeded - b.gamesNeeded || a.name.localeCompare(b.name))
  );

  readonly commanderStats = computed<CommanderStats[]>(() => {
    const stats = new Map<string, { games: number; wins: number; playedBy: Set<string> }>();
    for (const match of this.filteredMatches()) {
      for (const p of match.players) {
        if (!p.commander) continue;
        const entry = stats.get(p.commander) ?? { games: 0, wins: 0, playedBy: new Set<string>() };
        entry.games++;
        entry.playedBy.add(p.name);
        if (this.isPlayerWinner(match, p.name)) entry.wins++;
        stats.set(p.commander, entry);
      }
    }
    return [...stats.entries()]
      .map(([commander, s]) => ({
        commander,
        games: s.games,
        wins: s.wins,
        winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
        playedBy: [...s.playedBy],
      }))
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
  });

  /** Feste Mindestanzahl Spiele für die Commander-Rangliste (unabhängig vom Modus-Filter). */
  readonly commanderQualificationThreshold = 5;

  /** Rangliste: nur qualifizierte Commander (>= Schwelle), sortiert nach Winrate. */
  readonly rankedCommanderStats = computed<CommanderStats[]>(() =>
    this.commanderStats()
      .filter((c) => c.games >= this.commanderQualificationThreshold)
      .sort(this.compareBySortMode(this.commanderSortMode()))
  );

  /** Commander unterhalb der Schwelle, mit Anzeige wie viele Spiele noch bis zur Qualifikation fehlen. */
  readonly commandersInQualification = computed(() =>
    this.commanderStats()
      .filter((c) => c.games < this.commanderQualificationThreshold)
      .map((c) => ({ ...c, gamesNeeded: this.commanderQualificationThreshold - c.games }))
      .sort((a, b) => a.gamesNeeded - b.gamesNeeded || a.commander.localeCompare(b.commander))
  );

  /** Ob die nicht-qualifizierten Commander (Qualifikations-Liste) eingeblendet sind. */
  readonly showCommanderQualification = signal(false);

  toggleCommanderQualification(): void {
    this.showCommanderQualification.update((v) => !v);
  }

  // --- Deck-Statistiken ---

  /** Findet zu einer Account-User-ID den Spielernamen in der aktuellen Gruppe (für "ausgeliehen von X"). */
  private deckOwnerName(ownerId: string | undefined): string | null {
    if (!ownerId) return null;
    const entry = Object.entries(this.mtg.playerUserIds()).find(([, uid]) => uid === ownerId);
    return entry?.[0] ?? null;
  }

  /**
   * Stats pro importiertem Deck (unabhängig davon, wer es in welchem Match gespielt hat -
   * z.B. bei geliehenen Decks). Respektiert bewusst dieselbe Sichtbarkeits-Einstellung wie
   * Spieler-Stats, da ein Deck meist einem bestimmten Spieler gehört und dessen Leistung zeigt.
   */
  readonly deckStats = computed<DeckStats[]>(() => {
    const stats = new Map<
      string,
      {
        deckName: string;
        isPrecon: boolean;
        ownerId?: string;
        games: number;
        wins: number;
        pilots: Set<string>;
      }
    >();
    for (const match of this.filteredMatches()) {
      for (const p of match.players) {
        if (!p.deckId || !this.canSeePlayerStats(p.name, match.mode)) continue;
        const entry = stats.get(p.deckId) ?? {
          deckName: p.deckName ?? 'Unbekanntes Deck',
          isPrecon: p.deckIsPrecon ?? false,
          ownerId: p.deckOwnerId,
          games: 0,
          wins: 0,
          pilots: new Set<string>(),
        };
        entry.games++;
        entry.pilots.add(p.name);
        if (this.isPlayerWinner(match, p.name)) entry.wins++;
        stats.set(p.deckId, entry);
      }
    }
    return [...stats.entries()]
      .map(([deckId, s]) => {
        const ownerName = this.deckOwnerName(s.ownerId);
        return {
          deckId,
          deckName: s.deckName,
          isPrecon: s.isPrecon,
          games: s.games,
          wins: s.wins,
          winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
          pilots: [...s.pilots].map((name) => ({
            name,
            borrowed: ownerName !== null && name !== ownerName,
          })),
        };
      })
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
  });

  /** Gleiche Schwelle wie bei Commandern, damit beide Ranglisten konsistent funktionieren. */
  readonly deckQualificationThreshold = this.commanderQualificationThreshold;

  /** Rangliste: nur qualifizierte Decks (>= Schwelle), sortiert nach Winrate. */
  readonly rankedDeckStats = computed<DeckStats[]>(() =>
    this.deckStats()
      .filter((d) => d.games >= this.deckQualificationThreshold)
      .sort(this.compareBySortMode(this.deckSortMode()))
  );

  /** Decks unterhalb der Schwelle, mit Anzeige wie viele Spiele noch bis zur Qualifikation fehlen. */
  readonly decksInQualification = computed(() =>
    this.deckStats()
      .filter((d) => d.games < this.deckQualificationThreshold)
      .map((d) => ({ ...d, gamesNeeded: this.deckQualificationThreshold - d.games }))
      .sort((a, b) => a.gamesNeeded - b.gamesNeeded || a.deckName.localeCompare(b.deckName))
  );

  /** Ob die nicht-qualifizierten Decks (Qualifikations-Liste) eingeblendet sind. */
  readonly showDeckQualification = signal(false);

  toggleDeckQualification(): void {
    this.showDeckQualification.update((v) => !v);
  }

  // --- Spieler-Details ---

  readonly selectedPlayer = signal<string | null>(null);
  readonly selectedCommanderDetail = signal<string | null>(null);

  selectPlayer(player: string): void {
    const isSame = this.selectedPlayer() === player;
    this.selectedPlayer.set(isSame ? null : player);
    this.selectedCommanderDetail.set(null);
    this.showPlayerDecks.set(false);
    this.showPlayerCommanders.set(false);
  }

  setSelectedMode(mode: GameMode | 'Alle'): void {
    this.selectedMode.set(mode);
    this.selectedCommanderDetail.set(null);
  }

  toggleCommanderDetail(commander: string): void {
    if (this.selectedMode() !== 'Alle') return;
    this.selectedCommanderDetail.set(
      this.selectedCommanderDetail() === commander ? null : commander
    );
  }

  private readonly selectedPlayerMatches = computed<Match[]>(() => {
    const player = this.selectedPlayer();
    if (!player) return [];
    return this.filteredMatches().filter(
      (m) => m.players.some((p) => p.name === player) && this.canSeePlayerStats(player, m.mode)
    );
  });

  readonly playerTotalGames = computed(() => this.selectedPlayerMatches().length);

  readonly playerTotalWins = computed(() => {
    const player = this.selectedPlayer();
    if (!player) return 0;
    return this.selectedPlayerMatches().filter((m) => this.isPlayerWinner(m, player)).length;
  });

  readonly playerWinRate = computed(() => {
    const games = this.playerTotalGames();
    return games > 0 ? (this.playerTotalWins() / games) * 100 : 0;
  });

  readonly playerModeStats = computed(() => {
    const player = this.selectedPlayer();
    if (!player) return [];

    const stats = new Map<GameMode, { games: number; wins: number }>();
    for (const match of this.selectedPlayerMatches()) {
      const entry = stats.get(match.mode) ?? { games: 0, wins: 0 };
      entry.games++;
      if (this.isPlayerWinner(match, player)) entry.wins++;
      stats.set(match.mode, entry);
    }

    return [...stats.entries()]
      .map(([mode, s]) => ({ mode, ...s, winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0 }))
      .sort((a, b) => b.games - a.games);
  });

  readonly playerCommanderStats = computed(() => {
    const player = this.selectedPlayer();
    if (!player) return [];

    const stats = new Map<string, { games: number; wins: number }>();
    for (const match of this.selectedPlayerMatches()) {
      const entry0 = match.players.find((p) => p.name === player);
      if (!entry0?.commander) continue;
      const entry = stats.get(entry0.commander) ?? { games: 0, wins: 0 };
      entry.games++;
      if (this.isPlayerWinner(match, player)) entry.wins++;
      stats.set(entry0.commander, entry);
    }

    return [...stats.entries()]
      .map(([commander, s]) => ({
        commander,
        ...s,
        winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
      }))
      .sort(this.compareBySortMode(this.playerCommanderSortMode()));
  });

  /** Deck-Stats des ausgewählten Spielers (eigene + geliehene Decks, die er selbst gespielt hat). */
  readonly playerDeckStats = computed(() => {
    const player = this.selectedPlayer();
    if (!player) return [];

    const stats = new Map<
      string,
      { deckName: string; isPrecon: boolean; ownerId?: string; games: number; wins: number }
    >();
    for (const match of this.selectedPlayerMatches()) {
      const entry0 = match.players.find((p) => p.name === player);
      if (!entry0?.deckId) continue;
      const entry = stats.get(entry0.deckId) ?? {
        deckName: entry0.deckName ?? 'Unbekanntes Deck',
        isPrecon: entry0.deckIsPrecon ?? false,
        ownerId: entry0.deckOwnerId,
        games: 0,
        wins: 0,
      };
      entry.games++;
      if (this.isPlayerWinner(match, player)) entry.wins++;
      stats.set(entry0.deckId, entry);
    }

    return [...stats.entries()]
      .map(([deckId, s]) => {
        const ownerName = this.deckOwnerName(s.ownerId);
        return {
          deckId,
          deckName: s.deckName,
          isPrecon: s.isPrecon,
          games: s.games,
          wins: s.wins,
          winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
          borrowed: ownerName !== null && ownerName !== player,
          ownerName,
        };
      })
      .sort(this.compareBySortMode(this.playerDeckSortMode()));
  });

  /** Ob die ausklappbaren "Decks"/"Gespielte Commander"-Bereiche in den Spieler-Details offen sind. */
  readonly showPlayerDecks = signal(false);
  readonly showPlayerCommanders = signal(false);

  togglePlayerDecks(): void {
    this.showPlayerDecks.update((v) => !v);
  }

  togglePlayerCommanders(): void {
    this.showPlayerCommanders.update((v) => !v);
  }

  readonly commanderDetailStats = computed(() => {
    const player = this.selectedPlayer();
    const commander = this.selectedCommanderDetail();
    if (!player || !commander) return [];

    const stats = new Map<GameMode, { games: number; wins: number }>();
    for (const match of this.yearFilteredMatches()) {
      const entry0 = match.players.find((p) => p.name === player);
      if (!entry0 || entry0.commander !== commander) continue;
      if (!this.canSeePlayerStats(player, match.mode)) continue;
      const entry = stats.get(match.mode) ?? { games: 0, wins: 0 };
      entry.games++;
      if (this.isPlayerWinner(match, player)) entry.wins++;
      stats.set(match.mode, entry);
    }

    return [...stats.entries()]
      .map(([mode, s]) => ({ mode, ...s, winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0 }))
      .sort((a, b) => b.games - a.games);
  });

  private readonly ARCHENEMY_OTHERS = '__OTHERS__';

  private isPlayerWinner(match: Match, playerName: string): boolean {
    if (match.mode === 'Two-Headed Giant') {
      return match.players.some((p) => p.name === playerName && p.team === match.winner);
    }

    if (match.mode === 'Archenemy') {
      const player = match.players.find((p) => p.name === playerName);
      if (!player) return false;

      if (match.winner === this.ARCHENEMY_OTHERS) {
        return !player.isArchenemy;
      }

      return playerName === match.winner;
    }

    return playerName === match.winner;
  }

  medal(index: number): string {
    return ['🥇', '🥈', '🥉'][index] ?? `${index + 1}.`;
  }

  // --- Excel-Import ---

  readonly showImportDialog = signal(false);

  openImportDialog(): void {
    this.showImportDialog.set(true);
  }

  closeImportDialog(): void {
    this.showImportDialog.set(false);
  }

  readonly importPreview = signal<ImportMappingRow[]>([]);
  readonly importBusy = signal(false);
  readonly importMessage = signal('');

  /** '' = keine Zuordnung (Cube-Spiele bleiben ohne konkreten Cube-Bezug). */
  readonly importCubeId = signal<string>('');

  setImportCubeId(event: Event): void {
    this.importCubeId.set((event.target as HTMLSelectElement).value);
  }

  /**
   * Jahr, dem die importierten (synthetischen) Spiele zugeordnet werden.
   * Datum wird beim Import fix auf den 31.12. dieses Jahres gesetzt – so
   * fließen die Alt-Statistiken korrekt in den Jahr-Filter des Stats-Tabs ein.
   */
  readonly importYear = signal<number>(new Date().getFullYear() - 1);

  readonly importYearOptions = computed<number[]>(() => {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current; y >= current - 10; y--) years.push(y);
    return years;
  });

  async onExcelSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.importMessage.set('');
    this.importBusy.set(true);
    try {
      const detected = await this.excelImport.loadFile(file);
      this.importPreview.set(
        detected.map((d) => {
          const existing = this.mtg
            .allPlayers()
            .find((p) => p.toLowerCase() === d.guessedPlayer.toLowerCase());
          return existing
            ? { sheetName: d.sheetName, selection: existing, newName: '' }
            : { sheetName: d.sheetName, selection: '__NEW__', newName: d.guessedPlayer };
        })
      );
    } catch {
      this.importMessage.set('Datei konnte nicht gelesen werden. Ist es eine gültige .xlsx-Datei?');
    } finally {
      this.importBusy.set(false);
    }
  }

  updateImportSelection(sheetName: string, value: string): void {
    this.importPreview.update((rows) =>
      rows.map((r) =>
        r.sheetName === sheetName
          ? { ...r, selection: value, newName: value === '__NEW__' ? r.newName : '' }
          : r
      )
    );
  }

  updateImportNewName(sheetName: string, value: string): void {
    this.importPreview.update((rows) =>
      rows.map((r) => (r.sheetName === sheetName ? { ...r, newName: value } : r))
    );
  }

  private effectivePlayer(row: ImportMappingRow): string {
    return row.selection === '__NEW__' ? row.newName.trim() : row.selection;
  }

  async confirmImport(): Promise<void> {
    const mapping = this.importPreview()
      .map((r) => ({ sheetName: r.sheetName, player: this.effectivePlayer(r) }))
      .filter((r) => r.player.length > 0);

    if (mapping.length === 0) {
      this.importMessage.set('Keine Zuordnung ausgewählt – nichts importiert.');
      return;
    }

    // NEU
    const importDate = `${this.importYear()}-12-31T00:00:00.000Z`;
    const selectedCube = this.mtg.cubes().find((c) => c.id === this.importCubeId());

    this.importBusy.set(true);
    this.importMessage.set('Erkenne Commander aus den Deck-Kommentaren …');
    this.importPreview.set([]);

    const matches = await this.excelImport.buildMatches(
      mapping,
      importDate,
      selectedCube
        ? { id: selectedCube.id, name: selectedCube.name, isCommander: selectedCube.isCommander }
        : undefined,
      (done, total) => this.importMessage.set(`Erkenne Commander … ${done} / ${total}`)
    );

    this.importMessage.set(
      `Importiere ${matches.length} Spiele … das kann etwas dauern, bitte warten.`
    );

    await this.mtg.importMatches(matches);

    this.importBusy.set(false);
    this.importMessage.set(
      `${matches.length} Spiele aus ${
        mapping.length
      } Deck-Tab(s) importiert (Jahr ${this.importYear()}).`
    );
  }

  cancelImport(): void {
    this.importPreview.set([]);
    this.importMessage.set('');
  }
  // NEU (ans Ende der Klasse anfügen, vor der letzten schließenden Klammer)

  // --- Hard-Reset (Danger Zone) ---

  readonly showResetConfirm = signal(false);
  readonly resetConfirmText = signal('');

  openResetConfirm(): void {
    this.showResetConfirm.set(true);
    this.resetConfirmText.set('');
  }

  closeResetConfirm(): void {
    this.showResetConfirm.set(false);
    this.resetConfirmText.set('');
    this.resetError.set('');
  }

  updateResetConfirmText(value: string): void {
    this.resetConfirmText.set(value);
  }

  readonly canConfirmReset = computed(() => this.resetConfirmText().trim() === 'LÖSCHEN');
  readonly resetError = signal('');
  readonly resetBusy = signal(false);

  async confirmReset(): Promise<void> {
    if (!this.canConfirmReset()) return;

    this.resetBusy.set(true);
    this.resetError.set('');

    const result = await this.mtg.resetAllData();

    this.resetBusy.set(false);

    if (!result.success) {
      this.resetError.set(result.error ?? 'Unbekannter Fehler beim Löschen.');
      return;
    }

    this.closeResetConfirm();
    this.selectedPlayer.set(null);
    this.selectedCommanderDetail.set(null);
    this.importMessage.set('');
  }
}
