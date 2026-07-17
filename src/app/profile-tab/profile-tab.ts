import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import QRCode from 'qrcode';
import { ProfileService } from '../profile.service';
import { MtgService } from '../mtg.service';
import { GroupService } from '../group.service';
import { DeckList } from '../deck-list/deck-list';
import { DeckService } from '../deck.service';
import { AuthService } from '../auth.service';
import { BackgroundService } from '../background.service';

@Component({
  selector: 'app-profile-tab',
  imports: [FormsModule, DeckList],
  templateUrl: './profile-tab.html',
  styleUrl: './profile-tab.scss',
})
export class ProfileTab {
  readonly profileService = inject(ProfileService);
  readonly mtg = inject(MtgService);
  readonly groupService = inject(GroupService);
  private readonly deckService = inject(DeckService);
  private readonly auth = inject(AuthService);
  readonly backgrounds = inject(BackgroundService);

  readonly editedName = signal('');
  readonly isEditing = signal(false);
  readonly saveMessage = signal('');

  readonly keyInput = signal(this.mtg.geminiApiKey());
  readonly keySaved = signal(false);
  readonly showGeminiSettings = signal(false);

  openGeminiSettings(): void {
    this.keyInput.set(this.mtg.geminiApiKey());
    this.showGeminiSettings.set(true);
  }

  closeGeminiSettings(): void {
    this.showGeminiSettings.set(false);
  }

  saveKey(): void {
    this.mtg.setGeminiApiKey(this.keyInput());
    this.keySaved.set(true);
    setTimeout(() => this.keySaved.set(false), 2500);
  }

  startEdit(): void {
    this.editedName.set(this.profileService.profile()?.displayName ?? '');
    this.isEditing.set(true);
    this.saveMessage.set('');
  }

  cancelEdit(): void {
    this.isEditing.set(false);
  }

  async saveName(): Promise<void> {
    const success = await this.profileService.updateDisplayName(this.editedName());
    if (success) {
      this.isEditing.set(false);
      this.saveMessage.set('Name gespeichert!');
      setTimeout(() => this.saveMessage.set(''), 2000);
    } else {
      this.saveMessage.set('Name konnte nicht gespeichert werden.');
    }
  }

  // --- Profilbild ---

  readonly avatarUploading = signal(false);
  readonly avatarError = signal('');

  async onAvatarSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.avatarError.set('Bitte ein Bild auswählen.');
      return;
    }

    this.avatarError.set('');
    this.avatarUploading.set(true);
    const success = await this.profileService.uploadAvatar(file);
    this.avatarUploading.set(false);

    if (!success) {
      this.avatarError.set('Profilbild konnte nicht hochgeladen werden.');
    }
  }

  // --- App teilen ---

  readonly shareUrl = window.location.origin;
  readonly showShareDialog = signal(false);
  readonly qrDataUrl = signal<string | null>(null);
  readonly linkCopied = signal(false);

  async openShareDialog(): Promise<void> {
    this.showShareDialog.set(true);
    if (!this.qrDataUrl()) {
      const dataUrl = await QRCode.toDataURL(this.shareUrl, { width: 240, margin: 1 });
      this.qrDataUrl.set(dataUrl);
    }
  }

  closeShareDialog(): void {
    this.showShareDialog.set(false);
  }

  async copyShareLink(): Promise<void> {
    await navigator.clipboard.writeText(this.shareUrl);
    this.linkCopied.set(true);
    setTimeout(() => this.linkCopied.set(false), 2000);
  }

  // --- Commander-Namen reparieren (Alt-Daten von vor Verbesserungen an der Erkennung) ---

  readonly repairBusy = signal(false);
  readonly repairProgress = signal<{ done: number; total: number } | null>(null);
  readonly repairMessage = signal('');

  async repairCommanderNames(): Promise<void> {
    const userId = this.auth.currentUser()?.id;
    if (!userId) return;

    this.repairBusy.set(true);
    this.repairMessage.set('');
    this.repairProgress.set({ done: 0, total: 0 });

    const result = await this.deckService.repairCommanderNames(userId, (done, total) =>
      this.repairProgress.set({ done, total })
    );

    this.repairBusy.set(false);
    this.repairProgress.set(null);
    this.repairMessage.set(
      result.checked === 0
        ? 'Nichts zu prüfen – alle Commander sind bereits verknüpft oder es gibt keine offenen Matches.'
        : `${result.checked} Commander-Namen geprüft, ${result.fixed} korrigiert, ${result.linked} mit einem Deck verknüpft.`
    );
  }

  // --- Hintergrundbilder ---

  async onBackgroundFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.backgrounds.uploadBackground(file);
  }

  async deleteBackground(id: string): Promise<void> {
    if (confirm('Diesen Hintergrund löschen?')) {
      await this.backgrounds.deleteBackground(id);
    }
  }

  readonly sharingBackgroundId = signal<string | null>(null);
  readonly shareCandidates = signal<{ userId: string; displayName: string }[]>([]);
  readonly shareBusy = signal(false);
  readonly shareMessage = signal('');

  async openBackgroundShareDialog(backgroundId: string): Promise<void> {
    this.sharingBackgroundId.set(backgroundId);
    this.shareBusy.set(true);
    this.shareMessage.set('');

    const myUserId = this.auth.currentUser()?.id;
    const seen = new Map<string, string>();
    for (const group of this.groupService.myGroups()) {
      const members = await this.groupService.loadGroupMembers(group.id);
      for (const m of members) {
        if (m.userId !== myUserId) seen.set(m.userId, m.displayName);
      }
    }

    this.shareCandidates.set([...seen.entries()].map(([userId, displayName]) => ({ userId, displayName })));
    this.shareBusy.set(false);
  }

  closeBackgroundShareDialog(): void {
    this.sharingBackgroundId.set(null);
    this.shareCandidates.set([]);
    this.shareMessage.set('');
  }

  async shareBackgroundWith(userId: string): Promise<void> {
    const backgroundId = this.sharingBackgroundId();
    if (!backgroundId) return;

    const ok = await this.backgrounds.shareBackground(backgroundId, userId);
    this.shareMessage.set(ok ? 'Geteilt!' : 'Teilen fehlgeschlagen.');
    if (ok) setTimeout(() => this.shareMessage.set(''), 2000);
  }

  // --- Account löschen (Danger Zone) ---

  readonly showDeleteAccountConfirm = signal(false);
  readonly deleteAccountConfirmText = signal('');
  readonly deleteAccountBusy = signal(false);
  readonly deleteAccountError = signal('');

  readonly canConfirmDeleteAccount = computed(
    () => this.deleteAccountConfirmText().trim() === 'LÖSCHEN'
  );

  openDeleteAccountConfirm(): void {
    this.showDeleteAccountConfirm.set(true);
    this.deleteAccountConfirmText.set('');
    this.deleteAccountError.set('');
  }

  closeDeleteAccountConfirm(): void {
    this.showDeleteAccountConfirm.set(false);
    this.deleteAccountConfirmText.set('');
    this.deleteAccountError.set('');
  }

  async confirmDeleteAccount(): Promise<void> {
    if (!this.canConfirmDeleteAccount()) return;

    this.deleteAccountBusy.set(true);
    this.deleteAccountError.set('');

    const result = await this.auth.deleteAccount();

    this.deleteAccountBusy.set(false);

    if (!result.success) {
      this.deleteAccountError.set(result.error ?? 'Unbekannter Fehler beim Löschen.');
      return;
    }
    // Erfolgreich: auth.currentUser() wird durch das signOut() in deleteAccount() null,
    // die App zeigt danach automatisch den Login-Screen.
  }
}