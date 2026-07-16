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

  async createInvite(groupId: string): Promise<string | null> {
    const user = this.auth.currentUser();
    if (!user) return null;

    const code = this.generateCode();

    const { error } = await supabase
      .from('group_invites')
      .insert({ group_id: groupId, code, created_by: user.id });

    if (error) {
      console.error('Konnte Einladung nicht erstellen:', error);
      return null;
    }

    return code;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  async joinGroupByCode(code: string): Promise<{ success: boolean; message: string }> {
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

    if (profile?.display_name) {
      // Falls schon ein account-loser Spieler mit passendem Namen existiert (z.B. aus einem
      // Excel-Import vor dem Beitritt), diesen verknüpfen statt einen zweiten anzulegen – sonst
      // würden die alten Stats dieser Person auf einen leeren Zweit-Eintrag verteilt.
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id')
        .eq('group_id', invite.group_id)
        .is('user_id', null)
        .ilike('display_name', profile.display_name)
        .maybeSingle();

      if (existingPlayer) {
        const { error: linkError } = await supabase
          .from('players')
          .update({ user_id: user.id })
          .eq('id', existingPlayer.id);

        if (linkError) {
          console.error('Konnte bestehenden Spieler nicht verknüpfen:', linkError);
        }
      } else {
        const { error: playerError } = await supabase
          .from('players')
          .insert({ group_id: invite.group_id, display_name: profile.display_name, user_id: user.id });

        if (playerError) {
          console.error('Konnte Spieler-Eintrag nicht anlegen:', playerError);
          // Kein "return" hier - der Gruppenbeitritt selbst war erfolgreich, das ist nur ein Zusatzschritt.
        }
      }
    }

    await this.refresh();
    this.groupId.set(invite.group_id);

    return { success: true, message: 'Erfolgreich beigetreten!' };
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