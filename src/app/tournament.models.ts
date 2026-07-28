import { GameMode } from './models';

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
}
