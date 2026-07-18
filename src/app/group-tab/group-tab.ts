import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GroupService } from '../group.service';
import { MtgService } from '../mtg.service';
import { ProfileService } from '../profile.service';
import { PlayerAvatar } from '../player-avatar/player-avatar';
import { DeckList } from '../deck-list/deck-list';
import { GAME_MODES, GameMode } from '../models';

@Component({
  selector: 'app-group-tab',
  imports: [FormsModule, PlayerAvatar, DeckList],
  templateUrl: './group-tab.html',
  styleUrl: './group-tab.scss',
})
export class GroupTab {
  readonly groupService = inject(GroupService);
  readonly mtg = inject(MtgService);
  private readonly profileService = inject(ProfileService);

  // --- Gruppen erstellen/wechseln ---

  readonly newGroupName = signal('');
  readonly creating = signal(false);
  readonly message = signal('');

  async createGroup(): Promise<void> {
    const name = this.newGroupName().trim();
    if (!name) return;

    this.creating.set(true);
    this.message.set('');

    const success = await this.groupService.createGroup(name);

    this.creating.set(false);
    if (success) {
      this.newGroupName.set('');
      this.message.set(`Gruppe „${name}" erstellt!`);
      setTimeout(() => this.message.set(''), 2500);
    } else {
      this.message.set('Gruppe konnte nicht erstellt werden.');
    }
  }

  selectGroup(groupId: string): void {
    this.groupService.switchGroup(groupId);
  }

  // --- Gruppe umbenennen ---

  readonly renamingGroupId = signal<string | null>(null);
  readonly renameValue = signal('');

  startRenameGroup(groupId: string, currentName: string): void {
    this.renamingGroupId.set(groupId);
    this.renameValue.set(currentName);
  }

  cancelRenameGroup(): void {
    this.renamingGroupId.set(null);
  }

  async confirmRenameGroup(): Promise<void> {
    const groupId = this.renamingGroupId();
    if (!groupId) return;
    if (await this.groupService.renameGroup(groupId, this.renameValue())) {
      this.renamingGroupId.set(null);
    }
  }

  // --- Gruppe löschen ---

  readonly deletingGroupId = signal<string | null>(null);
  readonly deletingGroupName = signal('');
  readonly deleteConfirmText = signal('');

  openDeleteGroupConfirm(groupId: string, groupName: string): void {
    this.deletingGroupId.set(groupId);
    this.deletingGroupName.set(groupName);
    this.deleteConfirmText.set('');
  }

  closeDeleteGroupConfirm(): void {
    this.deletingGroupId.set(null);
    this.deleteConfirmText.set('');
  }

  updateDeleteConfirmText(value: string): void {
    this.deleteConfirmText.set(value);
  }

  readonly canConfirmDeleteGroup = computed(() => this.deleteConfirmText().trim() === 'LÖSCHEN');

  async confirmDeleteGroup(): Promise<void> {
    if (!this.canConfirmDeleteGroup()) return;
    const groupId = this.deletingGroupId();
    if (!groupId) return;
    await this.groupService.deleteGroup(groupId);
    this.closeDeleteGroupConfirm();
  }

  // --- Einladungscode erstellen ---

  readonly invitingForGroupId = signal<string | null>(null);
  readonly generatedCode = signal<string | null>(null);
  readonly inviteBusy = signal(false);

  async openInvite(groupId: string): Promise<void> {
    this.invitingForGroupId.set(groupId);
    this.generatedCode.set(null);
    this.inviteBusy.set(true);

    const code = await this.groupService.createInvite(groupId);

    this.inviteBusy.set(false);
    this.generatedCode.set(code);
  }

  closeInvite(): void {
    this.invitingForGroupId.set(null);
    this.generatedCode.set(null);
  }

  // --- Mitgliederliste ---

  readonly viewingMembersForGroupId = signal<string | null>(null);
  readonly members = signal<
    { userId: string; displayName: string; role: string; avatarUrl: string | null }[]
  >([]);
  readonly membersBusy = signal(false);

  async openMembers(groupId: string): Promise<void> {
    this.viewingMembersForGroupId.set(groupId);
    this.membersBusy.set(true);
    this.members.set(await this.groupService.loadGroupMembers(groupId));
    this.membersBusy.set(false);
  }

  closeMembers(): void {
    this.viewingMembersForGroupId.set(null);
    this.members.set([]);
  }

  // --- Einladungscode einlösen ---

  readonly joinCode = signal('');
  readonly joinBusy = signal(false);
  readonly joinMessage = signal('');

  async submitJoinCode(): Promise<void> {
    this.joinBusy.set(true);
    this.joinMessage.set('');

    const result = await this.groupService.joinGroupByCode(this.joinCode());

    this.joinBusy.set(false);
    this.joinMessage.set(result.message);

    if (result.success) {
      this.joinCode.set('');
      setTimeout(() => this.joinMessage.set(''), 2500);
    }
  }

  // --- Spielerverwaltung (Statistik-Identitäten der aktiven Gruppe) ---

  readonly newPlayerName = signal('');
  readonly editingPlayer = signal<string | null>(null);
  readonly editName = signal('');
  readonly playerErrorMessage = signal('');

  readonly gamesPerPlayer = computed(() => {
    const counts = new Map<string, number>();
    for (const match of this.mtg.history()) {
      for (const p of match.players) {
        counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
      }
    }
    return counts;
  });

  async addPlayer(): Promise<void> {
    this.playerErrorMessage.set('');
    const name = this.newPlayerName().trim();
    if (!name) return;
    if (!(await this.mtg.addPlayer(name))) {
      this.playerErrorMessage.set(`„${name}“ existiert bereits.`);
      return;
    }
    this.newPlayerName.set('');
  }

  startEditPlayer(name: string): void {
    this.playerErrorMessage.set('');
    this.editingPlayer.set(name);
    this.editName.set(name);
  }

  async confirmEditPlayer(): Promise<void> {
    const oldName = this.editingPlayer();
    if (!oldName) return;
    const newName = this.editName().trim();
    if (newName && newName !== oldName && !(await this.mtg.renamePlayer(oldName, newName))) {
      this.playerErrorMessage.set(`„${newName}“ existiert bereits.`);
      return;
    }
    this.editingPlayer.set(null);
  }

  cancelEditPlayer(): void {
    this.editingPlayer.set(null);
  }

  async deletePlayer(name: string): Promise<void> {
    const games = this.gamesPerPlayer().get(name) ?? 0;
    const warning =
      games > 0
        ? `„${name}“ wirklich löschen? Die ${games} gespeicherten Matches bleiben erhalten.`
        : `„${name}“ wirklich löschen?`;
    if (confirm(warning)) {
      await this.mtg.deletePlayer(name);
    }
  }

  isPlayerLinked(name: string): boolean {
    return !!this.mtg.playerUserIds()[name];
  }

  // --- Spieler zusammenführen (Duplikate wie "Theo"/"Theos"/"Theodor" zu einem machen) ---

  readonly showMergeDialog = signal(false);
  readonly mergeSelected = signal<Set<string>>(new Set());
  readonly mergeTargetName = signal<string | null>(null);
  readonly mergeBusy = signal(false);
  readonly mergeMessage = signal('');

  openMergeDialog(): void {
    this.showMergeDialog.set(true);
    this.mergeSelected.set(new Set());
    this.mergeTargetName.set(null);
    this.mergeMessage.set('');
  }

  closeMergeDialog(): void {
    this.showMergeDialog.set(false);
  }

  toggleMergeSelected(name: string): void {
    this.mergeSelected.update((set) => {
      const next = new Set(set);
      if (next.has(name)) {
        next.delete(name);
        if (this.mergeTargetName() === name) this.mergeTargetName.set(null);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  setMergeTarget(name: string): void {
    this.mergeTargetName.set(name);
  }

  readonly canConfirmMerge = computed(
    () => this.mergeSelected().size >= 2 && !!this.mergeTargetName()
  );

  async confirmMerge(): Promise<void> {
    const target = this.mergeTargetName();
    if (!target) return;
    const sources = [...this.mergeSelected()].filter((n) => n !== target);
    if (sources.length === 0) return;

    this.mergeBusy.set(true);
    this.mergeMessage.set('');

    const ok = await this.mtg.mergePlayers(target, sources);

    this.mergeBusy.set(false);

    if (ok) {
      this.closeMergeDialog();
    } else {
      this.mergeMessage.set('Zusammenführen fehlgeschlagen.');
    }
  }

  // --- Profil ansehen (nur lesend) ---

  readonly viewingProfileFor = signal<string | null>(null);
  readonly viewedProfile = signal<{ displayName: string; avatarUrl: string | null } | null>(null);
  readonly viewProfileBusy = signal(false);

  async openProfileView(userId: string): Promise<void> {
    this.viewingProfileFor.set(userId);
    this.viewProfileBusy.set(true);
    this.viewedProfile.set(await this.profileService.loadPublicProfile(userId));
    this.viewProfileBusy.set(false);
  }

  closeProfileView(): void {
    this.viewingProfileFor.set(null);
    this.viewedProfile.set(null);
  }

  // --- Spieler nachträglich mit einem Mitglied-Account verknüpfen (nur Host) ---

  readonly linkingPlayerName = signal<string | null>(null);
  readonly linkCandidates = signal<{ userId: string; displayName: string }[]>([]);
  readonly linkBusy = signal(false);

  async openLinkDialog(playerName: string): Promise<void> {
    const groupId = this.groupService.groupId();
    if (!groupId) return;

    this.linkingPlayerName.set(playerName);
    this.linkBusy.set(true);

    const allMembers = await this.groupService.loadGroupMembers(groupId);
    const linkedUserIds = new Set(
      Object.values(this.mtg.playerUserIds()).filter((id): id is string => !!id)
    );
    this.linkCandidates.set(allMembers.filter((m) => !linkedUserIds.has(m.userId)));
    this.linkBusy.set(false);
  }

  closeLinkDialog(): void {
    this.linkingPlayerName.set(null);
    this.linkCandidates.set([]);
  }

  async linkPlayer(userId: string): Promise<void> {
    const name = this.linkingPlayerName();
    if (!name) return;
    await this.mtg.linkPlayerToUser(name, userId);
    this.closeLinkDialog();
  }

  // --- Stats-Sichtbarkeit (nur Host) ---

  readonly visibilityModes = GAME_MODES;
  readonly showVisibilityDialog = signal(false);

  openVisibilityDialog(): void {
    this.showVisibilityDialog.set(true);
  }

  closeVisibilityDialog(): void {
    this.showVisibilityDialog.set(false);
  }

  isStatVisible(name: string, mode: GameMode): boolean {
    return this.mtg.statVisibility().get(name)?.has(mode) ?? false;
  }

  async toggleVisibilityChip(name: string, mode: GameMode): Promise<void> {
    await this.mtg.setStatVisibility(name, mode, !this.isStatVisible(name, mode));
  }

  async setAllModesVisible(name: string, visible: boolean): Promise<void> {
    await this.mtg.setStatVisibilityForAllModes(name, visible);
  }
}
