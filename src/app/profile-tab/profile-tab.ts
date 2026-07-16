import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import QRCode from 'qrcode';
import { ProfileService } from '../profile.service';
import { MtgService } from '../mtg.service';
import { GroupService } from '../group.service';
import { DeckList } from '../deck-list/deck-list';

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
}