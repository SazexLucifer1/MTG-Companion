import { Injectable } from '@angular/core';

export interface BracketDeckCard {
  card: string;
  quantity: number;
}

export interface BracketClassifiedCard {
  cardName: string;
  quantity: number;
  banned: boolean;
  gameChanger: boolean;
  massLandDenial: boolean;
  extraTurn: boolean;
}

export interface BracketCombo {
  cardNames: string[];
  produces: string[];
  description: string;
  definitelyTwoCard: boolean;
  arguablyTwoCard: boolean;
  massLandDenial: boolean;
  extraTurn: boolean;
  lock: boolean;
}

export type SpellbookBracketTag = 'R' | 'S' | 'P' | 'O' | 'C' | 'E' | 'B';

export interface BracketEstimate {
  bracketTag: SpellbookBracketTag;
  cards: BracketClassifiedCard[];
  combos: BracketCombo[];
}

export const SPELLBOOK_BRACKET_LABELS: Record<SpellbookBracketTag, string> = {
  E: 'Exhibition – sehr casual',
  C: 'Core – Precon-Niveau',
  O: 'Oddball – ungewöhnlich',
  S: 'Spicy – gehoben',
  P: 'Powerful – stark',
  R: 'Ruthless – sehr kompetitiv',
  B: 'enthält für Brackets gesperrte Karten',
};

/**
 * Ruft Commander Spellbooks Bracket-Schätzung über unseren eigenen Server-Proxy
 * (functions/api/estimate-bracket.ts) auf - deren Server selbst blockt Anfragen von fremden
 * Domains per CORS, ein direkter Aufruf aus dem Browser würde also scheitern.
 */
@Injectable({ providedIn: 'root' })
export class CommanderSpellbookService {
  async estimateBracket(
    commanders: BracketDeckCard[],
    main: BracketDeckCard[]
  ): Promise<BracketEstimate | null> {
    try {
      const res = await fetch('/api/estimate-bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commanders, main }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        bracketTag: data.bracketTag,
        cards: ((data.cards ?? []) as any[]).map((c) => ({
          cardName: c.card?.name ?? '',
          quantity: c.quantity,
          banned: c.banned,
          gameChanger: c.gameChanger,
          massLandDenial: c.massLandDenial,
          extraTurn: c.extraTurn,
        })),
        combos: ((data.combos ?? []) as any[]).map((c) => ({
          cardNames: ((c.combo?.uses ?? []) as any[]).map((u) => u.card?.name).filter(Boolean),
          produces: ((c.combo?.produces ?? []) as any[]).map((p) => p.feature?.name).filter(Boolean),
          description: c.combo?.description ?? '',
          definitelyTwoCard: c.definitelyTwoCard,
          arguablyTwoCard: c.arguablyTwoCard,
          massLandDenial: c.massLandDenial,
          extraTurn: c.extraTurn,
          lock: c.lock,
        })),
      };
    } catch {
      return null;
    }
  }
}
