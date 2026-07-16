import { GameMode } from './models';

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
