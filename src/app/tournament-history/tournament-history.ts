import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TournamentService } from '../tournament.service';
import { GroupService } from '../group.service';
import { I18nService } from '../i18n.service';
import { StandingsRow, Tournament, TournamentMatch } from '../tournament.models';

/**
 * Historie abgeschlossener (und laufender) Turniere einer Gruppe - eigener Nav-Tab, getrennt vom
 * "Live"-Turnier-Panel (tournament-panel/), damit man alte Turniere ansehen kann, ohne den
 * aktuell laufenden Turnier-Zustand zu beeinflussen. Zeigt zusätzlich eine Gesamtrangliste über
 * alle abgeschlossenen Turniere der Gruppe hinweg.
 */
@Component({
  selector: 'app-tournament-history',
  imports: [DatePipe],
  templateUrl: './tournament-history.html',
  styleUrl: './tournament-history.scss',
})
export class TournamentHistory {
  private readonly tournament = inject(TournamentService);
  private readonly groupService = inject(GroupService);
  readonly i18n = inject(I18nService);

  readonly tournaments = this.tournament.tournamentHistory;
  readonly aggregateStandings = this.tournament.aggregateStandings;

  readonly selectedTournament = signal<Tournament | null>(null);
  readonly selectedStandings = signal<StandingsRow[]>([]);
  readonly selectedMatches = signal<TournamentMatch[]>([]);
  readonly loadingDetail = signal(false);

  constructor() {
    effect(() => {
      const groupId = this.groupService.groupId();
      if (!groupId) return;
      this.tournament.loadTournamentHistory(groupId);
      this.tournament.loadAggregateStandings(groupId);
    });
  }

  async openTournament(t: Tournament): Promise<void> {
    this.selectedTournament.set(t);
    this.loadingDetail.set(true);
    const detail = await this.tournament.loadTournamentDetail(t.id);
    this.selectedStandings.set(detail.standings);
    this.selectedMatches.set(detail.matches);
    this.loadingDetail.set(false);
  }

  closeTournament(): void {
    this.selectedTournament.set(null);
    this.selectedStandings.set([]);
    this.selectedMatches.set([]);
  }

  participantNamesFor(match: TournamentMatch): string {
    return match.participants.map((p) => p.playerName).join(', ');
  }

  winnerNameFor(match: TournamentMatch): string | null {
    if (!match.winnerPlayerId) return null;
    return match.participants.find((p) => p.playerId === match.winnerPlayerId)?.playerName ?? null;
  }
}
