import { Injectable, computed, effect, signal, inject } from '@angular/core';
import { Match, MatchPlayer, Cube, GameMode, GAME_MODES } from './models';
import { supabase } from './supabase.client';
import { GroupService } from './group.service';
import { AuthService } from './auth.service';
import { DeckService } from './deck.service';

const GEMINI_KEY = 'mtg_gemini_key';

@Injectable({ providedIn: 'root' })
export class MtgService {
  private readonly groupService = inject(GroupService);
  private readonly auth = inject(AuthService);
  private readonly deckService = inject(DeckService);

  readonly allPlayers = signal<string[]>([]);
  private readonly playerIdsByName = signal<Record<string, string>>({});
  /** Spielername -> verknüpfte Account-User-ID (null = noch kein Account zugeordnet). */
  readonly playerUserIds = signal<Record<string, string | null>>({});
  /** Spielername -> Profilbild-URL des verknüpften Accounts (null = kein Account/kein Bild). */
  readonly playerAvatars = signal<Record<string, string | null>>({});
  // ... der Rest bleibt unverändert
  readonly history = signal<Match[]>([]);
  readonly geminiApiKey = signal<string>(localStorage.getItem(GEMINI_KEY) ?? '');
  readonly cubes = signal<Cube[]>([]);
  /** Spielername -> gewählter Hintergrundbild-Pfad. Persistiert dauerhaft, unabhängig vom Match. */
  readonly playerBackgrounds = signal<Record<string, string>>({});

  /** Spielername -> Menge der Modi, für die der Host die Stats für die ganze Gruppe freigegeben hat. */
  readonly statVisibility = signal<Map<string, Set<GameMode>>>(new Map());

  /** Der eigene Spielername (falls der eingeloggte User über einen verknüpften players-Eintrag verfügt). */
  readonly myPlayerName = computed(() => {
    const uid = this.auth.currentUser()?.id;
    if (!uid) return null;
    const entry = Object.entries(this.playerUserIds()).find(([, userId]) => userId === uid);
    return entry?.[0] ?? null;
  });

  constructor() {
    effect(() => {
      const groupId = this.groupService.groupId();
      if (groupId) {
        this.loadPlayers(groupId);
        this.loadCubes(groupId);
        this.loadHistory(groupId);
        this.loadPlayerBackgrounds(groupId);
        this.loadStatVisibility(groupId);
      } else {
        this.clearGroupData();
      }
    });
    effect(() => localStorage.setItem(GEMINI_KEY, this.geminiApiKey()));
  }

  /** Setzt alle gruppen-gebundenen Daten zurück, wenn keine Gruppe (mehr) aktiv ist. */
  private clearGroupData(): void {
    this.allPlayers.set([]);
    this.playerIdsByName.set({});
    this.playerUserIds.set({});
    this.playerAvatars.set({});
    this.history.set([]);
    this.cubes.set([]);
    this.playerBackgrounds.set({});
    this.statVisibility.set(new Map());
  }

  private async loadStatVisibility(groupId: string): Promise<void> {
    const { data, error } = await supabase
      .from('player_stat_visibility')
      .select('game_mode, visible, players ( display_name )')
      .eq('group_id', groupId)
      .eq('visible', true);

    if (error) {
      console.error('Konnte Sichtbarkeits-Einstellungen nicht laden:', error);
      return;
    }

    const map = new Map<string, Set<GameMode>>();
    for (const row of data as any[]) {
      const name = row.players?.display_name;
      if (!name) continue;
      const set = map.get(name) ?? new Set<GameMode>();
      set.add(row.game_mode);
      map.set(name, set);
    }
    this.statVisibility.set(map);
  }

  /** Nur für den Host: legt fest, ob die Stats eines Spielers für einen bestimmten Modus für die ganze Gruppe sichtbar sind. */
  async setStatVisibility(playerName: string, mode: GameMode, visible: boolean): Promise<boolean> {
    const groupId = this.groupService.groupId();
    if (!groupId) return false;

    const playerId = this.playerIdsByName()[playerName];
    if (!playerId) return false;

    const { error } = await supabase
      .from('player_stat_visibility')
      .upsert(
        { group_id: groupId, player_id: playerId, game_mode: mode, visible },
        { onConflict: 'group_id,player_id,game_mode' }
      );

    if (error) {
      console.error('Konnte Sichtbarkeit nicht ändern:', error);
      return false;
    }

    this.statVisibility.update((map) => {
      const next = new Map(map);
      const set = new Set(next.get(playerName) ?? []);
      if (visible) {
        set.add(mode);
      } else {
        set.delete(mode);
      }
      next.set(playerName, set);
      return next;
    });
    return true;
  }

  /** Nur für den Host: setzt die Sichtbarkeit eines Spielers für alle Modi auf einmal. */
  async setStatVisibilityForAllModes(playerName: string, visible: boolean): Promise<boolean> {
    const groupId = this.groupService.groupId();
    if (!groupId) return false;

    const playerId = this.playerIdsByName()[playerName];
    if (!playerId) return false;

    const rows = GAME_MODES.map((mode) => ({
      group_id: groupId,
      player_id: playerId,
      game_mode: mode,
      visible,
    }));

    const { error } = await supabase
      .from('player_stat_visibility')
      .upsert(rows, { onConflict: 'group_id,player_id,game_mode' });

    if (error) {
      console.error('Konnte Sichtbarkeit nicht ändern:', error);
      return false;
    }

    this.statVisibility.update((map) => {
      const next = new Map(map);
      next.set(playerName, visible ? new Set(GAME_MODES) : new Set());
      return next;
    });
    return true;
  }
  private async loadPlayerBackgrounds(groupId: string): Promise<void> {
    const { data, error } = await supabase
      .from('player_backgrounds')
      .select('background_url, players ( display_name )')
      .eq('group_id', groupId);

    if (error) {
      console.error('Konnte Hintergründe nicht laden:', error);
      return;
    }

    const map: Record<string, string> = {};
    for (const row of data as any[]) {
      const name = row.players?.display_name;
      if (name) map[name] = row.background_url;
    }
    this.playerBackgrounds.set(map);
  }

  async setPlayerBackground(name: string, backgroundUrl: string | null): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId) return;

    const playerId = this.playerIdsByName()[name];
    if (!playerId) return;

    if (backgroundUrl) {
      const { error } = await supabase
        .from('player_backgrounds')
        .upsert(
          { group_id: groupId, player_id: playerId, background_url: backgroundUrl },
          { onConflict: 'player_id' }
        );

      if (error) {
        console.error('Konnte Hintergrund nicht speichern:', error);
        return;
      }
    } else {
      const { error } = await supabase
        .from('player_backgrounds')
        .delete()
        .eq('group_id', groupId)
        .eq('player_id', playerId);

      if (error) {
        console.error('Konnte Hintergrund nicht löschen:', error);
        return;
      }
    }

    this.playerBackgrounds.update((all) => {
      const next = { ...all };
      if (backgroundUrl) {
        next[name] = backgroundUrl;
      } else {
        delete next[name];
      }
      return next;
    });
  }
  // --- Spieler ---
  private async loadPlayers(groupId: string): Promise<void> {
    const { data, error } = await supabase
      .from('players')
      .select('id, display_name, user_id, profiles ( avatar_url )')
      .eq('group_id', groupId)
      .order('display_name', { ascending: true });

    if (error) {
      console.error('Konnte Spieler nicht laden:', error);
      return;
    }

    this.allPlayers.set(data.map((row) => row.display_name));

    const idMap: Record<string, string> = {};
    const userIdMap: Record<string, string | null> = {};
    const avatarMap: Record<string, string | null> = {};
    for (const row of data as any[]) {
      idMap[row.display_name] = row.id;
      userIdMap[row.display_name] = row.user_id ?? null;
      avatarMap[row.display_name] = row.profiles?.avatar_url ?? null;
    }
    this.playerIdsByName.set(idMap);
    this.playerUserIds.set(userIdMap);
    this.playerAvatars.set(avatarMap);
  }

  async addPlayer(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed || this.allPlayers().some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      return false;
    }

    const groupId = this.groupService.groupId();
    if (!groupId) return false;

    const { data, error } = await supabase
      .from('players')
      .insert({ group_id: groupId, display_name: trimmed })
      .select('id, display_name')
      .single();

    if (error || !data) {
      console.error('Konnte Spieler nicht anlegen:', error);
      return false;
    }

    this.allPlayers.update((players) => [...players, trimmed]);
    this.playerIdsByName.update((map) => ({ ...map, [trimmed]: data.id }));
    return true;
  }

  async renamePlayer(oldName: string, newName: string): Promise<boolean> {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return false;
    if (this.allPlayers().some((p) => p.toLowerCase() === trimmed.toLowerCase())) return false;

    const groupId = this.groupService.groupId();
    if (!groupId) return false;

    const { error } = await supabase
      .from('players')
      .update({ display_name: trimmed })
      .eq('group_id', groupId)
      .eq('display_name', oldName);

    if (error) {
      console.error('Konnte Spieler nicht umbenennen:', error);
      return false;
    }

    this.allPlayers.update((players) => players.map((p) => (p === oldName ? trimmed : p)));
    this.history.update((matches) =>
      matches.map((m) => ({
        ...m,
        winner: m.winner === oldName ? trimmed : m.winner,
        players: m.players.map((mp) => (mp.name === oldName ? { ...mp, name: trimmed } : mp)),
      }))
    );
    return true;
  }

  async deletePlayer(name: string): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId) return;

    const { error } = await supabase
      .from('players')
      .delete()
      .eq('group_id', groupId)
      .eq('display_name', name);

    if (error) {
      console.error('Konnte Spieler nicht löschen:', error);
      return;
    }

    this.allPlayers.update((players) => players.filter((p) => p !== name));
  }

  /**
   * Verknüpft einen bestehenden (noch account-losen) Spieler-Eintrag nachträglich mit einem
   * Gruppenmitglied, damit dessen alte Stats (z.B. aus dem Excel-Import) zu seinem Account gehören.
   * Schlägt gezielt fehl, falls der Spieler zwischenzeitlich schon verknüpft wurde.
   */
  async linkPlayerToUser(playerName: string, userId: string): Promise<boolean> {
    const groupId = this.groupService.groupId();
    if (!groupId) return false;

    const { error } = await supabase
      .from('players')
      .update({ user_id: userId })
      .eq('group_id', groupId)
      .eq('display_name', playerName)
      .is('user_id', null);

    if (error) {
      console.error('Konnte Spieler nicht verknüpfen:', error);
      return false;
    }

    this.playerUserIds.update((map) => ({ ...map, [playerName]: userId }));

    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .single();
    this.playerAvatars.update((map) => ({ ...map, [playerName]: profile?.avatar_url ?? null }));

    return true;
  }

  // --- Matches ---

  // --- Matches ---

  private async loadHistory(groupId: string): Promise<void> {
    const { data, error } = await supabase
      .from('matches')
      .select(
        `
        id,
        played_at,
        game_mode,
        winner_name,
        draft_set_id,
        draft_set_code,
        draft_set_name,
        draft_set_released_at,
        cubes ( id, name, is_commander ),
        match_players (
          commander_name,
          partner_commander_name,
          team,
          is_archenemy,
          deck_id,
          decks ( name, user_id, is_precon ),
          players ( display_name )
        )
      `
      )
      .eq('group_id', groupId)
      .order('played_at', { ascending: false });

    if (error) {
      console.error('Konnte Matches nicht laden:', error);
      return;
    }

    this.history.set((data ?? []).map((row: any) => this.mapRowToMatch(row)));
  }

  /** Wandelt eine rohe Supabase-Zeile (mit verschachtelten Relationen) in unser Match-Format um. */
  private mapRowToMatch(row: any): Match {
    const match: Match = {
      id: row.id,
      date: row.played_at,
      mode: row.game_mode,
      winner: row.winner_name,
      players: (row.match_players ?? []).map((mp: any) => ({
        name: mp.players?.display_name ?? '',
        commander: mp.commander_name ?? undefined,
        partnerCommander: mp.partner_commander_name ?? undefined,
        team: mp.team ?? undefined,
        isArchenemy: mp.is_archenemy ?? undefined,
        deckId: mp.deck_id ?? undefined,
        deckName: mp.decks?.name ?? undefined,
        deckOwnerId: mp.decks?.user_id ?? undefined,
        deckIsPrecon: mp.decks?.is_precon ?? undefined,
      })),
    };

    if (row.cubes) {
      match.cube = {
        id: row.cubes.id,
        name: row.cubes.name,
        isCommander: row.cubes.is_commander,
      };
    }

    if (row.draft_set_id) {
      match.draftSet = {
        id: row.draft_set_id,
        code: row.draft_set_code ?? undefined,
        name: row.draft_set_name,
        releasedAt: row.draft_set_released_at ?? undefined,
      };
    }

    return match;
  }

  /**
   * Ergänzt fehlende deck_id-Werte automatisch: falls ein Spieler keine explizite Deck-Auswahl
   * hat (weder eigenes noch geliehenes Deck), aber einen Commander-Namen, der zu einem seiner
   * eigenen Decks passt, wird das Deck automatisch verknüpft - sonst müsste man Alt-Matches ohne
   * Deck-Auswahl (z.B. aus dem Excel-Import) immer manuell nachpflegen.
   */
  private async resolveAutoDeckLinks(players: MatchPlayer[]): Promise<MatchPlayer[]> {
    const cache = new Map<string, string | null>();
    const resolved: MatchPlayer[] = [];

    for (const p of players) {
      if (p.deckId || !p.commander) {
        resolved.push(p);
        continue;
      }
      const userId = this.playerUserIds()[p.name];
      if (!userId) {
        resolved.push(p);
        continue;
      }
      const cacheKey = `${userId}::${p.commander.toLowerCase()}`;
      if (!cache.has(cacheKey)) {
        cache.set(cacheKey, await this.deckService.findDeckIdByCommander(userId, p.commander));
      }
      const deckId = cache.get(cacheKey);
      resolved.push(deckId ? { ...p, deckId } : p);
    }

    return resolved;
  }

  async addMatch(match: Omit<Match, 'id' | 'date'>): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId) return;

    const players = await this.resolveAutoDeckLinks(match.players);

    // Schritt 1: Zeile in "matches" anlegen
    const { data: matchRow, error: matchError } = await supabase
      .from('matches')
      .insert({
        group_id: groupId,
        game_mode: match.mode,
        cube_id: match.cube?.id ?? null,
        winner_name: match.winner,
        draft_set_id: match.draftSet?.id ?? null,
        draft_set_code: match.draftSet?.code ?? null,
        draft_set_name: match.draftSet?.name ?? null,
        draft_set_released_at: match.draftSet?.releasedAt ?? null,
      })
      .select('id, played_at')
      .single();

    if (matchError || !matchRow) {
      console.error('Konnte Match nicht anlegen:', matchError);
      return;
    }

    // Schritt 2: Für jeden Spieler eine Zeile in "match_players" anlegen
    const playerRows = players.map((p) => ({
      match_id: matchRow.id,
      player_id: this.playerIdsByName()[p.name] ?? null,
      commander_name: p.commander ?? null,
      partner_commander_name: p.partnerCommander ?? null,
      team: p.team ?? null,
      is_archenemy: p.isArchenemy ?? false,
      deck_id: p.deckId ?? null,
    }));

    const { error: playersError } = await supabase.from('match_players').insert(playerRows);

    if (playersError) {
      console.error('Konnte Match-Spieler nicht anlegen:', playersError);
      return;
    }

    // Schritt 3: Lokal ans Signal anhängen, damit die UI sofort aktualisiert.
    // Deck-Namen müssen extra nachgeladen werden - players kennt nur die deckId (kommt aus der
    // Session oder der Auto-Verknüpfung oben), nicht den Namen (der wird sonst erst beim
    // Neuladen aus der DB per Join befüllt).
    const deckIds = [...new Set(players.map((p) => p.deckId).filter((id): id is string => !!id))];
    let deckNames: Record<string, string> = {};
    let deckOwners: Record<string, string> = {};
    let deckPrecons: Record<string, boolean> = {};
    if (deckIds.length > 0) {
      const { data: deckRows } = await supabase
        .from('decks')
        .select('id, name, user_id, is_precon')
        .in('id', deckIds);
      deckNames = Object.fromEntries((deckRows ?? []).map((d) => [d.id, d.name]));
      deckOwners = Object.fromEntries((deckRows ?? []).map((d) => [d.id, d.user_id]));
      deckPrecons = Object.fromEntries((deckRows ?? []).map((d) => [d.id, d.is_precon]));
    }

    const full: Match = {
      ...match,
      id: matchRow.id,
      date: matchRow.played_at,
      players: players.map((p) => ({
        ...p,
        deckName: p.deckId ? deckNames[p.deckId] : undefined,
        deckOwnerId: p.deckId ? deckOwners[p.deckId] : undefined,
        deckIsPrecon: p.deckId ? deckPrecons[p.deckId] : undefined,
      })),
    };
    this.history.update((matches) => [full, ...matches]);
  }

  /** crypto.randomUUID() existiert nur in sicheren Kontexten (HTTPS/localhost) – daher Fallback. */
  private createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // NEU
  // NEU
  async deleteMatch(id: string): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId) return;

    // Erst die zugehörigen Spieler-Zeilen löschen (wegen der Verknüpfung),
    // danach die Match-Zeile selbst.
    const { error: playersError } = await supabase
      .from('match_players')
      .delete()
      .eq('match_id', id);

    if (playersError) {
      console.error('Konnte Match-Spieler nicht löschen:', playersError);
      return;
    }

    const { error: matchError } = await supabase
      .from('matches')
      .delete()
      .eq('id', id)
      .eq('group_id', groupId);

    if (matchError) {
      console.error('Konnte Match nicht löschen:', matchError);
      return;
    }

    this.history.update((matches) => matches.filter((m) => m.id !== id));
  }

  /** Ändert nachträglich den Gewinner eines gespeicherten Matches (z.B. bei Vertippern). */
  async updateMatchWinner(id: string, winner: string): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId) return;

    const { error } = await supabase
      .from('matches')
      .update({ winner_name: winner })
      .eq('id', id)
      .eq('group_id', groupId);

    if (error) {
      console.error('Konnte Gewinner nicht ändern:', error);
      return;
    }

    this.history.update((matches) => matches.map((m) => (m.id === id ? { ...m, winner } : m)));
  }

  /** Hard-Reset: löscht Verlauf, alle Spieler und deren Hintergrundbilder unwiderruflich. Cubes/Gemini-Key bleiben erhalten. */
  /** Hard-Reset: löscht Verlauf, alle Spieler und deren Hintergrundbilder unwiderruflich. Cubes/Gemini-Key bleiben erhalten. */
  async resetAllData(): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId) return;

    // Schritt 1: IDs aller Matches dieser Gruppe holen.
    const { data: matchRows, error: matchesFetchError } = await supabase
      .from('matches')
      .select('id')
      .eq('group_id', groupId);

    if (matchesFetchError) {
      console.error('Reset fehlgeschlagen (Matches laden):', matchesFetchError);
      return;
    }

    const matchIds = (matchRows ?? []).map((m) => m.id);

    // Schritt 2: match_players für diese Matches löschen (nur falls welche existieren).
    if (matchIds.length > 0) {
      const { error: mpError } = await supabase
        .from('match_players')
        .delete()
        .in('match_id', matchIds);

      if (mpError) {
        console.error('Reset fehlgeschlagen (match_players):', mpError);
        return;
      }
    }

    // Schritt 3: matches selbst löschen.
    const { error: matchesError } = await supabase.from('matches').delete().eq('group_id', groupId);

    if (matchesError) {
      console.error('Reset fehlgeschlagen (matches):', matchesError);
      return;
    }

    // Schritt 4: player_backgrounds löschen.
    const { error: backgroundsError } = await supabase
      .from('player_backgrounds')
      .delete()
      .eq('group_id', groupId);

    if (backgroundsError) {
      console.error('Reset fehlgeschlagen (player_backgrounds):', backgroundsError);
      return;
    }

    // Schritt 5: players selbst löschen.
    const { error: playersError } = await supabase.from('players').delete().eq('group_id', groupId);

    if (playersError) {
      console.error('Reset fehlgeschlagen (players):', playersError);
      return;
    }

    // Schritt 6: Lokale Signale zurücksetzen.
    this.history.set([]);
    this.allPlayers.set([]);
    this.playerBackgrounds.set({});
    this.playerIdsByName.set({});
  }
  /** Fügt Bulk-importierte Matches an (Datum wird mitgegeben statt automatisch gesetzt). */
  async importMatches(newMatches: Omit<Match, 'id'>[]): Promise<void> {
    if (newMatches.length === 0) return;

    const groupId = this.groupService.groupId();
    if (!groupId) return;

    // Schritt 1: Herausfinden, welche Spielernamen noch NICHT existieren.
    const knownPlayers = new Set(this.allPlayers().map((p) => p.toLowerCase()));
    const newPlayerNames = new Set<string>();
    for (const match of newMatches) {
      for (const p of match.players) {
        if (!knownPlayers.has(p.name.toLowerCase())) {
          newPlayerNames.add(p.name);
          knownPlayers.add(p.name.toLowerCase());
        }
      }
    }

    // Schritt 2: Neue Spieler in Supabase anlegen (alle auf einmal).
    if (newPlayerNames.size > 0) {
      const rows = [...newPlayerNames].map((name) => ({ group_id: groupId, display_name: name }));
      const { data: newPlayerRows, error: playersError } = await supabase
        .from('players')
        .insert(rows)
        .select('id, display_name');

      if (playersError || !newPlayerRows) {
        console.error('Konnte neue Spieler nicht anlegen:', playersError);
        return;
      }

      this.allPlayers.update((players) => [...players, ...newPlayerNames]);
      this.playerIdsByName.update((map) => {
        const next = { ...map };
        for (const row of newPlayerRows) {
          next[row.display_name] = row.id;
        }
        return next;
      });
    }

    // Schritt 3: Jedes Match einzeln anlegen (matches + match_players).
    // Deck-Auto-Verknüpfung wird über einen gemeinsamen Cache dedupliziert, da z.B. beim
    // Excel-Import derselbe Spieler/Commander über sehr viele synthetische Matches wiederkehrt.
    const deckIdCache = new Map<string, string | null>();
    const resolveDeckId = async (playerName: string, commander: string | undefined): Promise<string | null> => {
      if (!commander) return null;
      const userId = this.playerUserIds()[playerName];
      if (!userId) return null;
      const key = `${userId}::${commander.toLowerCase()}`;
      if (!deckIdCache.has(key)) {
        deckIdCache.set(key, await this.deckService.findDeckIdByCommander(userId, commander));
      }
      return deckIdCache.get(key) ?? null;
    };

    const importedMatches: Match[] = [];
    for (const match of newMatches) {
      const { data: matchRow, error: matchError } = await supabase
        .from('matches')
        .insert({
          group_id: groupId,
          game_mode: match.mode,
          cube_id: match.cube?.id ?? null,
          winner_name: match.winner,
          played_at: match.date,
          draft_set_id: match.draftSet?.id ?? null,
          draft_set_code: match.draftSet?.code ?? null,
          draft_set_name: match.draftSet?.name ?? null,
          draft_set_released_at: match.draftSet?.releasedAt ?? null,
        })
        .select('id, played_at')
        .single();

      if (matchError || !matchRow) {
        console.error('Konnte importiertes Match nicht anlegen:', matchError);
        continue;
      }

      const resolvedPlayers: MatchPlayer[] = [];
      for (const p of match.players) {
        const deckId = p.deckId ?? (await resolveDeckId(p.name, p.commander)) ?? undefined;
        resolvedPlayers.push(deckId ? { ...p, deckId } : p);
      }

      const playerRows = resolvedPlayers.map((p) => ({
        match_id: matchRow.id,
        player_id: this.playerIdsByName()[p.name] ?? null,
        commander_name: p.commander ?? null,
        partner_commander_name: p.partnerCommander ?? null,
        team: p.team ?? null,
        is_archenemy: p.isArchenemy ?? false,
        deck_id: p.deckId ?? null,
      }));

      const { error: playersError } = await supabase.from('match_players').insert(playerRows);

      if (playersError) {
        console.error('Konnte Spieler für importiertes Match nicht anlegen:', playersError);
        continue;
      }

      importedMatches.push({
        ...match,
        id: matchRow.id,
        date: matchRow.played_at,
        players: resolvedPlayers,
      });
    }

    // Deck-Namen/Besitzer/Precon-Flag für die neu verknüpften Decks nachladen, damit die lokal
    // angehängten Matches sofort korrekt angezeigt werden (statt erst nach einem Neuladen).
    const deckIds = [
      ...new Set(
        importedMatches.flatMap((m) => m.players.map((p) => p.deckId).filter((id): id is string => !!id))
      ),
    ];
    if (deckIds.length > 0) {
      const { data: deckRows } = await supabase
        .from('decks')
        .select('id, name, user_id, is_precon')
        .in('id', deckIds);
      const deckNames = Object.fromEntries((deckRows ?? []).map((d) => [d.id, d.name]));
      const deckOwners = Object.fromEntries((deckRows ?? []).map((d) => [d.id, d.user_id]));
      const deckPrecons = Object.fromEntries((deckRows ?? []).map((d) => [d.id, d.is_precon]));

      for (const m of importedMatches) {
        m.players = m.players.map((p) =>
          p.deckId
            ? {
                ...p,
                deckName: deckNames[p.deckId],
                deckOwnerId: deckOwners[p.deckId],
                deckIsPrecon: deckPrecons[p.deckId],
              }
            : p
        );
      }
    }

    // Schritt 4: Lokal ans Signal anhängen.
    this.history.update((matches) => [...matches, ...importedMatches]);
  }

  // --- Cubes ---

  // --- Cubes ---

  private async loadCubes(groupId: string): Promise<void> {
    const { data, error } = await supabase
      .from('cubes')
      .select('id, name, is_commander')
      .eq('group_id', groupId)
      .order('name', { ascending: true });

    if (error) {
      console.error('Konnte Cubes nicht laden:', error);
      return;
    }

    this.cubes.set(
      data.map((row) => ({
        id: row.id,
        name: row.name,
        isCommander: row.is_commander,
      }))
    );
  }
  async addCube(name: string, isCommander = false): Promise<Cube | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (this.cubes().some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return null;

    const groupId = this.groupService.groupId();
    if (!groupId) return null;

    const { data, error } = await supabase
      .from('cubes')
      .insert({ group_id: groupId, name: trimmed, is_commander: isCommander })
      .select('id, name, is_commander')
      .single();

    if (error || !data) {
      console.error('Konnte Cube nicht anlegen:', error);
      return null;
    }

    const cube: Cube = { id: data.id, name: data.name, isCommander: data.is_commander };
    this.cubes.update((cs) => [...cs, cube]);
    return cube;
  }
  async deleteCube(id: string): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId) return;

    // Erst Matches, die diesen Cube nutzen, "entkoppeln" (cube_id auf null setzen),
    // damit das Löschen des Cubes nicht an bestehenden Verknüpfungen scheitert.
    const { error: unlinkError } = await supabase
      .from('matches')
      .update({ cube_id: null })
      .eq('group_id', groupId)
      .eq('cube_id', id);

    if (unlinkError) {
      console.error('Konnte Cube-Verknüpfung nicht lösen:', unlinkError);
      return;
    }

    const { error } = await supabase.from('cubes').delete().eq('id', id).eq('group_id', groupId);

    if (error) {
      console.error('Konnte Cube nicht löschen:', error);
      return;
    }

    this.cubes.update((cs) => cs.filter((c) => c.id !== id));
    // Lokale Match-Historie ebenfalls bereinigen, damit die Anzeige konsistent bleibt.
    this.history.update((matches) =>
      matches.map((m) => (m.cube?.id === id ? { ...m, cube: undefined } : m))
    );
  }
  // --- Gemini-Key ---

  setGeminiApiKey(key: string): void {
    this.geminiApiKey.set(key.trim());
  }
}
