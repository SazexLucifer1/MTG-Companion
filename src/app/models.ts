export type GameMode = 'Commander' | 'Two-Headed Giant' | 'Archenemy' | 'Cube' | 'Draft' | 'Spezialevent';

export const GAME_MODES: GameMode[] = ['Commander', 'Two-Headed Giant', 'Archenemy', 'Cube', 'Draft', 'Spezialevent'];

export type TeamName = 'Team 1' | 'Team 2' | 'Team 3' | 'Team 4' | 'Team 5';

export const TEAM_OPTIONS: TeamName[] = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5'];

export interface MatchPlayer {
  name: string;
  commander?: string;
  partnerCommander?: string;
  team?: TeamName;
  /** Für Archenemy-Modus: markiert, ob dieser Spieler der Archenemy ist */
  isArchenemy?: boolean;
  /** Verknüpftes Deck (aus dem Profil-Tab importiert), falls beim Match-Erstellen ausgewählt. */
  deckId?: string;
  /** Nur beim Lesen aus der Historie befüllt (Join), nicht beim Erstellen gesetzt. */
  deckName?: string;
  /** User-ID des Deck-Besitzers - dient zur Erkennung, ob das Deck hier nur geliehen wurde. */
  deckOwnerId?: string;
  /** Nur beim Lesen aus der Historie befüllt (Join). */
  deckIsPrecon?: boolean;
}

export interface Match {
  id: string;
  /** ISO-Datum des Spiels */
  date: string;
  mode: GameMode;
  players: MatchPlayer[];
  /** Name des Gewinners */
  winner: string;
  /** Optional: verwendeter Cube */
  cube?: {
    id: string;
    name: string;
    isCommander: boolean;
  };
  /** Optional: ausgewähltes Draft-Set */
  draftSet?: {
    id: string;
    code?: string;
    name: string;
    releasedAt?: string;
  };
}

export interface Cube {
  id: string;
  name: string;
  isCommander: boolean;
}

export interface PlayerStats {
  name: string;
  games: number;
  wins: number;
  winRate: number;
}

export interface CommanderStats {
  commander: string;
  games: number;
  wins: number;
  winRate: number;
  playedBy: string[];
}

export interface DeckStats {
  deckId: string;
  deckName: string;
  isPrecon: boolean;
  games: number;
  wins: number;
  winRate: number;
  pilots: { name: string; borrowed: boolean }[];
}
