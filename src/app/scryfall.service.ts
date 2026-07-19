import { Injectable } from '@angular/core';
import { sleep } from './array-utils';

export interface ScryfallCard {
  name: string;
  imageUrl?: string;
  typeLine?: string;
  cmc?: number;
  manaCost?: string;
  colorIdentity?: string[];
  /** Teil der offiziellen Commander-Bracket-"Game Changers"-Liste (von Scryfall selbst gepflegt). */
  gameChanger?: boolean;
  oracleText?: string;
}

export interface ScryfallSet {
  id: string;
  code: string;
  name: string;
  released_at?: string;
  set_type?: string;
}

const API = 'https://api.scryfall.com';

@Injectable({ providedIn: 'root' })
export class ScryfallService {
  private cachedSets: ScryfallSet[] | null = null;

  private buildHeaders(): HeadersInit {
    return {
      Accept: 'application/json',
      'User-Agent': 'MTG-App/1.0',
    };
  }

  /**
   * Fetch mit Wiederholung bei Fehlern - wichtig, weil Scryfalls Rate-Limit (429) im Browser als
   * generischer CORS-Fehler ankommt (die 429-Antwort hat selbst keine CORS-Header, der Browser
   * blockt sie also komplett und die fetch-Promise wird abgelehnt, ohne dass der Statuscode für
   * JS lesbar wäre). Ein einzelner Fehlschlag lässt sich also nicht sicher von einem "429, kurz
   * warten reicht" unterscheiden - deshalb bei JEDEM Fehler einfach abwarten und erneut versuchen,
   * mit wachsender Pause, statt sofort aufzugeben.
   */
  private async fetchWithRetry(url: string, retries = 2): Promise<Response | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { headers: this.buildHeaders() });
        if (res.ok || res.status === 404) return res;
      } catch {
        // Von Scryfall geblockte 429-Antworten kommen als Promise-Rejection an - abfangen und unten erneut versuchen.
      }
      if (attempt < retries) await sleep(3000 * (attempt + 1));
    }
    return null;
  }

  /** Liefert alle Sets (caching) */
  async allSets(): Promise<ScryfallSet[]> {
    if (this.cachedSets) return this.cachedSets;
    try {
      const res = await fetch(`${API}/sets`, {
        headers: this.buildHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      this.cachedSets = (data.data ?? []) as ScryfallSet[];
      return this.cachedSets;
    } catch {
      return [];
    }
  }

  // NEU
  /** Entfernt Apostrophe/Akzente, damit z.B. "Baldurs" auch "Baldur's" findet. */
  private normalizeForSearch(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Akzente entfernen (é -> e)
      .replace(/['’‘´`]/g, '');        // alle Apostroph-Varianten entfernen
  }

  // NEU
  /**
   * Set-Typen, die als echtes Draft-/Play-Booster-Display verkauft werden.
   * Schließt Token-, Promo-, Commander-Precon-, Duel-Deck- und Alchemy-Sets
   * (nur digital in Arena) automatisch aus.
   */
  private readonly DRAFTABLE_SET_TYPES = new Set(['core', 'expansion', 'draft_innovation', 'masters']);

  private isDraftable(set: ScryfallSet): boolean {
    return this.DRAFTABLE_SET_TYPES.has(set.set_type ?? '');
  }

  /** Suche Sets über die Scryfall-Sets-Liste. Name/Code und Jahr arbeiten unabhängig voneinander. */
  async searchSets(query: string, year?: number | null): Promise<ScryfallSet[]> {
    const normalizedQuery = this.normalizeForSearch(query.trim());
    const normalizedYear = year === null || year === undefined || Number.isNaN(Number(year)) ? null : Number(year);

    const sets = await this.allSets();
    let filtered = sets.filter((set) => this.isDraftable(set));

    if (normalizedQuery) {
      filtered = filtered.filter((set) => {
        const haystack = this.normalizeForSearch(`${set.name} ${set.code}`);
        return haystack.includes(normalizedQuery);
      });
    }

    if (normalizedYear !== null) {
      filtered = filtered.filter((set) => {
        if (!set.released_at) return false;
        return new Date(set.released_at).getFullYear() === normalizedYear;
      });
    }

    return filtered.slice(0, 30);
  }

  /** Liefert Sets nach Erscheinungsjahr */
  async setsByYear(year: number): Promise<ScryfallSet[]> {
    return this.searchSets('', year);
  }
  // NEU
  /**
   * Autovervollständigung für Kartennamen – liefert nur Karten, die laut Regel 903.3
   * als Commander erlaubt sind (legendäre Kreatur, Vehicle, Spacecraft mit P/T-Werten,
   * oder Karten mit "kann dein Commander sein"-Text). Scryfalls "is:commander"
   * bildet genau diese Regel ab, deshalb reicht ein einziger Suchoperator.
   * Findet englische Namen direkt; bei deutschen Eingaben wird zusätzlich
   * über die gedruckten deutschen Namen gesucht und der englische Name geliefert.
   */
  async autocomplete(query: string): Promise<string[]> {
    if (query.trim().length < 2) return [];
    try {
      const english = await this.searchCommanderNamesByName(query);
      if (english.length >= 5) return english;

      // Wenige/keine englischen Treffer: zusätzlich deutsche gedruckte Namen durchsuchen
      const german = await this.searchGermanPrintedNames(query);
      return [...new Set([...english, ...german])].slice(0, 12);
    } catch {
      return [];
    }
  }

  /** Sucht englische Kartennamen, die als Commander erlaubt sind (Regel 903.3). */
  private async searchCommanderNamesByName(query: string): Promise<string[]> {
    const safeQuery = query.trim().replace(/"/g, '');
    if (!safeQuery) return [];
    const q = encodeURIComponent(`is:commander name:"${safeQuery}"`);
    const res = await this.fetchWithRetry(`${API}/cards/search?q=${q}&unique=cards&order=name`);
    if (!res?.ok) return [];
    const data = await res.json();
    return ((data.data as { name: string }[]) ?? []).map((c) => c.name).slice(0, 12);
  }

  /**
   * Prüft, ob eine Karte existiert, und liefert Details (englischer Name).
   * Akzeptiert auch deutsche Kartennamen.
   */
  async findCard(name: string): Promise<ScryfallCard | null> {
    if (!name.trim()) return null;

    // Fuzzy-Suche matcht auch viele gedruckte fremdsprachige Namen
    const res = await this.fetchWithRetry(`${API}/cards/named?fuzzy=${encodeURIComponent(name)}`);
    if (res?.ok) {
      return this.toCard(await res.json());
    }

    // Fallback: exakte Suche über gedruckte Namen in beliebiger Sprache
    const q = encodeURIComponent(`lang:any !"${name}"`);
    const searchRes = await this.fetchWithRetry(`${API}/cards/search?q=${q}&unique=cards`);
    if (searchRes?.ok) {
      const data = await searchRes.json();
      if (data.data?.length > 0) {
        return this.toCard(data.data[0]);
      }
    }
    return null;
  }

  /**
   * Löst einen unsauberen Namens-Kandidaten (z.B. aus einem Excel-Kommentar-Bildtitel oder einem
   * Deckname wie "Sovereign Okinec Ahau +1/+1 Markendeck") zu einem eindeutigen, offiziellen
   * Commander-Namen auf. Schneidet dafür schrittweise Wörter vom Ende ab (der störende
   * Zusatztext steht meist hinter dem eigentlichen Namen) und sucht bei jeder Länge gezielt nach
   * Commander-fähigen Karten - auf Englisch, dann Deutsch (nacheinander statt parallel, siehe
   * fetchWithRetry). Sobald eine Länge Treffer liefert, wird abgebrochen (kürzer würde die Trefferzahl nur
   * noch vergrößern, nie eindeutiger machen). Bei mehreren Treffern wird der erste (alphabetisch)
   * als Best-Effort-Rateversuch genommen. Letzter Fallback: die normale Fuzzy-Suche, die auch
   * Tippfehler im Kernnamen selbst abdeckt.
   */
  async resolveCommanderCandidate(candidate: string): Promise<string | null> {
    const words = candidate.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;

    // Bewusst NACHEINANDER statt parallel, mit Pause zwischen jeder einzelnen Anfrage -
    // Scryfalls Rate-Limit (429) greift sonst schnell, wenn ein Name mehrere Kürzungs- und
    // Sprachversuche braucht (mehrere Anfragen in kurzer Zeit).
    for (let len = words.length; len >= 1; len--) {
      const attempt = words.slice(0, len).join(' ');

      const english = await this.searchCommanderNamesByName(attempt);
      if (english.length > 0) return english[0];
      await sleep(400);

      const german = await this.searchGermanPrintedNames(attempt);
      if (german.length > 0) return german[0];
      await sleep(400);
    }

    const fuzzy = await this.findCard(candidate);
    return fuzzy?.name ?? null;
  }

  // NEU
  /** Sucht deutsche gedruckte Namen (nur erlaubte Commander) und liefert die englischen Kartennamen zurück. */
  private async searchGermanPrintedNames(query: string): Promise<string[]> {
    const q = encodeURIComponent(`is:commander lang:de ${query}`);
    const res = await this.fetchWithRetry(`${API}/cards/search?q=${q}&unique=cards&order=name`);
    if (!res?.ok) return [];
    const data = await res.json();
    return ((data.data as { name: string }[]) ?? []).map((c) => c.name);
  }
  /**
   * Lädt Kartendaten (u.a. Bilder) für viele Kartennamen auf einmal, statt pro Karte eine
   * Anfrage zu schicken. Nutzt Scryfalls Collection-Endpoint (max. 75 Identifier pro Request).
   * Karten, die nicht exakt gefunden werden, fehlen einfach in der Ergebnis-Map (kein Fehler).
   */
  async findCardsBulk(names: string[]): Promise<Map<string, ScryfallCard>> {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const result = new Map<string, ScryfallCard>();

    // Scryfalls Collection-Endpoint matcht Doppelkarten (Transform/MDFC, z.B. "Westvale Abbey //
    // Ormendahl, Profane Prince") nur über den Namen der Vorderseite, nicht über den vollen
    // "A // B"-Namen, den Decklist-Exporte oft verwenden. Deshalb wird nur vor "//" gesucht,
    // das Ergebnis aber unter dem ursprünglichen (vollen) Namen abgelegt.
    const frontFaceName = (name: string) => name.split(' // ')[0].trim();
    const searchNameToOriginal = new Map<string, string>();
    for (const name of unique) {
      searchNameToOriginal.set(frontFaceName(name).toLowerCase(), name);
    }
    const searchNames = [...new Set(unique.map(frontFaceName))];

    for (let i = 0; i < searchNames.length; i += 75) {
      const chunk = searchNames.slice(i, i + 75);
      try {
        const res = await fetch(`${API}/cards/collection`, {
          method: 'POST',
          headers: { ...this.buildHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const card of (data.data as any[]) ?? []) {
          const original = searchNameToOriginal.get(frontFaceName(card.name as string).toLowerCase());
          const key = original?.toLowerCase() ?? (card.name as string).toLowerCase();
          result.set(key, this.toCard(card));
        }
      } catch {
        // Chunk übersprungen - betroffene Karten bleiben einfach ohne Bild.
      }
    }

    return result;
  }

  private toCard(data: any): ScryfallCard {
    return {
      name: data.name as string,
      imageUrl:
        data.image_uris?.normal ??
        data.card_faces?.[0]?.image_uris?.normal ??
        data.image_uris?.art_crop ??
        data.card_faces?.[0]?.image_uris?.art_crop,
      typeLine: data.type_line as string | undefined,
      cmc: data.cmc as number | undefined,
      manaCost: (data.mana_cost || data.card_faces?.[0]?.mana_cost) as string | undefined,
      colorIdentity: data.color_identity as string[] | undefined,
      gameChanger: data.game_changer as boolean | undefined,
      oracleText: (data.oracle_text || data.card_faces?.[0]?.oracle_text) as string | undefined,
    };
  }
}
