import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { supabase } from './supabase.client';
import { AuthService } from './auth.service';
import { chunk } from './array-utils';

export interface MyGroup {
  id: string;
  name: string;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class GroupService {
  private readonly auth = inject(AuthService);

  readonly groupId = signal<string | null>(null);
  readonly loading = signal<boolean>(true);

  readonly myGroups = signal<MyGroup[]>([]);

  /** Ob der eingeloggte User in der aktuell aktiven Gruppe die Host-Rolle ("owner") hat. */
  readonly isOwner = computed(
    () => this.myGroups().find((g) => g.id === this.groupId())?.role === 'owner'
  );

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      if (user) {
        this.loadMyGroups(user.id);
      } else {
        this.groupId.set(null);
        this.myGroups.set([]);
        this.loading.set(false);
      }
    });
  }

  private async loadMyGroups(userId: string): Promise<void> {
    this.loading.set(true);

    const { data, error } = await supabase
      .from('group_members')
      .select('role, groups ( id, name )')
      .eq('user_id', userId);

    if (error) {
      console.error('Konnte Gruppen nicht laden:', error);
      this.myGroups.set([]);
      this.loading.set(false);
      return;
    }

    const groups: MyGroup[] = (data as any[])
      .filter((row) => row.groups)
      .map((row) => ({
        id: row.groups.id,
        name: row.groups.name,
        role: row.role,
      }));

    this.myGroups.set(groups);

    const current = this.groupId();
    if (!current || !groups.some((g) => g.id === current)) {
      this.groupId.set(groups[0]?.id ?? null);
    }

    this.loading.set(false);
  }

  switchGroup(groupId: string): void {
    if (this.myGroups().some((g) => g.id === groupId)) {
      this.groupId.set(groupId);
    }
  }

  async refresh(): Promise<void> {
    const user = this.auth.currentUser();
    if (user) {
      await this.loadMyGroups(user.id);
    }
  }

  /**
   * Lässt den eingeloggten User eine Gruppe verlassen, in der er NICHT Host ist (Hosts nutzen
   * stattdessen "Gruppe löschen" - sonst bliebe die Gruppe ohne Host zurück). Der eigene
   * players-Eintrag wird dabei nur entkoppelt (user_id = null), nicht gelöscht - so bleiben
   * Match-Historie/Statistik für die verbleibende Gruppe erhalten, genau wie beim Löschen eines
   * Spielers durch den Host. Tritt der User später erneut bei, kann er sich über die
   * Beitritts-Auswahl wieder mit demselben Spieler verknüpfen.
   */
  async leaveGroup(groupId: string): Promise<boolean> {
    const user = this.auth.currentUser();
    if (!user) return false;

    const { error: unlinkError } = await supabase
      .from('players')
      .update({ user_id: null })
      .eq('group_id', groupId)
      .eq('user_id', user.id);

    if (unlinkError) {
      console.error('Konnte eigenen Spieler nicht entkoppeln:', unlinkError);
      return false;
    }

    const { error: leaveError } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id);

    if (leaveError) {
      console.error('Konnte Gruppe nicht verlassen:', leaveError);
      return false;
    }

    await this.refresh();
    return true;
  }

  async createGroup(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return false;

    const user = this.auth.currentUser();
    if (!user) return false;

    const { error } = await supabase
      .from('groups')
      .insert({ name: trimmed, created_by: user.id });

    if (error) {
      console.error('Konnte Gruppe nicht erstellen:', error);
      return false;
    }

    await this.refresh();
    return true;
  }

  /**
   * Liefert den (einen, dauerhaften) Einladungscode einer Gruppe - legt beim ersten Aufruf einen
   * an, bei jedem weiteren wird einfach derselbe zurückgegeben. Codes sind über alle Gruppen
   * hinweg eindeutig (DB-Constraint), bei einer sehr seltenen Kollision wird neu gewürfelt.
   */
  async createInvite(groupId: string): Promise<string | null> {
    const { data: existing, error: fetchError } = await supabase
      .from('group_invites')
      .select('code')
      .eq('group_id', groupId)
      .maybeSingle();

    if (fetchError) {
      console.error('Konnte bestehende Einladung nicht laden:', fetchError);
      return null;
    }
    if (existing) return existing.code;

    const user = this.auth.currentUser();
    if (!user) return null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.generateCode();
      const { error } = await supabase
        .from('group_invites')
        .insert({ group_id: groupId, code, created_by: user.id });

      if (!error) return code;
      if (error.code !== '23505') {
        console.error('Konnte Einladung nicht erstellen:', error);
        return null;
      }
      // 23505 = unique_violation -> Code kollidiert mit einer anderen Gruppe, nochmal versuchen.
    }

    console.error('Konnte keinen eindeutigen Einladungscode finden.');
    return null;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  async joinGroupByCode(code: string): Promise<{
    success: boolean;
    message: string;
    needsPlayerChoice?: boolean;
    groupId?: string;
    candidates?: { id: string; displayName: string }[];
    suggestedPlayerId?: string | null;
  }> {
    const user = this.auth.currentUser();
    if (!user) return { success: false, message: 'Nicht angemeldet.' };

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) return { success: false, message: 'Bitte einen Code eingeben.' };

    const { data: invite, error: inviteError } = await supabase
      .from('group_invites')
      .select('id, group_id, expires_at')
      .eq('code', trimmedCode)
      .single();

    if (inviteError || !invite) {
      return { success: false, message: 'Ungültiger Einladungscode.' };
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return { success: false, message: 'Dieser Einladungscode ist abgelaufen.' };
    }

    const alreadyMember = this.myGroups().some((g) => g.id === invite.group_id);
    if (alreadyMember) {
      return { success: false, message: 'Du bist bereits Mitglied dieser Gruppe.' };
    }

    const { error: joinError } = await supabase
      .from('group_members')
      .insert({ group_id: invite.group_id, user_id: user.id, role: 'member' });

    if (joinError) {
      console.error('Konnte Gruppe nicht beitreten:', joinError);
      return { success: false, message: 'Beitritt fehlgeschlagen.' };
    }

    // players-Eintrag für diese Person anlegen bzw. verknüpfen.
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single();

    // Alle noch account-losen Spieler dieser Gruppe (z.B. aus einem Excel-Import vor dem Beitritt) -
    // der Beitretende soll sich bewusst selbst zuordnen können, statt dass Namensabweichungen wie
    // "Theo" vs. "Theodor" stillschweigend zu einem doppelten Spieler-Eintrag führen.
    const { data: unlinkedPlayers } = await supabase
      .from('players')
      .select('id, display_name')
      .eq('group_id', invite.group_id)
      .is('user_id', null);

    await this.refresh();
    this.groupId.set(invite.group_id);

    if (profile?.display_name && unlinkedPlayers && unlinkedPlayers.length > 0) {
      const suggested = unlinkedPlayers.find(
        (p) => p.display_name.toLowerCase() === profile.display_name.toLowerCase()
      );
      return {
        success: true,
        message: 'Erfolgreich beigetreten!',
        needsPlayerChoice: true,
        groupId: invite.group_id,
        candidates: unlinkedPlayers.map((p) => ({ id: p.id, displayName: p.display_name })),
        suggestedPlayerId: suggested?.id ?? null,
      };
    }

    if (profile?.display_name) {
      const { error: playerError } = await supabase
        .from('players')
        .insert({ group_id: invite.group_id, display_name: profile.display_name, user_id: user.id });

      if (playerError) {
        console.error('Konnte Spieler-Eintrag nicht anlegen:', playerError);
        // Kein "return" hier - der Gruppenbeitritt selbst war erfolgreich, das ist nur ein Zusatzschritt.
      }
    }

    return { success: true, message: 'Erfolgreich beigetreten!' };
  }

  /**
   * Schließt die Spieler-Auswahl nach dem Beitritt ab: entweder mit einem bestehenden,
   * account-losen Spieler verknüpfen (dessen alte Stats übernehmen), oder einen neuen anlegen.
   */
  async finalizePlayerChoice(
    groupId: string,
    choice: { linkToPlayerId: string } | { createNewWithName: string }
  ): Promise<boolean> {
    const user = this.auth.currentUser();
    if (!user) return false;

    if ('linkToPlayerId' in choice) {
      const { error } = await supabase
        .from('players')
        .update({ user_id: user.id })
        .eq('id', choice.linkToPlayerId);

      if (error) {
        console.error('Konnte Spieler nicht verknüpfen:', error);
        return false;
      }
      return true;
    }

    const { error } = await supabase
      .from('players')
      .insert({ group_id: groupId, display_name: choice.createNewWithName, user_id: user.id });

    if (error) {
      console.error('Konnte Spieler-Eintrag nicht anlegen:', error);
      return false;
    }
    return true;
  }

  async loadGroupMembers(
    groupId: string
  ): Promise<{ userId: string; displayName: string; role: string; avatarUrl: string | null }[]> {
    const { data, error } = await supabase
      .from('group_members')
      .select('user_id, role, profiles ( display_name, avatar_url )')
      .eq('group_id', groupId);

    if (error) {
      console.error('Konnte Mitglieder nicht laden:', error);
      return [];
    }

    return (data as any[]).map((row) => ({
      userId: row.user_id,
      displayName: row.profiles?.display_name ?? 'Unbekannt',
      role: row.role,
      avatarUrl: row.profiles?.avatar_url ?? null,
    }));
  }

  async renameGroup(groupId: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return false;

    const { error } = await supabase.from('groups').update({ name: trimmed }).eq('id', groupId);

    if (error) {
      console.error('Konnte Gruppe nicht umbenennen:', error);
      return false;
    }

    await this.refresh();
    return true;
  }

  /**
   * Löscht eine Gruppe unwiderruflich samt aller zugehörigen Daten. Löscht bewusst Tabelle für
   * Tabelle in Abhängigkeitsreihenfolge (statt auf DB-seitige Cascades zu vertrauen), analog zu
   * MtgService.resetAllData.
   */
  async deleteGroup(groupId: string): Promise<boolean> {
    const { data: matchRows, error: matchesFetchError } = await supabase
      .from('matches')
      .select('id')
      .eq('group_id', groupId);

    if (matchesFetchError) {
      console.error('Löschen fehlgeschlagen (Matches laden):', matchesFetchError);
      return false;
    }

    const matchIds = (matchRows ?? []).map((m) => m.id);

    // In Päckchen löschen, sonst wird die Anfrage-URL bei vielen Matches zu lang ("Bad Request").
    for (const batch of chunk(matchIds, 150)) {
      const { error } = await supabase.from('match_players').delete().in('match_id', batch);
      if (error) {
        console.error('Löschen fehlgeschlagen (match_players):', error);
        return false;
      }
    }

    const tablesToClear = [
      'matches',
      'player_backgrounds',
      'player_stat_visibility',
      'players',
      'cubes',
      'group_invites',
      'group_members',
    ];

    for (const table of tablesToClear) {
      const { error } = await supabase.from(table).delete().eq('group_id', groupId);
      if (error) {
        console.error(`Löschen fehlgeschlagen (${table}):`, error);
        return false;
      }
    }

    const { error: groupError } = await supabase.from('groups').delete().eq('id', groupId);

    if (groupError) {
      console.error('Löschen fehlgeschlagen (groups):', groupError);
      return false;
    }

    await this.refresh();
    return true;
  }
}