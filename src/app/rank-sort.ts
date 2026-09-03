/**
 * Sortier-/Balken-Hilfsfunktionen für Ranglisten (Spieler, Decks, Commander) - reine Funktionen mit
 * primitiven Parametern statt an eine bestimmte Komponente gebunden, damit sowohl der Stats-Tab
 * (gruppenbezogen) als auch GlobalStats (weltweit, ohne Login nutzbar) dieselbe Sortier- und
 * Balkenlogik verwenden können, ohne sie zu duplizieren.
 */

export type RankSortMode = 'wins' | 'winRate' | 'games';

export function compareBySortMode<T extends { wins: number; winRate: number; games: number }>(
  mode: RankSortMode,
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

export function barValue(
  entry: { wins: number; games: number; winRate: number },
  mode: RankSortMode,
): number {
  switch (mode) {
    case 'wins':
      return entry.wins;
    case 'games':
      return entry.games;
    case 'winRate':
      return entry.winRate;
  }
}

/**
 * Bezugsgröße für die Balken einer Liste.
 *
 * Bei Winrate fest 100, damit 40% in jeder Liste gleich lang aussieht. Bei Absolutwerten der
 * Größtwert der Liste, sonst wäre bei lauter kleinen Zahlen jeder Balken ein Stummel.
 */
export function barMax(
  list: readonly { wins: number; games: number; winRate: number }[],
  mode: RankSortMode,
): number {
  if (mode === 'winRate') return 100;
  return Math.max(1, ...list.map((e) => barValue(e, mode)));
}

/** Platzierungs-Symbol für die ersten drei Ränge, sonst die nummerierte Platzierung. */
export function medal(index: number): string {
  return ['🥇', '🥈', '🥉'][index] ?? `${index + 1}.`;
}
