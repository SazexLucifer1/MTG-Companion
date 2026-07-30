import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TournamentService } from '../tournament.service';
import { MtgService } from '../mtg.service';
import { GroupService } from '../group.service';
import { I18nService } from '../i18n.service';
import { DialogService } from '../dialog.service';
import { TournamentMatch, TableSize, StandingsRow } from '../tournament.models';
import { GAME_MODES, GameMode } from '../models';

/** Two-Headed Giant ist teambasiert und passt nicht zu individuellem Swiss-Ranking - daher hier ausgeschlossen. */
const TOURNAMENT_GAME_MODES: GameMode[] = GAME_MODES.filter((m) => m !== 'Two-Headed Giant');

/**
 * Globales Overlay für die Turnier-Ebene (Erstellung, Beitreten, laufende Runde mit Timer,
 * Standings) - gemountet in app.html, gleiches Muster wie IngameTracker/PlacementDialog.
 * Die eigentlichen Einzelspiele laufen weiterhin über den unveränderten IngameTracker (unterstützt
 * sowohl 1v1 als auch Mehrspieler-Pods nativ); dieses Panel schließt sich beim Start eines Spiels
 * selbst (siehe TournamentService.startGameForMatch).
 */
@Component({
  selector: 'app-tournament-panel',
  imports: [FormsModule],
  templateUrl: './tournament-panel.html',
  styleUrl: './tournament-panel.scss',
})
export class TournamentPanel {
  readonly tournament = inject(TournamentService);
  readonly mtg = inject(MtgService);
  private readonly groupService = inject(GroupService);
  private readonly dialog = inject(DialogService);
  readonly i18n = inject(I18nService);

  readonly gameModes = TOURNAMENT_GAME_MODES;

  // --- Erstellungs-Wizard ---
  readonly newName = signal('');
  readonly selectedGameMode = signal<GameMode>('Commander');
  readonly selectedTableSize = signal<TableSize>(2);
  readonly roundCountMode = signal<'auto' | 'manual'>('auto');
  readonly manualRoundCount = signal<number>(4);
  readonly selectedPlayerNames = signal<Set<string>>(new Set());
  readonly creating = signal(false);

  // --- "Sieger festlegen"-Auswahl pro Tisch ---
  readonly winnerPickerFor = signal<string | null>(null);
  /** Bei bereits entschiedenen BO3-Tischen: die Einzelspiele, um gezielt eins davon zu korrigieren statt nur den Gesamt-Sieger zu überschreiben. */
  readonly gamesForCorrection = signal<{ id: string; gameNumber: number; winnerName: string }[]>([]);

  // --- Beitritt per Einladungscode ---
  readonly joinCode = signal('');
  readonly joining = signal(false);
  readonly joinMessage = signal('');

  /** Zusätzlich zum Turnier-Code angezeigt - wer noch nicht Gruppenmitglied ist, braucht zuerst diesen. */
  readonly groupInviteCode = signal<string | null>(null);

  /** Endstand-Bildschirm nach "Turnier beenden" - hält einen Schnappschuss der Standings, weil das Turnier danach sofort aus der App verschwindet. */
  readonly showFinalResults = signal(false);
  readonly finalStandings = signal<StandingsRow[]>([]);

  constructor() {
    // Lädt den (dauerhaften, idempotenten) Gruppen-Einladungscode nach, sobald die veranstaltende
    // Person den Setup-Screen sieht - damit sie Gruppen- und Turnier-Code zusammen teilen kann.
    effect(() => {
      const t = this.tournament.activeTournament();
      const groupId = this.groupService.groupId();
      if (!t || t.status !== 'setup' || !this.tournament.isOrganizer() || !groupId) return;
      this.groupService.createInvite(groupId).then((code) => this.groupInviteCode.set(code));
    });
  }

  togglePlayerSelection(name: string): void {
    this.selectedPlayerNames.update((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  setManualRoundCount(value: string | number): void {
    this.manualRoundCount.set(Math.max(1, Number(value) || 1));
  }

  async createTournament(): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId || this.creating()) return;

    this.creating.set(true);
    const id = await this.tournament.createTournament(
      groupId,
      this.newName(),
      this.selectedGameMode(),
      this.selectedTableSize(),
      this.roundCountMode(),
      this.roundCountMode() === 'manual' ? this.manualRoundCount() : null,
      [...this.selectedPlayerNames()]
    );
    this.creating.set(false);

    if (id) {
      this.newName.set('');
      this.selectedPlayerNames.set(new Set());
    }
  }

  async confirmJoin(): Promise<void> {
    const t = this.tournament.activeTournament();
    if (t) await this.tournament.confirmJoin(t.id);
  }

  async redeemCode(): Promise<void> {
    if (this.joining()) return;
    this.joining.set(true);
    const result = await this.tournament.joinByCode(this.joinCode());
    this.joining.set(false);
    this.joinMessage.set(this.i18n.t(result.messageKey, result.params));
    if (result.success) this.joinCode.set('');
  }

  async startTournament(): Promise<void> {
    const t = this.tournament.activeTournament();
    if (!t) return;

    const joinedCount = this.tournament.participants().filter((p) => p.status === 'joined').length;
    if (joinedCount < 2) {
      await this.dialog.alert(this.i18n.t('tournament.notEnoughJoined'));
      return;
    }

    const pending = this.tournament.pendingParticipants();
    if (pending.length > 0) {
      const names = pending.map((p) => p.playerName).join(', ');
      if (!(await this.dialog.confirm(this.i18n.t('tournament.confirmStartWithPending', { names })))) return;
    }
    await this.tournament.startTournament(t.id);
  }

  async startNextRound(): Promise<void> {
    const t = this.tournament.activeTournament();
    if (!t) return;

    if (!this.tournament.canAdvanceRound()) {
      if (!(await this.dialog.confirm(this.i18n.t('tournament.confirmForceNextRound')))) return;
    }
    await this.tournament.startNextRound(t.id);
  }

  async cancelTournament(): Promise<void> {
    const t = this.tournament.activeTournament();
    if (!t) return;
    if (!(await this.dialog.confirm(this.i18n.t('tournament.confirmCancel')))) return;
    await this.tournament.cancelTournament(t.id);
  }

  async endTournament(): Promise<void> {
    const t = this.tournament.activeTournament();
    if (!t) return;
    if (!this.tournament.canAdvanceRound()) {
      if (!(await this.dialog.confirm(this.i18n.t('tournament.confirmEndEarly')))) return;
    }

    // Schnappschuss VOR dem Beenden - danach verschwindet das Turnier sofort aus den Live-Signalen.
    const finalStandings = this.tournament.standings();
    const success = await this.tournament.endTournament(t.id);
    if (success) {
      this.finalStandings.set(finalStandings);
      this.showFinalResults.set(true);
    }
  }

  closeFinalResults(): void {
    this.showFinalResults.set(false);
    this.finalStandings.set([]);
    this.close();
  }

  async startMyGame(): Promise<void> {
    const match = this.tournament.myCurrentMatch();
    if (match) await this.tournament.startGameForMatch(match);
  }

  async startGameFor(match: TournamentMatch): Promise<void> {
    await this.tournament.startGameForMatch(match);
  }

  /** Namen aller anderen Tisch-Teilnehmenden außer mir selbst, kommagetrennt (für "Dein Match": "gegen A, B, C"). */
  othersLabelFor(match: TournamentMatch): string {
    const myName = this.mtg.myPlayerName();
    return match.participants
      .map((p) => p.playerName)
      .filter((name) => name !== myName)
      .join(', ');
  }

  /** Alle Teilnehmenden-Namen eines Tisches, kommagetrennt (für die Paarungsliste). */
  participantNamesFor(match: TournamentMatch): string {
    return match.participants.map((p) => p.playerName).join(', ');
  }

  /** Organizer oder eine der tatsächlich am Tisch spielenden Personen dürfen das Spiel starten/den Sieger festlegen - so kann die veranstaltende Person das auch stellvertretend für accountlose Personen tun. */
  canManageMatch(match: TournamentMatch): boolean {
    const myName = this.mtg.myPlayerName();
    return this.tournament.isOrganizer() || match.participants.some((p) => p.playerName === myName);
  }

  winnerNameFor(match: TournamentMatch): string | null {
    if (!match.winnerPlayerId) return null;
    return match.participants.find((p) => p.playerId === match.winnerPlayerId)?.playerName ?? null;
  }

  /** Öffnet die Sieger-Auswahl - bei bereits entschiedenen BO3-Tischen werden stattdessen die Einzelspiele zum gezielten Korrigieren geladen. */
  async openWinnerPicker(match: TournamentMatch): Promise<void> {
    this.winnerPickerFor.set(match.id);
    if (match.participants.length === 2 && (match.winnerPlayerId || match.isDraw)) {
      this.gamesForCorrection.set(await this.tournament.fetchGamesFor(match.id));
    } else {
      this.gamesForCorrection.set([]);
    }
  }

  closeWinnerPicker(): void {
    this.winnerPickerFor.set(null);
    this.gamesForCorrection.set([]);
  }

  async pickWinner(match: TournamentMatch, winnerPlayerId: string): Promise<void> {
    if (match.winnerPlayerId) {
      await this.tournament.correctWinner(match.id, winnerPlayerId);
    } else {
      await this.tournament.setManualWinner(match.id, winnerPlayerId);
    }
    this.closeWinnerPicker();
  }

  async pickDraw(matchId: string): Promise<void> {
    await this.tournament.setManualDraw(matchId);
    this.closeWinnerPicker();
  }

  /** Korrigiert, wer ein einzelnes bereits gespeichertes Spiel innerhalb eines BO3-Tisches gewonnen hat - lädt die Liste danach neu, damit man bei Bedarf gleich noch ein weiteres Spiel korrigieren kann. */
  async correctGame(tournamentMatchId: string, gameRowId: string, newWinnerName: string): Promise<void> {
    await this.tournament.correctGameWinner(tournamentMatchId, gameRowId, newWinnerName);
    this.gamesForCorrection.set(await this.tournament.fetchGamesFor(tournamentMatchId));
  }

  close(): void {
    this.tournament.closePanel();
  }
}
