// NEU (komplette Datei)
import { Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MtgService } from '../mtg.service';
import { GroupService } from '../group.service';
import { PlayerAvatar } from '../player-avatar/player-avatar';
import { ScryfallService } from '../scryfall.service';
import {
  ExcelImportService,
  IMPORT_LOSS_PLACEHOLDER,
  IMPORT_ARCHENEMY_LOSS_PLACEHOLDER,
} from '../excel-import.service';
import { CommanderStats, DeckStats, GAME_MODES, GameMode, Match, PlayerStats } from '../models';

export type RankSortMode = 'wins' | 'winRate' | 'games';

const PAGE_SIZE = 10;

/** Gemeinsame Zeile für die vereinte Decks&Commander-Rangliste (siehe combinedDeckCommanderStats). */
interface CombinedRankEntry {
  key: string;
  name: string;
  cardName?: string;
  games: number;
  wins: number;
  winRate: number;
  playedBy: { name: string; borrowed: boolean }[];
}

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
  private readonly scryfall = inject(ScryfallService);

  // --- Kartenbilder (Commander/Erfolgreichste Commander & Decks) ---

  /** Kartenname (lowercase) -> Bild-URL oder null (nicht gefunden). Nur für aktuell sichtbare Einträge geladen. */
  private readonly cardImages = signal<Record<string, string | null>>({});

  constructor() {
    effect(() => {
      const names = new Set<string>();
      for (const e of this.pagedCombinedStats()) {
        if (e.cardName) names.add(e.cardName);
      }
      for (const e of this.pagedCombinedInQualification()) {
        if (e.cardName) names.add(e.cardName);
      }
      for (const c of this.playerCommanderStats()) {
        names.add(c.commander);
      }
      const cache = this.cardImages();
      const missing = [...names].filter((n) => !(n.toLowerCase() in cache));
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

  /** Kartenbild-URL für einen Commander-Namen, falls schon geladen (siehe cardImages). */
  commanderImage(name: string | undefined): string | null {
    if (!name) return null;
    return this.cardImages()[name.toLowerCase()] ?? null;
  }

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
  /** Gemeinsamer Sortier-Modus für die vereinte Decks&Commander-Rangliste. */
  readonly deckSortMode = signal<RankSortMode>('winRate');
  readonly playerDeckSortMode = signal<RankSortMode>('winRate');
  readonly playerCommanderSortMode = signal<RankSortMode>('winRate');

  // --- Stats-Sichtbarkeit ---

  /**
   * Ob der aktuell eingeloggte Account (der Viewer) die Stats für `mode` überhaupt sehen darf.
   * Das legt der Host pro Account und Modus in "Sichtbarkeit verwalten" fest - auch für sich
   * selbst, z.B. als Selbst-Spoilerschutz. Ohne verknüpften Spieler oder ohne explizite
   * Einstellung ist der Zugriff standardmäßig erlaubt.
   */
  canViewMode(mode: GameMode): boolean {
    const myName = this.mtg.myPlayerName();
    if (!myName) return true;
    return this.mtg.statVisibility().get(myName)?.get(mode) ?? true;
  }

  /** Modi, die für den eingeloggten Account gesperrt sind (für den Hinweis-Banner). */
  readonly blockedModes = computed(() => GAME_MODES.filter((m) => !this.canViewMode(m)));

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

  // --- Modus-Filter (Mehrfachauswahl: eigene Kombination aus mehreren Modi möglich) ---

  readonly gameModes = GAME_MODES;

  /** Aktuell gewählte Modi. Default: alle - die für den Account gesperrten werden trotzdem
   * unten per canViewMode() rausgefiltert. */
  readonly selectedModes = signal<Set<GameMode>>(new Set(GAME_MODES));

  /** Der eine ausgewählte Modus, falls genau einer gewählt ist - sonst null (Mehrfach- oder Nullauswahl = Aggregat-Ansicht). */
  readonly isSingleMode = computed<GameMode | null>(() => {
    const modes = [...this.selectedModes()];
    return modes.length === 1 ? modes[0] : null;
  });

  readonly isAllModesSelected = computed(() =>
    GAME_MODES.every((m) => this.selectedModes().has(m))
  );

  isModeSelected(mode: GameMode): boolean {
    return this.selectedModes().has(mode);
  }

  toggleModeFilter(mode: GameMode): void {
    if (!this.canViewMode(mode)) return;
    this.selectedModes.update((set) => {
      const next = new Set(set);
      if (next.has(mode)) {
        next.delete(mode);
      } else {
        next.add(mode);
      }
      return next;
    });
    this.selectedCommanderDetail.set(null);
  }

  selectAllModes(): void {
    this.selectedModes.set(new Set(GAME_MODES));
    this.selectedCommanderDetail.set(null);
  }

  readonly filteredMatches = computed<Match[]>(() => {
    const modes = this.selectedModes();
    const base = this.yearFilteredMatches();
    return base.filter((m) => modes.has(m.mode) && this.canViewMode(m.mode));
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
   * Von Host konfigurierter Override der Mindestspielzahl für die aktuelle Modus-Auswahl (vom
   * Host pro Modus bzw. für die Aggregat-Ansicht "Alle Modi" in "Qualifikationsschwellen
   * verwalten" einstellbar), oder null ohne explizite Einstellung.
   */
  private readonly qualificationOverride = computed<number | null>(() => {
    const key = this.isSingleMode() ?? 'Alle';
    return this.mtg.qualificationSettings().get(key) ?? null;
  });

  /**
   * Mindestanzahl Spiele (innerhalb des aktuellen Jahr+Modus-Filters), ab der ein Spieler in
   * der Rangliste nach Winrate auftaucht. Ohne Host-Override: bei "Alle Modi" eine höhere
   * Schwelle als bei einem einzelnen Modus.
   */
  readonly qualificationThreshold = computed(
    () => this.qualificationOverride() ?? (this.isSingleMode() === null ? 10 : 3)
  );

  /** Rangliste: nur qualifizierte Spieler (>= Schwelle), sortiert nach Winrate statt nach Siegen. */
  readonly rankedPlayerStats = computed<PlayerStats[]>(() =>
    this.playerStats()
      .filter((p) => p.games >= this.qualificationThreshold())
      .sort(this.compareBySortMode(this.playerSortMode()))
  );

  /** Seitenweise Anzeige der Spieler-Rangliste (10 pro Seite). */
  readonly playerPage = signal(0);
  readonly playerTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.rankedPlayerStats().length / PAGE_SIZE))
  );
  readonly playerEffectivePage = computed(() =>
    Math.min(this.playerPage(), this.playerTotalPages() - 1)
  );
  readonly pagedPlayerStats = computed(() => {
    const start = this.playerEffectivePage() * PAGE_SIZE;
    return this.rankedPlayerStats().slice(start, start + PAGE_SIZE);
  });
  readonly playerPageRangeEnd = computed(() =>
    Math.min((this.playerEffectivePage() + 1) * PAGE_SIZE, this.rankedPlayerStats().length)
  );

  prevPlayerPage(): void {
    this.playerPage.update((p) => Math.max(0, p - 1));
  }

  nextPlayerPage(): void {
    this.playerPage.update((p) => Math.min(this.playerTotalPages() - 1, p + 1));
  }

  /** Spieler unterhalb der Schwelle, mit Anzeige wie viele Spiele noch bis zur Qualifikation fehlen. */
  readonly playersInQualification = computed(() =>
    this.playerStats()
      .filter((p) => p.games < this.qualificationThreshold())
      .map((p) => ({ ...p, gamesNeeded: this.qualificationThreshold() - p.games }))
      .sort((a, b) => a.gamesNeeded - b.gamesNeeded || a.name.localeCompare(b.name))
  );

  /** Seitenweise Anzeige der Spieler-Qualifikationsliste (10 pro Seite). */
  readonly playerQualPage = signal(0);
  readonly playerQualTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.playersInQualification().length / PAGE_SIZE))
  );
  readonly playerQualEffectivePage = computed(() =>
    Math.min(this.playerQualPage(), this.playerQualTotalPages() - 1)
  );
  readonly pagedPlayersInQualification = computed(() => {
    const start = this.playerQualEffectivePage() * PAGE_SIZE;
    return this.playersInQualification().slice(start, start + PAGE_SIZE);
  });
  readonly playerQualPageRangeEnd = computed(() =>
    Math.min((this.playerQualEffectivePage() + 1) * PAGE_SIZE, this.playersInQualification().length)
  );

  prevPlayerQualPage(): void {
    this.playerQualPage.update((p) => Math.max(0, p - 1));
  }

  nextPlayerQualPage(): void {
    this.playerQualPage.update((p) => Math.min(this.playerQualTotalPages() - 1, p + 1));
  }

  /**
   * Fasst Commander-Spiele ohne eigenständiges (Nicht-Precon-)Deck zusammen: sowohl gar nicht
   * verlinkte Matches als auch mit einem Precon-Deck gespielte, da Precons austauschbar sind und
   * hier nicht "das beste Deck von Spieler X" abgefragt wird, sondern der Commander allgemein.
   * Eigenständige Decks (keine Precons) laufen bewusst getrennt in deckStats(), da zwei
   * verschiedene Spieler mit demselben Commander in der Praxis unterschiedliche Decks bauen.
   */
  readonly commanderStats = computed<CommanderStats[]>(() => {
    const stats = new Map<string, { games: number; wins: number; playedBy: Set<string> }>();
    for (const match of this.filteredMatches()) {
      for (const p of match.players) {
        if (!p.commander) continue;
        if (p.deckId && p.deckIsPrecon !== true) continue;
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

  /** Mindestanzahl Spiele für die Decks&Commander-Rangliste - Host-Override falls gesetzt, sonst Standard 5. */
  readonly commanderQualificationThreshold = computed(() => this.qualificationOverride() ?? 5);
  /** Gleiche Schwelle, ein Alias für Vorlagen, die noch den alten Deck-spezifischen Namen nutzen. */
  readonly deckQualificationThreshold = this.commanderQualificationThreshold;

  // --- Deck-Statistiken ---

  /** Findet zu einer Account-User-ID den Spielernamen in der aktuellen Gruppe (für "ausgeliehen von X"). */
  private deckOwnerName(ownerId: string | undefined): string | null {
    if (!ownerId) return null;
    const entry = Object.entries(this.mtg.playerUserIds()).find(([, uid]) => uid === ownerId);
    return entry?.[0] ?? null;
  }

  /**
   * Stats pro eigenständigem (Nicht-Precon-)Deck (unabhängig davon, wer es in welchem Match
   * gespielt hat - z.B. bei geliehenen Decks). Precon-Decks laufen bewusst NICHT hier, sondern
   * gesammelt in commanderStats() - siehe Kommentar dort.
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
        commander?: string;
      }
    >();
    for (const match of this.filteredMatches()) {
      for (const p of match.players) {
        if (!p.deckId || p.deckIsPrecon === true) continue;
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
        if (p.commander) entry.commander = p.commander;
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
          commander: s.commander,
        };
      })
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
  });

  /** Verschiedene Commander insgesamt (eigenständige Decks + Precons/Unverlinkte), für die Übersichts-Kachel. */
  readonly distinctCommanderCount = computed(() => {
    const names = new Set<string>();
    for (const d of this.deckStats()) {
      if (d.commander) names.add(d.commander);
    }
    for (const c of this.commanderStats()) names.add(c.commander);
    return names.size;
  });

  /**
   * Decks und Commander in EINER gemeinsamen Rangliste: eigenständige (Nicht-Precon-)Decks
   * bleiben als einzelne Einträge erhalten, Precons/unverlinkte Matches sind pro Commander
   * zusammengefasst (siehe commanderStats()).
   */
  readonly combinedDeckCommanderStats = computed<CombinedRankEntry[]>(() => [
    ...this.deckStats().map((d) => ({
      key: `d:${d.deckId}`,
      name: d.deckName,
      cardName: d.commander,
      games: d.games,
      wins: d.wins,
      winRate: d.winRate,
      playedBy: d.pilots,
    })),
    ...this.commanderStats().map((c) => ({
      key: `c:${c.commander}`,
      name: c.commander,
      cardName: c.commander,
      games: c.games,
      wins: c.wins,
      winRate: c.winRate,
      playedBy: c.playedBy.map((name) => ({ name, borrowed: false })),
    })),
  ]);

  /** Rangliste: nur qualifizierte Decks/Commander (>= Schwelle), sortiert nach Winrate. */
  readonly rankedCombinedStats = computed<CombinedRankEntry[]>(() =>
    this.combinedDeckCommanderStats()
      .filter((e) => e.games >= this.commanderQualificationThreshold())
      .sort(this.compareBySortMode(this.deckSortMode()))
  );

  /** Seitenweise Anzeige der Decks&Commander-Rangliste (10 pro Seite). */
  readonly combinedPage = signal(0);
  readonly combinedTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.rankedCombinedStats().length / PAGE_SIZE))
  );
  readonly combinedEffectivePage = computed(() =>
    Math.min(this.combinedPage(), this.combinedTotalPages() - 1)
  );
  readonly pagedCombinedStats = computed(() => {
    const start = this.combinedEffectivePage() * PAGE_SIZE;
    return this.rankedCombinedStats().slice(start, start + PAGE_SIZE);
  });
  readonly combinedPageRangeEnd = computed(() =>
    Math.min((this.combinedEffectivePage() + 1) * PAGE_SIZE, this.rankedCombinedStats().length)
  );

  prevCombinedPage(): void {
    this.combinedPage.update((p) => Math.max(0, p - 1));
  }

  nextCombinedPage(): void {
    this.combinedPage.update((p) => Math.min(this.combinedTotalPages() - 1, p + 1));
  }

  /** Decks/Commander unterhalb der Schwelle, mit Anzeige wie viele Spiele noch bis zur Qualifikation fehlen. */
  readonly combinedInQualification = computed(() =>
    this.combinedDeckCommanderStats()
      .filter((e) => e.games < this.commanderQualificationThreshold())
      .map((e) => ({ ...e, gamesNeeded: this.commanderQualificationThreshold() - e.games }))
      .sort((a, b) => a.gamesNeeded - b.gamesNeeded || a.name.localeCompare(b.name))
  );

  /** Seitenweise Anzeige der Decks&Commander-Qualifikationsliste (10 pro Seite). */
  readonly combinedQualPage = signal(0);
  readonly combinedQualTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.combinedInQualification().length / PAGE_SIZE))
  );
  readonly combinedQualEffectivePage = computed(() =>
    Math.min(this.combinedQualPage(), this.combinedQualTotalPages() - 1)
  );
  readonly pagedCombinedInQualification = computed(() => {
    const start = this.combinedQualEffectivePage() * PAGE_SIZE;
    return this.combinedInQualification().slice(start, start + PAGE_SIZE);
  });
  readonly combinedQualPageRangeEnd = computed(() =>
    Math.min(
      (this.combinedQualEffectivePage() + 1) * PAGE_SIZE,
      this.combinedInQualification().length
    )
  );

  prevCombinedQualPage(): void {
    this.combinedQualPage.update((p) => Math.max(0, p - 1));
  }

  nextCombinedQualPage(): void {
    this.combinedQualPage.update((p) => Math.min(this.combinedQualTotalPages() - 1, p + 1));
  }

  /** Ob die nicht-qualifizierten Decks/Commander (Qualifikations-Liste) eingeblendet sind. */
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

  toggleCommanderDetail(commander: string): void {
    if (this.isSingleMode() !== null) return;
    this.selectedCommanderDetail.set(
      this.selectedCommanderDetail() === commander ? null : commander
    );
  }

  private readonly selectedPlayerMatches = computed<Match[]>(() => {
    const player = this.selectedPlayer();
    if (!player) return [];
    return this.filteredMatches().filter((m) => m.players.some((p) => p.name === player));
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
    for (const match of this.filteredMatches()) {
      const entry0 = match.players.find((p) => p.name === player);
      if (!entry0 || entry0.commander !== commander) continue;
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
