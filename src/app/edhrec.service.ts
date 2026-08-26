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

export interface EdhrecTag {
  slug: string;
  value: string;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class EdhrecService {
  /**
   * EDHRECs eigene Slug-Regel fuer Commander-URLs (kein offizieller Standard, aus mehreren echten
   * Beispielen abgeleitet: Kommas/Apostrophe/Punkte weg, alles andere zu Bindestrichen).
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // Akzente entfernen
      .replace(/['’,.]/g, '') // Apostroph-Varianten und Satzzeichen entfernen
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Baut die Pfad-Kandidaten fuer 1 oder 2 Commander. Bei einem Paar (Partner, "Choose a
   * Background" + Background, Doctor's companion + Time Lord Doctor) kombiniert EDHREC beide
   * Slugs zu einer eigenen Seite (z.B. "thrasios-triton-hero-tymna-the-weaver") - welche
   * Reihenfolge EDHREC dabei erwartet ist nicht offiziell dokumentiert, deshalb werden beide
   * Reihenfolgen als Kandidaten zurückgegeben; der Aufrufer probiert sie der Reihe nach durch.
   */
  private buildCommanderSlugCandidates(commanderNames: string[]): string[] {
    const slugs = commanderNames.map((n) => this.slugify(n)).filter((s) => s.length > 0);
    if (slugs.length < 2) return slugs;
    return [`${slugs[0]}-${slugs[1]}`, `${slugs[1]}-${slugs[0]}`];
  }

  // NEU - dauerhafter Cache mit 24h-TTL (anders als Scryfalls Tag-Cache, siehe ScryfallService,
  // ändern sich EDHRECs Empfehlungen mit der Zeit - deshalb TTL statt für immer). Hält die
  // Zusage aus der Erlaubnis-Anfrage an EDHREC ein ("cache all responses for 24 hours") und
  // reduziert die Anfragelast deutlich, da dieselbe Commander-Seite bei jedem Deck-Öffnen bzw.
  // jeder Tag-Auswahl sonst immer wieder frisch abgefragt würde.
  private static readonly CACHE_KEY = 'mtg-companion-edhrec-cache-v1';
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  private cache: Record<string, { data: any; cachedAt: number }> | null = null;

  private getCache(): Record<string, { data: any; cachedAt: number }> {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(localStorage.getItem(EdhrecService.CACHE_KEY) ?? '{}');
      } catch {
        this.cache = {};
      }
    }
    return this.cache!;
  }

  private saveCache(): void {
    try {
      localStorage.setItem(EdhrecService.CACHE_KEY, JSON.stringify(this.cache ?? {}));
    } catch {
      // z.B. Speicher voll oder privater Modus - Cache bleibt dann nur für diese Sitzung im Speicher, kein Beinbruch.
    }
  }

  /** Gemeinsame Fetch-/Fehlerbehandlung für EDHRECs Seiten-JSON-Endpunkte ("commanders/…", "themes/…", …) - liefert das rohe JSON oder null. */
  private async fetchPage(prefix: string, path: string): Promise<any | null> {
    const cacheKey = `${prefix}/${path}`;
    const cache = this.getCache();
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.cachedAt < EdhrecService.CACHE_TTL_MS) {
      return cached.data;
    }
    try {
      const res = await fetch(`https://json.edhrec.com/pages/${prefix}/${path}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      cache[cacheKey] = { data, cachedAt: Date.now() };
      this.saveCache();
      return data;
    } catch {
      return null;
    }
  }

  private async fetchCommanderPage(path: string): Promise<any | null> {
    return this.fetchPage('commanders', path);
  }

  private static mapCardlists(raw: any[]): EdhrecCardlist[] {
    return raw.map((list: any) => ({
      tag: list.tag,
      header: list.header,
      cards: ((list.cardviews ?? []) as any[]).map((c) => ({
        name: c.name,
        synergy: c.synergy ?? 0,
        numDecks: c.num_decks ?? 0,
        potentialDecks: c.potential_decks ?? 0,
      })),
    }));
  }

  /**
   * Slug-Namen für Farbkombinationen, wie EDHREC sie für seine eigenen "Top X Commanders"-Seiten
   * verwendet (z.B. edhrec.com/commanders/rakdos, edhrec.com/commanders/sultai) - Community-
   * übliche Gilden-/Keil-/Verbund-Namen, keine offizielle Konvention. Keys sind WUBRG-Buchstaben
   * in fester Reihenfolge (W vor U vor B vor R vor G), damit die Auswahl unabhängig von der
   * Klick-Reihenfolge der Farb-Chips im UI immer denselben Schlüssel ergibt.
   */
  private static readonly COLOR_COMBO_SLUGS: Record<string, string> = {
    '': 'colorless',
    W: 'mono-white',
    U: 'mono-blue',
    B: 'mono-black',
    R: 'mono-red',
    G: 'mono-green',
    WU: 'azorius',
    UB: 'dimir',
    BR: 'rakdos',
    RG: 'gruul',
    GW: 'selesnya',
    WB: 'orzhov',
    UR: 'izzet',
    BG: 'golgari',
    RW: 'boros',
    GU: 'simic',
    WUB: 'esper',
    UBR: 'grixis',
    BRG: 'jund',
    RGW: 'naya',
    GWU: 'bant',
    WBG: 'abzan',
    URW: 'jeskai',
    BGU: 'sultai',
    RWB: 'mardu',
    GUR: 'temur',
    WUBR: 'yore-tiller',
    UBRG: 'glint-eye',
    BRGW: 'dune-brood',
    RGWU: 'ink-treader',
    GWUB: 'witch-maw',
    WUBRG: 'five-color',
  };

  /** Ordnet eine beliebige Farbauswahl (z.B. ['R','U']) auf EDHRECs Slug für diese Kombination - unabhängig von der Reihenfolge der übergebenen Farben. */
  colorComboSlug(colors: string[]): string | null {
    const key = 'WUBRG'
      .split('')
      .filter((c) => colors.includes(c))
      .join('');
    return EdhrecService.COLOR_COMBO_SLUGS[key] ?? null;
  }

  /**
   * Laedt EDHRECs Kartenempfehlungen fuer einen Commander oder ein Commander-Paar (optional
   * kombiniert mit einem Theme-Tag, z.B. "ramp" oder "aristocrats" - dieselben Tags, die EDHREC
   * auf der Commander-Seite selbst als anklickbare Links zeigt) direkt vom selben JSON, das ihre
   * eigene Webseite nutzt (kein offizieller API-Key noetig, CORS ist offen) -
   * inoffiziell/undokumentiert, kann sich also theoretisch ohne Vorwarnung aendern.
   */
  async getCommanderRecommendations(
    commanderNames: string[],
    tagSlug?: string | null
  ): Promise<EdhrecCardlist[] | null> {
    for (const slug of this.buildCommanderSlugCandidates(commanderNames)) {
      const path = tagSlug ? `${slug}/${tagSlug}` : slug;
      const data = await this.fetchCommanderPage(path);
      const cardlists = data?.container?.json_dict?.cardlists;
      if (!Array.isArray(cardlists)) continue;

      return EdhrecService.mapCardlists(cardlists);
    }
    return null;
  }

  /**
   * Liefert die "Top Commanders"-Übersicht für eine Farbkombination (z.B. Rakdos, Sultai,
   * Mono-Rot, Fünffarbig), optional zusätzlich auf einen Archetyp-Tag eingeschränkt (z.B. Rakdos +
   * "sacrifice") - dieselbe Seite/Struktur wie eine einzelne Commander-Empfehlungsseite (EDHREC
   * rendert Gilden-/Keil-Übersichten mit demselben Vorlagensystem, inkl. Tag-Filterung über
   * ".../{tag}.json"), deshalb Wiederverwendung von getCommanderRecommendations() mit dem Farb-Slug
   * als Pseudo-Commander-Namen - liegt bereits vor dieser Session im Deck-Baukasten produktiv im
   * Einsatz (Commander + Tag kombiniert), verifiziert live per Farbkombination in dieser Session.
   */
  async getTopCommandersForColors(colors: string[], tagSlug?: string | null): Promise<EdhrecCardlist[] | null> {
    const slug = this.colorComboSlug(colors);
    if (!slug) return null;
    return this.getCommanderRecommendations([slug], tagSlug);
  }

  /** Liefert die auf EDHREC verfügbaren Theme-Tags für einen Commander/ein Commander-Paar (z.B. Ramp, Aristocrats, Stax, ...), sortiert nach Häufigkeit. */
  async getCommanderTags(commanderNames: string[]): Promise<EdhrecTag[] | null> {
    for (const slug of this.buildCommanderSlugCandidates(commanderNames)) {
      const data = await this.fetchCommanderPage(slug);
      const taglinks = data?.panels?.taglinks;
      if (!Array.isArray(taglinks)) continue;

      return taglinks.map((t: any) => ({
        slug: t.slug,
        value: t.value,
        count: t.count ?? 0,
      }));
    }
    return null;
  }

  /**
   * Liefert EDHRECs vollständige Archetyp-Liste ("Alle Archetypen", unabhängig von jeder
   * Farbauswahl) - echte, per Websuche bestätigte Seite: edhrec.com/tags/themes ("All Tags |
   * EDHREC"). Anders als bei früheren Versuchen (PR #108s "themes/"-Präfix) ist der bestätigte
   * Pfad-Präfix "tags/" - siehe z.B. edhrec.com/tags/sacrifice, /tags/aristocrats, /tags/voltron.
   */
  async getAllTags(): Promise<EdhrecTag[] | null> {
    const data = await this.fetchPage('tags', 'themes');
    const cardlists = data?.container?.json_dict?.cardlists;
    if (!Array.isArray(cardlists)) return null;
    const cards = cardlists.flatMap((list: any) => (list.cardviews ?? []) as any[]);
    if (cards.length === 0) return null;
    return cards
      .filter((c: any) => c.name && (c.slug || c.urlhash))
      .map((c: any) => ({ slug: c.slug ?? c.urlhash, value: c.name, count: c.num_decks ?? 0 }));
  }

  /**
   * Liefert die "Top Commanders"-Übersicht für einen Archetyp/Tag (z.B. "sacrifice", "voltron"),
   * optional zusätzlich auf eine Farbkombination eingeschränkt - komplett unabhängig von einer
   * Farbauswahl nutzbar (echte Seite: edhrec.com/tags/{tag}, bestätigt per Websuche existierend).
   */
  async getTopCommandersForTag(tagSlug: string, colors?: string[]): Promise<EdhrecCardlist[] | null> {
    const colorSlug = colors && colors.length > 0 ? this.colorComboSlug(colors) : null;
    const path = colorSlug ? `${tagSlug}/${colorSlug}` : tagSlug;
    const data = await this.fetchPage('tags', path);
    const cardlists = data?.container?.json_dict?.cardlists;
    if (!Array.isArray(cardlists)) return null;
    return EdhrecService.mapCardlists(cardlists);
  }
}
