/**
 * Teilt ein Array in Päckchen auf - nötig für Supabase-Filter wie `.in(...)`, die bei sehr vielen
 * IDs (z.B. hunderte Matches aus einem Excel-Import) sonst eine zu lange Anfrage-URL erzeugen und
 * mit "Bad Request" fehlschlagen.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
