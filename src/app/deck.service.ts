import { Injectable, inject } from '@angular/core';
import { supabase } from './supabase.client';
import { ScryfallService, ScryfallCard } from './scryfall.service';
import { isPlayerWinner } from './match-utils';
import { sleep } from './array-utils';

export interface Deck {
  id: string;
  userId: string;
  name: string;
  format: string | null;
  updatedAt: string;
  isPrecon: boolean;
  /** EDHREC-Theme-Tag-Slug (z.B. "ramp", "aristocrats") - steuert die EDHREC-Vorschläge im Bearbeiten-Modus. */
  edhrecTag: string | null;
  /** Privat gestellte Decks tauchen nicht auf, wenn andere User dieses Profil ansehen - Standard ist sichtbar (opt-in privat, nicht opt-in sichtbar). */
  isPrivate: boolean;
}

export interface DeckGameStats {
  games: number;
  wins: number;
  winRate: number;
  /** Zuletzt in einem Match erfasster Commander dieses Decks, falls vorhanden (für das Kartenbild). */
  commander?: string;
}

export interface CommanderGameStats {
  commander: string;
  games: number;
  wins: number;
  winRate: number;
}

export interface DeckCard {
  cardName: string;
  quantity: number;
  imageUrl: string | null;
  typeLine: string | null;
  cmc: number;
  isCommander: boolean;
  /** Frei vergebene eigene Sortier-Tags (z.B. "Removal", "Wincon") - eine Karte kann mehrere haben. */
  customTags: string[];
}

export interface DeckChangeEntry {
  changedAt: string;
  cardName: string;
  changeType: 'added' | 'removed';
  quantity: number;
}

const SECTION_HEADER =
  /^(deck|decklist|main|mainboard|main deck|sideboard|maybeboard|commander|companion)\s*:?\s*$/i;
const QUANTITY_LINE = /^(\d+)\s*x?\s+(.+)$/i;
/** Set-Kürzel + Sammelnummer, wie sie z.B. deckstats.net anhängt: "Sol Ring (SOC) 128" -> "Sol Ring". */
const SET_AND_COLLECTOR_NUMBER_SUFFIX = /\s*\([A-Za-z0-9]{2,6}\)\s*[A-Za-z0-9★]*\s*$/;

@Injectable({ providedIn: 'root' })
export class DeckService {
  private readonly scryfall = inject(ScryfallService);

  async loadDecksForUser(userId: string): Promise<Deck[]> {
    const { data, error } = await supabase
      .from('decks')
      .select('id, user_id, name, format, updated_at, is_precon, edhrec_tag, is_private')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Konnte Decks nicht laden:', error);
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      format: row.format,
      updatedAt: row.updated_at,
      isPrecon: row.is_precon,
      edhrecTag: row.edhrec_tag,
      isPrivate: row.is_private ?? false,
    }));
  }

  async loadDeckCards(deckId: string): Promise<DeckCard[]> {
    const { data, error } = await supabase
      .from('deck_cards')
      .select('card_name, quantity, image_url, type_line, cmc, is_commander, custom_tags')
      .eq('deck_id', deckId)
      .order('card_name', { ascending: true });

    if (error) {
      console.error('Konnte Deck-Karten nicht laden:', error);
      return [];
    }

    return data.map((row) => ({
      cardName: row.card_name,
      quantity: row.quantity,
      imageUrl: row.image_url,
      typeLine: row.type_line,
      cmc: row.cmc ?? 0,
      isCommander: row.is_commander,
      customTags: row.custom_tags ?? [],
    }));
  }

  async loadChangeLog(deckId: string): Promise<DeckChangeEntry[]> {
    const { data, error } = await supabase
      .from('deck_change_log')
      .select('changed_at, card_name, change_type, quantity')
      .eq('deck_id', deckId)
      .order('changed_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Konnte Änderungsverlauf nicht laden:', error);
      return [];
    }

    return data.map((row) => ({
      changedAt: row.changed_at,
      cardName: row.card_name,
      changeType: row.change_type,
      quantity: row.quantity,
    }));
  }

  /**
   * Parst eine eingefügte Decklist (ein Eintrag pro Zeile, z.B. "1 Sol Ring" oder "1x Sol Ring").
   * Ignoriert Kommentarzeilen (//, #), merkt sich aber, ob eine Zeile unter einer
   * "Commander"-Überschrift steht (z.B. "//Commander" im deckstats.net-Export), um diese Karte(n)
   * separat markieren zu können. Mehrfach vorkommende Kartennamen werden zu einer Zeile mit
   * summierter Anzahl zusammengeführt.
   */
  parseDecklistText(text: string): { name: string; quantity: number; isCommander: boolean }[] {
    const merged = new Map<string, { name: string; quantity: number; isCommander: boolean }>();
    let inCommanderSection = false;

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const headerMatch = line.replace(/^\/\/\s*/, '').match(SECTION_HEADER);
      if (headerMatch || line.startsWith('//') || line.startsWith('#')) {
        if (headerMatch) inCommanderSection = headerMatch[1].toLowerCase() === 'commander';
        continue;
      }

      const match = line.match(QUANTITY_LINE);
      const rawName = (match ? match[2] : line).trim();
      const name = rawName.replace(SET_AND_COLLECTOR_NUMBER_SUFFIX, '').trim();
      const quantity = match ? parseInt(match[1], 10) : 1;
      if (!name) continue;

      const key = name.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.quantity += quantity;
        existing.isCommander = existing.isCommander || inCommanderSection;
      } else {
        merged.set(key, { name, quantity, isCommander: inCommanderSection });
      }
    }

    return [...merged.values()];
  }

  /**
   * Legt ein neues Deck an (existingDeckId = undefined) oder ersetzt die Kartenliste eines
   * bestehenden Decks. Beim Ersetzen wird die Differenz zur vorherigen Liste ins
   * Änderungsverlauf-Log geschrieben (was reingekommen/rausgegangen ist), bevor die alten
   * Karten-Zeilen gelöscht und durch die neuen ersetzt werden.
   */
  async saveDeck(
    userId: string,
    name: string,
    format: string | null,
    rawText: string,
    existingDeckId: string | null,
    isPrecon = false,
    edhrecTag: string | null = null
  ): Promise<string | null> {
    const parsed = this.parseDecklistText(rawText);
    if (parsed.length === 0) return null;

    const cardMap = await this.scryfall.findCardsBulk(parsed.map((p) => p.name));

    let deckId = existingDeckId;

    if (deckId) {
      const { data: oldRows, error: oldError } = await supabase
        .from('deck_cards')
        .select('card_name, quantity')
        .eq('deck_id', deckId);

      if (oldError) {
        console.error('Konnte bisherige Kartenliste nicht laden:', oldError);
        return null;
      }

      const oldByKey = new Map((oldRows ?? []).map((r) => [r.card_name.toLowerCase(), r]));
      const newByKey = new Map(parsed.map((p) => [p.name.toLowerCase(), p]));

      const changeRows: {
        deck_id: string;
        card_name: string;
        change_type: 'added' | 'removed';
        quantity: number;
      }[] = [];

      for (const [key, p] of newByKey) {
        const oldQty = oldByKey.get(key)?.quantity ?? 0;
        if (p.quantity > oldQty) {
          changeRows.push({
            deck_id: deckId,
            card_name: p.name,
            change_type: 'added',
            quantity: p.quantity - oldQty,
          });
        }
      }
      for (const [key, old] of oldByKey) {
        const newQty = newByKey.get(key)?.quantity ?? 0;
        if (newQty < old.quantity) {
          changeRows.push({
            deck_id: deckId,
            card_name: old.card_name,
            change_type: 'removed',
            quantity: old.quantity - newQty,
          });
        }
      }

      if (changeRows.length > 0) {
        const { error: logError } = await supabase.from('deck_change_log').insert(changeRows);
        if (logError) console.error('Konnte Änderungsverlauf nicht speichern:', logError);
      }

      const { error: deleteError } = await supabase.from('deck_cards').delete().eq('deck_id', deckId);
      if (deleteError) {
        console.error('Konnte alte Kartenliste nicht ersetzen:', deleteError);
        return null;
      }

      const { error: updateError } = await supabase
        .from('decks')
        .update({ name, format, edhrec_tag: edhrecTag, updated_at: new Date().toISOString() })
        .eq('id', deckId);
      if (updateError) {
        console.error('Konnte Deck nicht aktualisieren:', updateError);
        return null;
      }
    } else {
      const { data, error } = await supabase
        .from('decks')
        .insert({ user_id: userId, name, format, is_precon: isPrecon, edhrec_tag: edhrecTag })
        .select('id')
        .single();

      if (error || !data) {
        console.error('Konnte Deck nicht anlegen:', error);
        return null;
      }
      deckId = data.id;
    }

    const cardRows = parsed.map((p) => {
      const card = cardMap.get(p.name.toLowerCase());
      return {
        deck_id: deckId,
        card_name: p.name,
        quantity: p.quantity,
        image_url: card?.imageUrl ?? null,
        type_line: card?.typeLine ?? null,
        cmc: card?.cmc ?? 0,
        is_commander: p.isCommander,
      };
    });

    const { error: insertError } = await supabase.from('deck_cards').insert(cardRows);
    if (insertError) {
      console.error('Konnte Kartenliste nicht speichern:', insertError);
      return null;
    }

    // Nur bei einem brandneuen Deck: alte, bislang nur namentlich getrackte Matches nachträglich
    // mit diesem Deck verknüpfen (siehe backfillDeckLinks für die genauen Regeln).
    if (!existingDeckId) {
      const commanderEntry = parsed.find((p) => p.isCommander);
      if (commanderEntry) {
        await this.backfillDeckLinks(deckId!, userId, commanderEntry.name);
      }
    }

    return deckId;
  }

  /**
   * Verknüpft nachträglich alte Matches mit einem neu angelegten Deck: nur Matches, in denen
   * GENAU DIESER Deck-Besitzer (über alle seine Spieler-Einträge in allen Gruppen hinweg) den
   * gleichnamigen Commander gespielt hat, und die noch keinem Deck zugeordnet sind. Absichtlich
   * NICHT namensbasiert über alle Spieler hinweg, damit ein geliehener Commander in einem alten
   * Match eines anderen Spielers nicht fälschlich diesem Deck zugeschlagen wird.
   */
  private async backfillDeckLinks(deckId: string, userId: string, commanderName: string): Promise<void> {
    const { data: playerRows, error: playerError } = await supabase
      .from('players')
      .select('id')
      .eq('user_id', userId);

    if (playerError || !playerRows || playerRows.length === 0) return;

    const { error } = await supabase
      .from('match_players')
      .update({ deck_id: deckId })
      .in(
        'player_id',
        playerRows.map((p) => p.id)
      )
      .is('deck_id', null)
      .ilike('commander_name', commanderName);

    if (error) {
      console.error('Konnte alte Matches nicht nachträglich verknüpfen:', error);
    }
  }

  /**
   * Umgekehrte Richtung zu backfillDeckLinks: findet ein bereits vorhandenes Deck dieses Users mit
   * passendem (Haupt-)Commander - fürs automatische Verknüpfen, wenn ein NEUES Match (live erstellt
   * oder importiert) angelegt wird, ohne dass der Nutzer explizit ein Deck ausgewählt hat.
   */
  async findDeckIdByCommander(userId: string, commanderName: string): Promise<string | null> {
    const { data: deckRows, error: deckError } = await supabase
      .from('decks')
      .select('id')
      .eq('user_id', userId);

    if (deckError || !deckRows || deckRows.length === 0) return null;

    const { data, error } = await supabase
      .from('deck_cards')
      .select('deck_id')
      .eq('is_commander', true)
      .ilike('card_name', commanderName)
      .in(
        'deck_id',
        deckRows.map((d) => d.id)
      )
      .limit(1);

    if (error || !data || data.length === 0) return null;
    return data[0].deck_id;
  }

  /**
   * Reparatur-Werkzeug für Alt-Daten: geht alle noch unverknüpften Commander-Namen dieses Users
   * (über alle seine Spieler-Einträge/Gruppen hinweg) durch, löst sie mit der aktuellen (besseren)
   * Scryfall-Erkennung neu auf, korrigiert falsch gespeicherte Namen in der DB und verknüpft sie
   * danach - wo möglich - automatisch mit passenden eigenen Decks. Nötig, weil ein Match nach dem
   * Speichern nicht rückwirkend von Verbesserungen an der Namens-Erkennung profitiert.
   */
  async repairCommanderNames(
    userId: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ checked: number; fixed: number; linked: number }> {
    const { data: playerRows } = await supabase.from('players').select('id').eq('user_id', userId);
    if (!playerRows || playerRows.length === 0) return { checked: 0, fixed: 0, linked: 0 };
    const playerIds = playerRows.map((p) => p.id);

    const { data: rows } = await supabase
      .from('match_players')
      .select('commander_name, partner_commander_name')
      .in('player_id', playerIds)
      .is('deck_id', null);

    if (!rows) return { checked: 0, fixed: 0, linked: 0 };

    const uniqueNames = new Set<string>();
    for (const r of rows) {
      if (r.commander_name) uniqueNames.add(r.commander_name);
      if (r.partner_commander_name) uniqueNames.add(r.partner_commander_name);
    }

    const list = [...uniqueNames];
    const resolvedNames = new Map<string, string>(); // alter Name -> korrigierter Name
    let done = 0;

    for (const name of list) {
      const resolved = await this.scryfall.resolveCommanderCandidate(name);
      if (resolved && resolved !== name) resolvedNames.set(name, resolved);
      done++;
      onProgress?.(done, list.length);
      await sleep(400); // Scryfalls Rate-Limit respektieren, sonst schlagen die Anfragen mit 429 fehl.
    }

    let fixed = 0;
    for (const [oldName, newName] of resolvedNames) {
      const { error: commanderError } = await supabase
        .from('match_players')
        .update({ commander_name: newName })
        .in('player_id', playerIds)
        .eq('commander_name', oldName);
      if (!commanderError) fixed++;

      await supabase
        .from('match_players')
        .update({ partner_commander_name: newName })
        .in('player_id', playerIds)
        .eq('partner_commander_name', oldName);
    }

    // Jetzt (ggf. korrigierte) Namen mit vorhandenen eigenen Decks abgleichen.
    const finalNames = new Set(list.map((n) => resolvedNames.get(n) ?? n));
    let linked = 0;
    for (const name of finalNames) {
      const deckId = await this.findDeckIdByCommander(userId, name);
      if (!deckId) continue;

      const { error: linkError } = await supabase
        .from('match_players')
        .update({ deck_id: deckId })
        .in('player_id', playerIds)
        .is('deck_id', null)
        .ilike('commander_name', name);
      if (!linkError) linked++;
    }

    return { checked: list.length, fixed, linked };
  }

  /**
   * Wie repairCommanderNames(), aber für die GANZE Gruppe statt nur den eigenen Account - für den
   * Host gedacht. Löst z.B. den Fall, dass ein Excel-Import einen Commander unaufgelöst auf
   * Deutsch stehen ließ, während eine später live getrackte Partie denselben Commander (korrekt
   * aufgelöst) auf Englisch speichert - beide würden sonst als zwei verschiedene Commander in der
   * Statistik auftauchen. Verknüpft bewusst NICHT automatisch mit Decks (das bleibt Sache von
   * repairCommanderNames() pro Account, da nur der jeweilige Besitzer seine eigenen Decks kennt).
   */
  async repairCommanderNamesForGroup(
    groupId: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ checked: number; fixed: number }> {
    const { data: playerRows } = await supabase.from('players').select('id').eq('group_id', groupId);
    if (!playerRows || playerRows.length === 0) return { checked: 0, fixed: 0 };
    const playerIds = playerRows.map((p) => p.id);

    const { data: rows } = await supabase
      .from('match_players')
      .select('commander_name, partner_commander_name')
      .in('player_id', playerIds);

    if (!rows) return { checked: 0, fixed: 0 };

    const uniqueNames = new Set<string>();
    for (const r of rows) {
      if (r.commander_name) uniqueNames.add(r.commander_name);
      if (r.partner_commander_name) uniqueNames.add(r.partner_commander_name);
    }

    const list = [...uniqueNames];
    const resolvedNames = new Map<string, string>(); // alter Name -> korrigierter Name
    let done = 0;

    for (const name of list) {
      const resolved = await this.scryfall.resolveCommanderCandidate(name);
      if (resolved && resolved !== name) resolvedNames.set(name, resolved);
      done++;
      onProgress?.(done, list.length);
      await sleep(400); // Scryfalls Rate-Limit respektieren, sonst schlagen die Anfragen mit 429 fehl.
    }

    let fixed = 0;
    for (const [oldName, newName] of resolvedNames) {
      const { error: commanderError } = await supabase
        .from('match_players')
        .update({ commander_name: newName })
        .in('player_id', playerIds)
        .eq('commander_name', oldName);
      if (!commanderError) fixed++;

      await supabase
        .from('match_players')
        .update({ partner_commander_name: newName })
        .in('player_id', playerIds)
        .eq('partner_commander_name', oldName);
    }

    return { checked: list.length, fixed };
  }

  async deleteDeck(deckId: string): Promise<void> {
    const { error } = await supabase.from('decks').delete().eq('id', deckId);
    if (error) {
      console.error('Konnte Deck nicht löschen:', error);
    }
  }

  /**
   * Fügt eine einzelne Karte hinzu (Bearbeitungsmodus in der Deck-Detailansicht). Erhöht die
   * Anzahl, falls die Karte schon drin ist, statt eine zweite Zeile anzulegen. `card` kommt direkt
   * aus der Scryfall-Suche der Add-Karten-UI, damit kein zusätzlicher Lookup nötig ist.
   */
  async addCardToDeck(deckId: string, card: ScryfallCard, quantity = 1): Promise<boolean> {
    const { data: existing, error: lookupError } = await supabase
      .from('deck_cards')
      .select('id, quantity')
      .eq('deck_id', deckId)
      .ilike('card_name', card.name)
      .maybeSingle();

    if (lookupError) {
      console.error('Konnte Deck-Karte nicht nachschlagen:', lookupError);
      return false;
    }

    if (existing) {
      const { error } = await supabase
        .from('deck_cards')
        .update({ quantity: existing.quantity + quantity })
        .eq('id', existing.id);
      if (error) {
        console.error('Konnte Kartenanzahl nicht erhöhen:', error);
        return false;
      }
    } else {
      const { error } = await supabase.from('deck_cards').insert({
        deck_id: deckId,
        card_name: card.name,
        quantity,
        image_url: card.imageUrl ?? null,
        type_line: card.typeLine ?? null,
        cmc: card.cmc ?? 0,
        is_commander: false,
      });
      if (error) {
        console.error('Konnte Karte nicht hinzufügen:', error);
        return false;
      }
    }

    await supabase.from('deck_change_log').insert({
      deck_id: deckId,
      card_name: card.name,
      change_type: 'added',
      quantity,
    });
    await supabase.from('decks').update({ updated_at: new Date().toISOString() }).eq('id', deckId);
    return true;
  }

  /** Entfernt eine bestimmte Anzahl Kopien einer Karte (Standard: alle) aus dem Deck. */
  async removeCardFromDeck(deckId: string, cardName: string, quantity?: number): Promise<boolean> {
    const { data: existing, error: lookupError } = await supabase
      .from('deck_cards')
      .select('id, quantity')
      .eq('deck_id', deckId)
      .ilike('card_name', cardName)
      .maybeSingle();

    if (lookupError || !existing) {
      if (lookupError) console.error('Konnte Deck-Karte nicht nachschlagen:', lookupError);
      return false;
    }

    const removeQty = Math.min(quantity ?? existing.quantity, existing.quantity);
    const remaining = existing.quantity - removeQty;

    if (remaining > 0) {
      const { error } = await supabase.from('deck_cards').update({ quantity: remaining }).eq('id', existing.id);
      if (error) {
        console.error('Konnte Kartenanzahl nicht verringern:', error);
        return false;
      }
    } else {
      const { error } = await supabase.from('deck_cards').delete().eq('id', existing.id);
      if (error) {
        console.error('Konnte Karte nicht entfernen:', error);
        return false;
      }
    }

    await supabase.from('deck_change_log').insert({
      deck_id: deckId,
      card_name: cardName,
      change_type: 'removed',
      quantity: removeQty,
    });
    await supabase.from('decks').update({ updated_at: new Date().toISOString() }).eq('id', deckId);
    return true;
  }

  /** Ändert nur Name und EDHREC-Tag eines bestehenden Decks, ohne die Kartenliste anzufassen. */
  async updateDeckInfo(deckId: string, name: string, edhrecTag: string | null): Promise<boolean> {
    const { error } = await supabase
      .from('decks')
      .update({ name, edhrec_tag: edhrecTag, updated_at: new Date().toISOString() })
      .eq('id', deckId);

    if (error) {
      console.error('Konnte Deckname/Tag nicht ändern:', error);
      return false;
    }
    return true;
  }

  /** Stellt ein Deck privat/sichtbar - private Decks tauchen nicht mehr auf, wenn andere User dieses Profil ansehen. */
  async setDeckPrivate(deckId: string, isPrivate: boolean): Promise<boolean> {
    const { error } = await supabase.from('decks').update({ is_private: isPrivate }).eq('id', deckId);

    if (error) {
      console.error('Konnte Sichtbarkeit nicht ändern:', error);
      return false;
    }
    return true;
  }

  /** Markiert/entmarkiert eine bereits im Deck vorhandene Karte als Commander (z.B. wenn der Import keinen erkannt hat). */
  async setCardCommanderFlag(deckId: string, cardName: string, isCommander: boolean): Promise<boolean> {
    const { error } = await supabase
      .from('deck_cards')
      .update({ is_commander: isCommander })
      .eq('deck_id', deckId)
      .ilike('card_name', cardName);

    if (error) {
      console.error('Konnte Commander-Markierung nicht ändern:', error);
      return false;
    }
    return true;
  }

  /** Ersetzt nur das Bild einer Karte (anderes Artwork/Edition) - Name/Menge/Commander-Status bleiben unverändert. */
  async updateCardImage(deckId: string, cardName: string, imageUrl: string): Promise<boolean> {
    const { error } = await supabase
      .from('deck_cards')
      .update({ image_url: imageUrl })
      .eq('deck_id', deckId)
      .ilike('card_name', cardName);

    if (error) {
      console.error('Konnte Kartenbild nicht ändern:', error);
      return false;
    }
    return true;
  }

  /** Setzt die eigenen Sortier-Tags einer Karte komplett neu (ersetzt die bisherige Liste). */
  async setCardTags(deckId: string, cardName: string, tags: string[]): Promise<boolean> {
    const { error } = await supabase
      .from('deck_cards')
      .update({ custom_tags: tags })
      .eq('deck_id', deckId)
      .ilike('card_name', cardName);

    if (error) {
      console.error('Konnte Tags nicht ändern:', error);
      return false;
    }
    return true;
  }

  /** Lädt ein eigenes Bild in den "deck-art"-Storage-Bucket hoch und liefert die öffentliche URL - für ein selbst gewähltes Artwork statt einer Scryfall-Edition. */
  async uploadCustomCardArt(userId: string, file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) return null;
    if (file.size > 10 * 1024 * 1024) return null;

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from('deck-art')
      .upload(path, file, { contentType: file.type });

    if (error) {
      console.error('Konnte eigenes Kartenbild nicht hochladen:', error);
      return null;
    }

    const { data } = supabase.storage.from('deck-art').getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * Gesamt-Statistik für ein Deck über ALLE Gruppen hinweg (nicht nur die aktuell aktive) und
   * unabhängig davon, wer es jeweils gespielt hat (eigener Pilot oder ausgeliehen) - im
   * Gegensatz zu den gruppen-gebundenen Stats im Stats-Tab, die nur die aktive Gruppe sehen.
   */
  async getDeckStats(deckId: string): Promise<DeckGameStats> {
    const { data, error } = await supabase
      .from('match_players')
      .select('team, is_archenemy, players ( display_name ), matches ( game_mode, winner_name )')
      .eq('deck_id', deckId);

    if (error || !data) {
      console.error('Konnte Deck-Statistik nicht laden:', error);
      return { games: 0, wins: 0, winRate: 0 };
    }

    let wins = 0;
    for (const row of data as any[]) {
      const match = row.matches;
      const playerName = row.players?.display_name;
      if (!match || !playerName) continue;
      if (isPlayerWinner(match.game_mode, match.winner_name, playerName, row.team, row.is_archenemy)) {
        wins++;
      }
    }

    const games = data.length;
    return { games, wins, winRate: games > 0 ? (wins / games) * 100 : 0 };
  }

  /**
   * Wie getDeckStats(), aber für mehrere Decks auf einmal (eine Anfrage statt einer pro Deck) -
   * für Listen, die z.B. nach Winrate/Spielanzahl sortiert werden sollen.
   */
  async getDeckStatsForDecks(deckIds: string[]): Promise<Map<string, DeckGameStats>> {
    const result = new Map<string, DeckGameStats>();
    if (deckIds.length === 0) return result;

    const { data, error } = await supabase
      .from('match_players')
      .select(
        'deck_id, commander_name, team, is_archenemy, players ( display_name ), matches ( game_mode, winner_name )'
      )
      .in('deck_id', deckIds);

    if (error || !data) {
      console.error('Konnte Deck-Statistiken nicht laden:', error);
      return result;
    }

    const raw = new Map<string, { games: number; wins: number; commander?: string }>();
    for (const row of data as any[]) {
      const deckId = row.deck_id as string | null;
      const match = row.matches;
      const playerName = row.players?.display_name;
      if (!deckId || !match || !playerName) continue;

      const entry = raw.get(deckId) ?? { games: 0, wins: 0 };
      entry.games++;
      if (row.commander_name) entry.commander = row.commander_name;
      if (isPlayerWinner(match.game_mode, match.winner_name, playerName, row.team, row.is_archenemy)) {
        entry.wins++;
      }
      raw.set(deckId, entry);
    }

    for (const [deckId, s] of raw) {
      result.set(deckId, {
        games: s.games,
        wins: s.wins,
        winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
        commander: s.commander,
      });
    }
    return result;
  }

  /**
   * Der im Deck selbst hinterlegte Commander (deck_cards.is_commander) je Deck-ID - als Fallback
   * für die Deckliste, wenn getDeckStatsForDecks() keinen Commander liefert (noch keine Partie
   * gespielt, z.B. bei einem frisch angelegten leeren Deck). Bei Partner-Commandern wird nur
   * einer davon zurückgegeben, wie auch sonst in der App für Karten-Thumbnails üblich. Liefert
   * auch das dort hinterlegte Bild mit (statt nur den Namen), damit ein individuell gewähltes
   * Artwork (siehe deck-viewer.service.ts selectArtwork) auch im Deckliste-Vorschaubild ankommt,
   * statt dass dort immer nur das generische Scryfall-Standardbild zum Namen gezeigt wird.
   */
  async getStoredCommanders(deckIds: string[]): Promise<Map<string, { name: string; imageUrl: string | null }>> {
    const result = new Map<string, { name: string; imageUrl: string | null }>();
    if (deckIds.length === 0) return result;

    const { data, error } = await supabase
      .from('deck_cards')
      .select('deck_id, card_name, image_url')
      .eq('is_commander', true)
      .in('deck_id', deckIds);

    if (error || !data) {
      console.error('Konnte hinterlegte Commander nicht laden:', error);
      return result;
    }

    for (const row of data) {
      if (!result.has(row.deck_id)) result.set(row.deck_id, { name: row.card_name, imageUrl: row.image_url });
    }
    return result;
  }

  /**
   * Commander-Statistik über ALLE Gruppen hinweg für Matches OHNE Deck-Zuordnung (z.B. alte
   * Excel-Importe oder live getrackte Spiele, bei denen kein eigenes Deck ausgewählt wurde) -
   * ergänzt getDeckStats() im Profil, wo sonst nur deck-gebundene Spiele auftauchen würden.
   */
  async getUnassignedCommanderStats(userId: string): Promise<CommanderGameStats[]> {
    const { data: playerRows } = await supabase.from('players').select('id').eq('user_id', userId);
    if (!playerRows || playerRows.length === 0) return [];
    const playerIds = playerRows.map((p) => p.id);

    const { data, error } = await supabase
      .from('match_players')
      .select('commander_name, team, is_archenemy, players ( display_name ), matches ( game_mode, winner_name )')
      .in('player_id', playerIds)
      .is('deck_id', null)
      .not('commander_name', 'is', null);

    if (error || !data) {
      console.error('Konnte Commander-Statistik nicht laden:', error);
      return [];
    }

    const stats = new Map<string, { games: number; wins: number }>();
    for (const row of data as any[]) {
      const match = row.matches;
      const playerName = row.players?.display_name;
      const commander = row.commander_name as string | null;
      if (!match || !playerName || !commander) continue;

      const entry = stats.get(commander) ?? { games: 0, wins: 0 };
      entry.games++;
      if (isPlayerWinner(match.game_mode, match.winner_name, playerName, row.team, row.is_archenemy)) {
        entry.wins++;
      }
      stats.set(commander, entry);
    }

    return [...stats.entries()]
      .map(([commander, s]) => ({
        commander,
        games: s.games,
        wins: s.wins,
        winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
  }

  /**
   * Verlinkt manuell alle noch unverlinkten Matches eines Commanders (nur eigene Spieler-Einträge)
   * mit einem konkreten Deck - für Fälle, wo die automatische Erkennung (findDeckIdByCommander)
   * nichts findet oder der falsche Commander-Name erkannt wurde.
   */
  async linkCommanderToDeck(userId: string, commander: string, deckId: string): Promise<boolean> {
    const { data: playerRows } = await supabase.from('players').select('id').eq('user_id', userId);
    if (!playerRows || playerRows.length === 0) return false;
    const playerIds = playerRows.map((p) => p.id);

    const { error } = await supabase
      .from('match_players')
      .update({ deck_id: deckId })
      .in('player_id', playerIds)
      .eq('commander_name', commander)
      .is('deck_id', null);

    if (error) {
      console.error('Konnte Commander nicht mit Deck verlinken:', error);
      return false;
    }
    return true;
  }

  /**
   * Löst die Deck-Verknüpfung aller Matches eines Decks (nur eigene Spieler-Einträge) wieder -
   * z.B. falls eine automatische oder manuelle Verlinkung ein falsches Deck getroffen hat. Die
   * Matches landen danach wieder unter "Commander ohne Deck".
   */
  async unlinkDeckMatches(userId: string, deckId: string): Promise<boolean> {
    const { data: playerRows } = await supabase.from('players').select('id').eq('user_id', userId);
    if (!playerRows || playerRows.length === 0) return false;
    const playerIds = playerRows.map((p) => p.id);

    const { error } = await supabase
      .from('match_players')
      .update({ deck_id: null })
      .in('player_id', playerIds)
      .eq('deck_id', deckId);

    if (error) {
      console.error('Konnte Deck nicht entlinken:', error);
      return false;
    }
    return true;
  }
}
