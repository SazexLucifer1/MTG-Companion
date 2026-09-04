import { Component, Signal, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DeckService,
  GlobalDeckStat,
  GlobalCommanderStat,
  ColorStat,
  ColorComboStat,
} from '../deck.service';
import { DECK_FORMATS, DeckFormat, GAME_MODES, GameMode } from '../models';
import { DeckViewerService } from '../deck-viewer.service';
import { AuthService } from '../auth.service';
import { CardPreviewService } from '../card-preview.service';
import { I18nService } from '../i18n.service';
import { CardImage } from '../card-image/card-image';
import { LoginRequired } from '../login-required/login-required';
import { Meter } from '../ui/meter/meter';
import { Pager } from '../ui/pager/pager';
import { RadarChart, RadarChartDatum } from '../ui/radar-chart/radar-chart';
import { ManaSymbol } from '../ui/mana-symbol/mana-symbol';
import { MultiSelect } from '../ui/multi-select/multi-select';
import { colorComboName, sortColors } from '../color-combo-names';
import { COLORLESS, FILTER_COLORS } from '../color-filter-match';
import { RankSortMode, compareBySortMode, medal, barValue, barMax } from '../rank-sort';

const PAGE_SIZE = 10;

/**
 * Mindestanzahl Partien, ab der ein Deck/Commander in der Winrate-Sortierung auftaucht - fix, nicht
 * wie im Gruppen-Scope vom Host konfigurierbar (Global hat keinen einzelnen Host). Gilt bewusst NUR
 * für "Nach Winrate": nach Siegen/Spielen sortiert bliebe sonst die ursprüngliche Absicht ("Global
 * zeigt alle") ohne den verzerrenden Effekt (ein 1x gespielter Commander mit 100% Winrate würde die
 * Winrate-Liste sonst anführen).
 */
const QUALIFICATION_THRESHOLD = 10;

const COLOR_RADAR_AXES: readonly ColorStat['color'][] = [...FILTER_COLORS, COLORLESS];

/**
 * Bündelt Sortierung, Winrate-Qualifikation und Pagination für EINE Rangliste (Decks oder
 * Commander) - beide brauchen exakt dieselbe Logik, nur mit unterschiedlichen Rohdaten. Eine
 * einfache Klasse aus Signalen/Computeds statt zweimal denselben Satz Felder in der Komponente,
 * genau wie bei den bestehenden Ranglisten im Stats-Tab (dort aber nicht extrahiert, weil es dort
 * nur je eine Instanz pro Feld gab - hier bräuchte es sie doppelt).
 */
class QualifiedRanking<T extends { name: string; games: number; wins: number; winRate: number }> {
  readonly sortMode = signal<RankSortMode>('winRate');
  readonly page = signal(0);
  readonly qualPage = signal(0);
  readonly showQualification = signal(false);

  readonly ranked: Signal<T[]>;
  readonly inQualification: Signal<(T & { gamesNeeded: number })[]>;
  readonly totalPages: Signal<number>;
  readonly effectivePage: Signal<number>;
  readonly paged: Signal<T[]>;
  readonly qualTotalPages: Signal<number>;
  readonly qualEffectivePage: Signal<number>;
  readonly pagedQualification: Signal<(T & { gamesNeeded: number })[]>;

  constructor(source: () => T[]) {
    this.ranked = computed(() => {
      const mode = this.sortMode();
      const all = source();
      const list = mode === 'winRate' ? all.filter((e) => e.games >= QUALIFICATION_THRESHOLD) : all;
      return [...list].sort(compareBySortMode(mode));
    });

    this.inQualification = computed(() => {
      if (this.sortMode() !== 'winRate') return [];
      return source()
        .filter((e) => e.games < QUALIFICATION_THRESHOLD)
        .map((e) => ({ ...e, gamesNeeded: QUALIFICATION_THRESHOLD - e.games }))
        .sort((a, b) => a.gamesNeeded - b.gamesNeeded || a.name.localeCompare(b.name));
    });

    this.totalPages = computed(() => Math.max(1, Math.ceil(this.ranked().length / PAGE_SIZE)));
    this.effectivePage = computed(() => Math.min(this.page(), this.totalPages() - 1));
    this.paged = computed(() => {
      const start = this.effectivePage() * PAGE_SIZE;
      return this.ranked().slice(start, start + PAGE_SIZE);
    });

    this.qualTotalPages = computed(() =>
      Math.max(1, Math.ceil(this.inQualification().length / PAGE_SIZE)),
    );
    this.qualEffectivePage = computed(() => Math.min(this.qualPage(), this.qualTotalPages() - 1));
    this.pagedQualification = computed(() => {
      const start = this.qualEffectivePage() * PAGE_SIZE;
      return this.inQualification().slice(start, start + PAGE_SIZE);
    });
  }

  toggleQualification(): void {
    this.showQualification.update((v) => !v);
  }
}

/**
 * Weltweite Statistik über ALLE Spieler der Website hinweg - Decks, Commander, Lieblingsfarben und
 * Farbkombinationen. Bewusst eine eigenständige, schlanke Komponente statt Teil von StatsTab: die
 * ist komplett auf einen eingeloggten Account ausgelegt (Excel-Import, Danger Zone, Reparatur-
 * Tools, Berechtigungsprüfungen), hier soll aber - wie beim öffentlichen Deck-Browser/der
 * öffentlichen Kartensuche (public-deck-browser.ts/public-card-search.ts, dieselbe Begründung in
 * deren Doc-Kommentar) - auch ganz ohne Login etwas Sinnvolles zu sehen sein. app.html rendert
 * diese Komponente direkt für abgemeldete Besucher im Stats-Tab, und StatsTab selbst benutzt sie
 * für ihren eigenen "Global"-Umschalter (siehe stats-tab.html) - eine Implementierung für beide
 * Fälle, kein doppelter Code.
 *
 * RLS beschränkt einen normalen Query strikt auf die eigenen Gruppen (is_group_member(group_id)) -
 * die Daten kommen deshalb aus zwei SECURITY DEFINER-Funktionen
 * (sql/global-stats-functions-2026-09-03.sql), die NUR aggregierte Zahlen liefern, keine
 * Spielernamen (siehe DeckService.getGlobalDeckCommanderStats()).
 */
@Component({
  selector: 'app-global-stats',
  imports: [
    DecimalPipe,
    FormsModule,
    CardImage,
    LoginRequired,
    Meter,
    Pager,
    RadarChart,
    ManaSymbol,
    MultiSelect,
  ],
  templateUrl: './global-stats.html',
  styleUrl: './global-stats.scss',
})
export class GlobalStats {
  private readonly deckService = inject(DeckService);
  private readonly viewer = inject(DeckViewerService);
  readonly auth = inject(AuthService);
  readonly cardPreview = inject(CardPreviewService);
  readonly i18n = inject(I18nService);

  readonly medal = medal;
  readonly barValue = barValue;
  readonly barMax = barMax;
  readonly qualificationThreshold = QUALIFICATION_THRESHOLD;

  readonly loading = signal(true);

  private readonly deckStatsRaw = signal<GlobalDeckStat[]>([]);
  private readonly commanderStatsRaw = signal<GlobalCommanderStat[]>([]);
  private readonly colorAndCombo = signal<{
    colorRanking: ColorStat[];
    colorComboRanking: ColorComboStat[];
  }>({ colorRanking: [], colorComboRanking: [] });

  readonly decks = new QualifiedRanking<GlobalDeckStat>(() => this.deckStatsRaw());
  readonly commanders = new QualifiedRanking<GlobalCommanderStat>(() => this.commanderStatsRaw());

  // --- Kategorie-/Format-Filter (eigenständig, kein Bezug zu MtgService.statVisibility - Global
  // hat keinen Host, der Sichtbarkeit pro Account einschränken könnte, also auch keine Sperr-Chips
  // wie im Stats-Tab). Jede Änderung löst über den Effect unten einen Neu-Abruf der beiden
  // RPC-Funktionen aus - anders als im Stats-Tab (dort clientseitiger Filter auf bereits geladenen
  // Matches) müssen hier die Filter als Parameter an die serverseitige Aggregation gehen, da
  // einzelne Match-Zeilen die Datenbank nie verlassen. ---

  readonly gameModes = GAME_MODES;
  readonly selectedModes = signal<Set<GameMode>>(new Set(GAME_MODES));
  readonly deckFormats = DECK_FORMATS;

  /**
   * Genau EIN Format oder "Alle". Startet bewusst auf "Commander" statt auf "Alle": diese Ansicht
   * besteht fast nur aus Deck-/Commander-Ranglisten, und die sind über alle Formate hinweg nicht
   * vergleichbar (siehe deckComparisonAvailable) - mit "Alle" als Start stünde hier beim ersten
   * Aufruf eine praktisch leere Seite.
   */
  readonly selectedFormat = signal<DeckFormat | 'Alle'>('Commander');

  readonly isAllModesSelected = computed(() => GAME_MODES.every((m) => this.selectedModes().has(m)));

  /** Deck-/Commander-Ranglisten sind nur innerhalb eines Formats vergleichbar - siehe Stats-Tab. */
  readonly deckComparisonAvailable = computed(() => this.selectedFormat() !== 'Alle');

  setSelectedModes(next: Set<string>): void {
    this.selectedModes.set(new Set(GAME_MODES.filter((m) => next.has(m))));
  }

  setSelectedFormat(format: DeckFormat | 'Alle'): void {
    this.selectedFormat.set(format);
  }

  constructor() {
    effect(() => {
      // "Alles ausgewählt" wird als null (= kein Filter) durchgereicht statt als volle Liste - das
      // ist der unveränderte Default-Aufruf von vorher und spart der DB die Filterprüfung.
      const modes = this.isAllModesSelected() ? null : [...this.selectedModes()];
      const format = this.selectedFormat();
      const formats = format === 'Alle' ? null : [format];

      this.loading.set(true);
      Promise.all([
        this.deckService.getGlobalDeckCommanderStats(modes, formats),
        this.deckService.getGlobalColorAndComboStats(modes, formats),
      ]).then(([deckCommander, colors]) => {
        this.deckStatsRaw.set(deckCommander.decks);
        this.commanderStatsRaw.set(deckCommander.commanders);
        this.colorAndCombo.set(colors);
        this.loading.set(false);
      });
    });
  }

  /** Öffnet ein Deck aus der Rangliste in der Deck-Detailansicht - nur für eingeloggte Nutzer im
   * Template verlinkt (DeckViewerService ist auf einen Account ausgelegt, siehe Klassen-Kommentar). */
  async openDeck(deckId: string): Promise<void> {
    const deck = await this.deckService.getDeckById(deckId);
    if (deck) this.viewer.open(deck);
  }

  // --- Lieblingsfarben & Farbkombinationen - dieselbe Darstellung wie im Stats-Tab (Gruppen-Scope)
  // und im Profil-Tab, hier lokal dupliziert (Komponenten-Logik ist nicht wie ein Service
  // gemeinsam nutzbar, ohne die Klassen eigens dafür umzubauen - das wäre eine größere,
  // fachfremde Umstrukturierung).

  readonly colorStatsWeightMode = signal<'games' | 'decks'>('games');

  setColorStatsWeightMode(mode: 'games' | 'decks'): void {
    this.colorStatsWeightMode.set(mode);
  }

  readonly colorCountFor = (entry: { gameCount: number; deckCount: number }): number =>
    this.colorStatsWeightMode() === 'games' ? entry.gameCount : entry.deckCount;

  readonly colorVar = (color: string): string =>
    'WUBRG'.includes(color) ? `var(--pip-${color.toLowerCase()})` : 'var(--series-neutral)';

  readonly colorLabel = (color: string): string =>
    color === COLORLESS ? this.i18n.t('deckView.colorless') : this.i18n.t(`pip.${color}`);

  readonly colorComboLabel = (colors: string[]): string => {
    if (colors.length === 0) return this.i18n.t('deckView.colorless');
    if (colors.length === 1)
      return this.i18n.t('colorCombo.mono', { color: this.colorLabel(colors[0]) });
    if (colors.length >= 5) return this.i18n.t('colorCombo.fiveColor');
    return colorComboName(colors) ?? colors.map((c) => this.colorLabel(c)).join(' / ');
  };

  readonly comboColors = (colors: string[]): string[] => sortColors(colors);

  readonly colorRadarChart = computed<RadarChartDatum[]>(() =>
    COLOR_RADAR_AXES.map((color) => {
      const stat = this.colorAndCombo().colorRanking.find((c) => c.color === color);
      return {
        label: this.colorLabel(color),
        value: stat ? this.colorCountFor(stat) : 0,
        color: this.colorVar(color),
        symbol: color,
      };
    }),
  );

  readonly rankedColorCombos = computed(() =>
    [...this.colorAndCombo().colorComboRanking].sort(
      (a, b) => this.colorCountFor(b) - this.colorCountFor(a),
    ),
  );

  readonly maxColorComboCount = computed(() =>
    Math.max(1, ...this.rankedColorCombos().map((c) => this.colorCountFor(c))),
  );
}
