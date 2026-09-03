import { GameMode, Match } from './models';

/** Platzhalter-Gewinner bei Archenemy: "die anderen Spieler" (alle außer dem Archenemy) haben gewonnen. */
export const ARCHENEMY_OTHERS = '__OTHERS__';

/** Platzhalter-Gewinner bei Unentschieden. */
export const DRAW = '__DRAW__';

/**
 * Ermittelt, ob ein Spieler ein Match gewonnen hat - modusabhängig (Two-Headed Giant zählt über
 * das Team, Archenemy über den Archenemy-Status). Bewusst als reine Funktion mit primitiven
 * Parametern statt an das Match/MatchPlayer-Modell gebunden, damit sie auch für Abfragen nutzbar
 * ist, die nicht über MtgService.history() laufen (z.B. gruppenübergreifende Deck-Statistiken).
 */
export function isPlayerWinner(
  mode: GameMode,
  winner: string,
  playerName: string,
  playerTeam: string | undefined,
  playerIsArchenemy: boolean | undefined
): boolean {
  if (mode === 'Two-Headed Giant') {
    return playerTeam !== undefined && playerTeam === winner;
  }

  if (mode === 'Archenemy') {
    if (winner === ARCHENEMY_OTHERS) {
      return !playerIsArchenemy;
    }
    return playerName === winner;
  }

  return playerName === winner;
}

/**
 * Baut aus den Mitgliedern eines Teams einen lesbaren Anzeigenamen ("Anna & Ben") statt des rohen,
 * austauschbaren Team-Bezeichners ("Team 1") - für Stellen, an denen ein Team NACH dem laufenden
 * Spiel angezeigt wird (z.B. Sieger-Auswahl im Verlauf), wo die live-only ingameUnits-Computed aus
 * game-session.service.ts nicht zur Verfügung steht.
 */
export function teamMemberLabel(players: { name: string; team?: string }[], team: string): string {
  return players.filter((p) => p.team === team).map((p) => p.name).join(' & ');
}

/**
 * Wandelt eine rohe Supabase-Zeile aus der "matches"-Query (mit verschachtelten Relationen) in
 * unser Match-Format um - aus mtg.service.ts extrahiert (dort ursprünglich private Methode), damit
 * MtgService.loadMatchesForGroups() (gruppenübergreifende Auswertungen im Stats-Tab) dieselbe
 * Umwandlung nutzen kann wie loadHistory(), ohne sie zu duplizieren.
 */
export function mapMatchRow(row: any): Match {
  const match: Match = {
    id: row.id,
    date: row.played_at,
    mode: row.game_mode,
    winner: row.winner_name,
    tournamentMatchId: row.tournament_match_id ?? undefined,
    tournamentGameNumber: row.tournament_game_number ?? undefined,
    countsInGeneralStats: row.counts_in_general_stats ?? true,
    players: (row.match_players ?? []).map((mp: any) => ({
      name: mp.player_name ?? mp.players?.display_name ?? '',
      commander: mp.commander_name ?? undefined,
      partnerCommander: mp.partner_commander_name ?? undefined,
      team: mp.team ?? undefined,
      isArchenemy: mp.is_archenemy ?? undefined,
      deckId: mp.deck_id ?? undefined,
      deckName: mp.decks?.name ?? undefined,
      deckOwnerId: mp.decks?.user_id ?? undefined,
      deckOwnerPlayerId: mp.decks?.player_id ?? undefined,
      deckIsPrecon: mp.decks?.is_precon ?? undefined,
      placement: mp.placement ?? undefined,
    })),
  };

  if (row.cubes) {
    match.cube = {
      id: row.cubes.id,
      name: row.cubes.name,
      isCommander: row.cubes.is_commander,
    };
  }

  if (row.draft_set_id) {
    match.draftSet = {
      id: row.draft_set_id,
      code: row.draft_set_code ?? undefined,
      name: row.draft_set_name,
      releasedAt: row.draft_set_released_at ?? undefined,
    };
  }

  return match;
}
