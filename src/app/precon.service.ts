import { Injectable } from '@angular/core';

export interface PreconSummary {
  name: string;
  code: string;
  fileName: string;
  releaseYear: number;
}

const DECK_LIST_URL = 'https://mtgjson.com/api/v5/DeckList.json';
const deckUrl = (fileName: string) => `https://mtgjson.com/api/v5/decks/${fileName}.json`;

/**
 * Lädt Precon-Decklisten (aktuell: Commander-Decks) von MTGJSON. Im Gegensatz zu Moxfield/
 * Archidekt/deckstats.net erlaubt MTGJSON direkte Browser-Anfragen (Access-Control-Allow-Origin: *),
 * ist also ohne Server-Proxy nutzbar.
 */
@Injectable({ providedIn: 'root' })
export class PreconService {
  private indexCache: PreconSummary[] | null = null;

  private async loadIndex(): Promise<PreconSummary[]> {
    if (this.indexCache) return this.indexCache;
    try {
      const res = await fetch(DECK_LIST_URL);
      if (!res.ok) return [];
      const data = await res.json();
      this.indexCache = ((data.data as any[]) ?? [])
        .filter((d) => d.type === 'Commander Deck')
        .map((d) => ({
          name: d.name as string,
          code: d.code as string,
          fileName: d.fileName as string,
          releaseYear: new Date(d.releaseDate).getFullYear(),
        }));
      return this.indexCache;
    } catch {
      return [];
    }
  }

  async getPreconsForYear(year: number): Promise<PreconSummary[]> {
    const index = await this.loadIndex();
    return index
      .filter((d) => d.releaseYear === year)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Baut aus den MTGJSON-Kartendaten eines Precons dieselbe Textform, die
   * DeckService.parseDecklistText erwartet - so läuft der Import über denselben,
   * schon getesteten Pfad (Scryfall-Bildersuche, Commander-Erkennung, Backfill) wie ein
   * manuell eingefügter Decklist-Text.
   */
  async loadPreconAsText(fileName: string): Promise<string | null> {
    try {
      const res = await fetch(deckUrl(fileName));
      if (!res.ok) return null;
      const data = await res.json();
      const deck = data.data;
      const lines: string[] = [];

      const commanders = (deck.commander as { name: string; count: number }[] | undefined) ?? [];
      if (commanders.length > 0) {
        lines.push('//Commander');
        for (const c of commanders) lines.push(`${c.count} ${c.name}`);
      }

      lines.push('//Main');
      for (const c of (deck.mainBoard as { name: string; count: number }[] | undefined) ?? []) {
        lines.push(`${c.count} ${c.name}`);
      }

      return lines.join('\n');
    } catch {
      return null;
    }
  }
}
