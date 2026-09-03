import { DeckFormat, GameMode } from './models';
import type { SelectedDraftSet } from './game-session.service';

export type TournamentStatus = 'setup' | 'active' | 'completed';
export type RoundCountMode = 'auto' | 'manual';
export type ParticipantStatus = 'invited' | 'joined';
export type WinnerSource = 'games' | 'manual' | 'bye';
/** 2 = klassisches 1v1 mit Best-of-3, 4 = Mehrspieler-Pod mit Einzelspiel pro Tisch. */
export type TableSize = 2 | 4;

export interface Tournament {
  id: string;
  groupId: string;
  name: string;
  status: TournamentStatus;
  gameMode: GameMode;
  /** Gespieltes MTG-Format, kombiniert mit gameMode - null nur bei gameMode 'Spezialevent'. */
  gameFormat: DeckFormat | null;
  tableSize: TableSize;
  roundCountMode: RoundCountMode;
  manualRoundCount: number | null;
  /** Erst final, sobald das Turnier gestartet wurde (vorher null). */
  roundCount: number | null;
  currentRound: number;
  roundLengthMinutes: number;
  inviteCode: string | null;
  createdBy: string;
  createdAt: string;
  /** Gemeinsames Set für alle Tische - nur bei gameMode 'Draft' relevant, sonst null. */
  draftSet: SelectedDraftSet | null;
  /** Gemeinsamer Cube für alle Tische - nur bei gameMode 'Cube' relevant, sonst null. */
  cubeId: string | null;
  /** Ob die Matches dieses Turniers zusätzlich in die allgemeine Statistik (Stats-Tab, Deck-/Commander-Stats) einfließen - unabhängig davon zählen sie immer in die Turnier-Standings. */
  countInGeneralStats: boolean;
}

export interface TournamentParticipant {
  id: string;
  tournamentId: string;
  playerId: string;
  playerName: string;
  status: ParticipantStatus;
  hadBye: boolean;
  joinedAt: string | null;
}

export interface TournamentRound {
  id: string;
  tournamentId: string;
  roundNumber: number;
  status: 'active' | 'completed';
  startedAt: string;
  deadlineAt: string;
}

export interface TournamentMatchParticipant {
  playerId: string;
  playerName: string;
  /** Nur bei 2-Personen-Tischen relevant (Best-of-3) - bei Pods bleibt es bei 0/1. */
  gamesWon: number;
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  roundId: string;
  /** Client-seitig aus dem zugehörigen TournamentRound aufgelöst, nicht in der DB-Zeile enthalten. */
  roundNumber: number;
  tableNumber: number;
  isBye: boolean;
  /** true = Tisch ohne Sieger abgeschlossen (nur bei Pods möglich - bei 1v1/BO3 wird ein Unentschieden-Einzelspiel einfach ignoriert). */
  isDraw: boolean;
  /** Zeitpunkt des ersten "Spiel starten"-Klicks für diesen Tisch - null solange noch niemand gestartet hat. Das 50-Minuten-Limit läuft ab hier, nicht ab Rundenbeginn. */
  startedAt: string | null;
  /** 1 Eintrag = Freilos, 2 = 1v1/BO3, 3-4 = Pod. */
  participants: TournamentMatchParticipant[];
  winnerPlayerId: string | null;
  winnerSource: WinnerSource | null;
  completedAt: string | null;
}

export interface StandingsRow {
  playerId: string;
  playerName: string;
  points: number;
  wins: number;
  losses: number;
  byes: number;
  /** Opponents' Match-Win % - offizieller Swiss-Tiebreaker 1 (Ø Match-Sieg-Quote der eigenen Gegner, je Antritt gewichtet, Floor 1/3). */
  omwPercent: number;
  /** Game-Win % - offizieller Swiss-Tiebreaker 2 (eigene Spiel-Sieg-Quote, Floor 1/3). */
  gwPercent: number;
  /** Opponents' Game-Win % - offizieller Swiss-Tiebreaker 3 (Ø Spiel-Sieg-Quote der eigenen Gegner, Floor 1/3). */
  ogwPercent: number;
}
