// NEU
/**
 * EDH-Archetyp-Filter für die Commander-Suche ("welcher Commander passt zu Strategie X?") - bewusst
 * GETRENNT von card-effect-filters.ts. Dessen CARD_EFFECT_FILTERS beschreibt, was eine EINZELNE
 * Karte TUT (Removal, Ramp, ...) und filtert damit Karten, die man einem Deck HINZUFÜGT
 * (public-card-search.ts, deck-viewer.service.ts) - unverändert, nicht anfassen. Diese Liste hier
 * beschreibt dagegen ganze Deck-STRATEGIEN und filtert COMMANDER-Karten selbst (is:commander +
 * diese Query, siehe ScryfallService.searchCommanders()).
 *
 * Wo ein von Scryfalls community-gepflegtem Tagger-Projekt echter Oracle-Tag (otag:) existiert, der
 * die Strategie zuverlässig genug abbildet, wird dieser genutzt. Für reine Spielplan-Archetypen ohne
 * eigenen Karten-Funktions-Tag (z.B. Voltron, Aristocrats - das sind Strategien, keine
 * Karteneigenschaft) wird stattdessen eine handgebaute Text-/Keyword-Heuristik verwendet (o:"..."),
 * nach demselben Muster wie CARD_EFFECT_FILTERS' "tokens"-Eintrag (o:create o:token).
 *
 * Die Tag-Recherche für diese Liste lief indirekt über Websuche (nicht per direktem Live-Aufruf
 * gegen api.scryfall.com). Vor dem produktiven Rollout sollten insbesondere die unten als
 * niedrig-konfident markierten Einträge (voltron, aristocrats, spellslinger, superfriends,
 * politics, control, combo) einmal live gegen
 * https://api.scryfall.com/cards/search?q=is:commander+<query> geprüft werden - z.B. mit demselben
 * Wegwerf-console.log-Trick, den filterNamesByQueryChecked() in scryfall.service.ts nutzt.
 */
export interface CommanderArchetypeFilter {
  value: string;
  query: string;
}

export const COMMANDER_ARCHETYPE_FILTERS: CommanderArchetypeFilter[] = [
  // --- gut belegte Oracle-Tags ---
  { value: 'tribal', query: 'otag:tribal' },
  { value: 'grouphug', query: '(otag:group-hug or otag:group-slug)' },
  { value: 'landfall', query: 'otag:landfall' },
  { value: 'wheels', query: 'otag:wheel' },
  { value: 'mill', query: 'otag:mill' },
  { value: 'blink', query: '(otag:blink or otag:flicker)' },
  { value: 'reanimator', query: 'otag:reanimate' },
  { value: 'countersmatter', query: 'otag:counters-matter' },
  { value: 'artifactsmatter', query: 'otag:synergy-artifact' },
  { value: 'sacrifice', query: 'otag:sacrifice-outlet' },
  { value: 'ramp', query: 'otag:ramp' },
  { value: 'lifegain', query: 'otag:lifegain' },
  { value: 'extracombat', query: 'otag:extra-combat' },
  { value: 'tokens', query: 'o:create o:token' },
  { value: 'proliferate', query: 'keyword:proliferate' },
  { value: 'storm', query: '(keyword:storm or otag:storm-count-matters)' },

  // --- naheliegender Proxy-Tag statt exaktem Treffer ---
  { value: 'stax', query: 'otag:tax' },
  { value: 'enchantress', query: '(oracletag:enchantress or o:"whenever you cast an enchantment spell")' },
  { value: 'equipmentmatters', query: 'otag:synergy-equipment' },

  // --- kein passender Oracle-Tag, handgebaute Text-/Keyword-Heuristik ---
  { value: 'voltron', query: '(otag:synergy-equipment or otag:synergy-aura or o:equip or o:"aura you control")' },
  {
    value: 'aristocrats',
    query:
      '(otag:sacrifice-outlet or o:"whenever a creature you control dies" or o:"whenever another creature you control dies")',
  },
  { value: 'spellslinger', query: '(o:"instant or sorcery spell" or o:"whenever you cast an instant or sorcery spell")' },
  { value: 'superfriends', query: 'o:"planeswalkers you control"' },
  { value: 'politics', query: '(o:monarch or o:goad or o:"vote for")' },
  { value: 'control', query: '(otag:removal or otag:board-wipe or otag:counterspell)' },
  { value: 'combo', query: '(otag:combo-piece or otag:infinite-combo)' },
];
