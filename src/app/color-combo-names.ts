/**
 * Offizielle Namen der Farbkombinationen (Gilden, Schattenreiche/Shards, Keile/Wedges und die
 * Vierfarben-Namen aus Commander 2016).
 *
 * Eigennamen aus dem Spiel: "Grixis" heißt in jeder Sprache Grixis, deshalb stehen sie hier und
 * nicht in i18n.service.ts. Nur die Fälle ohne Eigennamen - eine Farbe, keine Farbe, alle fünf -
 * werden übersetzt.
 */

/** Sortierreihenfolge der Manafarben, wie sie in Magic überall verwendet wird. */
const WUBRG = 'WUBRG';

const COMBO_NAMES: Record<string, string> = {
  // Gilden (Ravnica)
  WU: 'Azorius',
  WB: 'Orzhov',
  WR: 'Boros',
  WG: 'Selesnya',
  UB: 'Dimir',
  UR: 'Izzet',
  UG: 'Simic',
  BR: 'Rakdos',
  BG: 'Golgari',
  RG: 'Gruul',
  // Schattenreiche (Alara) - die drei Farben liegen im Farbkreis nebeneinander
  WUB: 'Esper',
  UBR: 'Grixis',
  BRG: 'Jund',
  WRG: 'Naya',
  WUG: 'Bant',
  // Keile (Khans of Tarkir) - eine Farbe plus ihre beiden Gegenfarben
  WBG: 'Abzan',
  WUR: 'Jeskai',
  UBG: 'Sultai',
  WBR: 'Mardu',
  URG: 'Temur',
  // Vierfarben (Nephilim / Commander 2016)
  WUBR: 'Yore-Tiller',
  UBRG: 'Glint-Eye',
  WBRG: 'Dune-Brood',
  WURG: 'Ink-Treader',
  WUBG: 'Witch-Maw',
};

/** Bringt eine Farbidentität in die WUBRG-Reihenfolge - unabhängig davon, wie sie hereinkommt. */
export function sortColors(colors: readonly string[]): string[] {
  return [...colors].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
}

/**
 * Eigenname einer Farbkombination aus zwei bis vier Farben, sonst null (eine Farbe, farblos und
 * fünffarbig haben keinen - die Aufrufer schreiben dort ihren eigenen Text).
 */
export function colorComboName(colors: readonly string[]): string | null {
  return COMBO_NAMES[sortColors(colors).join('')] ?? null;
}
