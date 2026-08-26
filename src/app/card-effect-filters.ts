// NEU
/**
 * Scryfall-Oracle-Tag-Filter für "was tut eine Karte" (z.B. Sacrifice-Outlet, Removal, Ramp) - aus
 * public-card-search.ts/deck-viewer.service.ts extrahiert, damit beide Stellen (und die Commander-
 * Suche nach Farbe/Mechanik) dieselbe, einmal gepflegte Liste nutzen. Bewusst OHNE die 3 rein
 * deck-lokalen Einträge aus deck-viewer.service.ts (tutor/extraturn/mld, query: '' - laufen dort
 * über deck-spezifische Analyse statt Scryfall-Abfrage, ohne Deck-Kontext nicht möglich).
 */
export interface CardEffectFilter {
  value: string;
  query: string;
}

export const CARD_EFFECT_FILTERS: CardEffectFilter[] = [
  { value: 'tokens', query: 'o:create o:token' },
  { value: 'draw', query: 'otag:draw' },
  { value: 'removal', query: 'otag:removal' },
  {
    value: 'counterspell',
    query:
      '(otag:counterspell or otag:counterspell-noncreature or otag:counterspell-creature or otag:counterspell-sorcery or otag:counterspell-instant or otag:counterspell-artifact or otag:counterspell-enchantment or otag:counterspell-planeswalker or otag:counterspell-ability or otag:counterspell-reusable or otag:counterspell-exile or otag:counterspell-free)',
  },
  { value: 'boardwipe', query: 'otag:board-wipe' },
  { value: 'ramp', query: '(otag:ramp or otag:land-ramp or otag:extra-land or otag:play-additional-land) -t:land' },
  { value: 'lifegain', query: 'otag:lifegain' },
  { value: 'counters', query: 'otag:gives-1-1-counters' },
  { value: 'proliferate', query: 'keyword:proliferate' },
  { value: 'protection', query: 'otag:protection' },
  {
    value: 'reanimate',
    query:
      '(otag:reanimate or otag:reanimate-creature or otag:reanimate-artifact or otag:reanimate-enchantment or otag:reanimate-planeswalker or otag:reanimate-permanent)',
  },
  { value: 'recursion', query: 'otag:recursion' },
  { value: 'sacrifice', query: 'otag:sacrifice-outlet' },
  { value: 'extracombat', query: 'otag:extra-combat' },

  // EDHREC-Archetyp-Tags (edhrec.com/tags) statt enger Karten-Mechaniken - per Websuche bestätigte
  // otag:-Werte, wo möglich: group-hug (412 Karten), landfall (mehrfach in echten Suchen belegt),
  // enchantress (17 Karten über den oracletag:-Alias), synergy-artifact (1030 Karten - Scryfall nutzt
  // hier bewusst ein "synergy-"-Präfix statt nur "artifact", um nicht mit dem Kartentyp zu
  // kollidieren). aristocrats/voltron/stax/spellslinger folgen bestmöglich derselben Namenskonvention,
  // ohne einzeln bestätigt zu sein - liefert bei falschem Slug einfach 0 Ergebnisse statt Fehler.
  { value: 'aristocrats', query: 'otag:aristocrats' },
  { value: 'voltron', query: 'otag:voltron' },
  { value: 'stax', query: 'otag:stax' },
  { value: 'group-hug', query: 'otag:group-hug' },
  { value: 'artifact-synergy', query: 'otag:synergy-artifact' },
  { value: 'landfall', query: 'otag:landfall' },
  { value: 'enchantress', query: 'otag:enchantress' },
  { value: 'spellslinger', query: 'otag:spellslinger' },
];
