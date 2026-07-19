import { Injectable } from '@angular/core';

export interface EdhrecCardview {
  name: string;
  synergy: number;
  numDecks: number;
  potentialDecks: number;
}

export interface EdhrecCardlist {
  tag: string;
  header: string;
  cards: EdhrecCardview[];
}

@Injectable({ providedIn: 'root' })
export class EdhrecService {
  /**
   * EDHRECs eigene Slug-Regel fuer Commander-URLs (kein offizieller Standard, aus mehreren echten
   * Beispielen abgeleitet: Kommas/Apostrophe/Punkte weg, alles andere zu Bindestrichen).
   * Funktioniert nur fuer einzelne Commander - bei Partner-/Background-Paaren kombiniert EDHREC
   * beide Namen nach einem eigenen Schema, das sich nicht zuverlaessig erraten liess.
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Akzente entfernen
      .replace(/['’,.]/g, '') // Apostroph-Varianten und Satzzeichen entfernen
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Laedt EDHRECs Kartenempfehlungen fuer einen Commander direkt vom selben JSON, das ihre eigene
   * Webseite nutzt (kein offizieller API-Key noetig, CORS ist offen) - inoffiziell/undokumentiert,
   * kann sich also theoretisch ohne Vorwarnung aendern.
   */
  async getCommanderRecommendations(commanderName: string): Promise<EdhrecCardlist[] | null> {
    const slug = this.slugify(commanderName);
    if (!slug) return null;

    try {
      const res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      const cardlists = data?.container?.json_dict?.cardlists;
      if (!Array.isArray(cardlists)) return null;

      return cardlists.map((list: any) => ({
        tag: list.tag,
        header: list.header,
        cards: ((list.cardviews ?? []) as any[]).map((c) => ({
          name: c.name,
          synergy: c.synergy ?? 0,
          numDecks: c.num_decks ?? 0,
          potentialDecks: c.potential_decks ?? 0,
        })),
      }));
    } catch {
      return null;
    }
  }
}
