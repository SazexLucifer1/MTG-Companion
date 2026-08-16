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

  /** Gemeinsame Fetch-/Fehlerbehandlung für die commanders-JSON-Endpunkte - liefert das rohe JSON oder null. */
  private async fetchCommanderPage(path: string): Promise<any | null> {
    try {
      const res = await fetch(`https://json.edhrec.com/pages/commanders/${path}.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
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
    }
    return null;
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
}
