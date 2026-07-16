import { Injectable, inject } from '@angular/core';
import { supabase } from './supabase.client';
import { ScryfallService } from './scryfall.service';
import { isPlayerWinner } from './match-utils';

export interface Deck {
  id: string;
  userId: string;
  name: string;
  format: string | null;
  updatedAt: string;
  isPrecon: boolean;
}

export interface DeckGameStats {
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
      .select('id, user_id, name, format, updated_at, is_precon')
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
    }));
  }

  async loadDeckCards(deckId: string): Promise<DeckCard[]> {
    const { data, error } = await supabase
      .from('deck_cards')
      .select('card_name, quantity, image_url, type_line, cmc, is_commander')
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
    isPrecon = false
  ): Promise<boolean> {
    const parsed = this.parseDecklistText(rawText);
    if (parsed.length === 0) return false;

    const cardMap = await this.scryfall.findCardsBulk(parsed.map((p) => p.name));

    let deckId = existingDeckId;

    if (deckId) {
      const { data: oldRows, error: oldError } = await supabase
        .from('deck_cards')
        .select('card_name, quantity')
        .eq('deck_id', deckId);

      if (oldError) {
        console.error('Konnte bisherige Kartenliste nicht laden:', oldError);
        return false;
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
        return false;
      }

      const { error: updateError } = await supabase
        .from('decks')
        .update({ name, format, updated_at: new Date().toISOString() })
        .eq('id', deckId);
      if (updateError) {
        console.error('Konnte Deck nicht aktualisieren:', updateError);
        return false;
      }
    } else {
      const { data, error } = await supabase
        .from('decks')
        .insert({ user_id: userId, name, format, is_precon: isPrecon })
        .select('id')
        .single();

      if (error || !data) {
        console.error('Konnte Deck nicht anlegen:', error);
        return false;
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
      return false;
    }

    // Nur bei einem brandneuen Deck: alte, bislang nur namentlich getrackte Matches nachträglich
    // mit diesem Deck verknüpfen (siehe backfillDeckLinks für die genauen Regeln).
    if (!existingDeckId) {
      const commanderEntry = parsed.find((p) => p.isCommander);
      if (commanderEntry) {
        await this.backfillDeckLinks(deckId!, userId, commanderEntry.name);
      }
    }

    return true;
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

  async deleteDeck(deckId: string): Promise<void> {
    const { error } = await supabase.from('decks').delete().eq('id', deckId);
    if (error) {
      console.error('Konnte Deck nicht löschen:', error);
    }
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
}
