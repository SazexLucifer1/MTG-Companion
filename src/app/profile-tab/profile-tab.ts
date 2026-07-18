import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import QRCode from 'qrcode';
import { ProfileService } from '../profile.service';
import { MtgService } from '../mtg.service';
import { GroupService } from '../group.service';
import { DeckList } from '../deck-list/deck-list';
import { DeckService, CommanderGameStats, Deck } from '../deck.service';
import { AuthService } from '../auth.service';
import { BackgroundService } from '../background.service';
import { ScryfallService } from '../scryfall.service';

@Component({
  selector: 'app-profile-tab',
  imports: [FormsModule, DecimalPipe, DeckList],
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
  private readonly scryfall = inject(ScryfallService);

  readonly deckListRef = viewChild<DeckList>('deckListRef');

  readonly unassignedCommanderStats = signal<CommanderGameStats[]>([]);

  private async refreshUnassignedAndDecks(): Promise<void> {
    const userId = this.profileService.profile()?.id;
    if (!userId) return;
    this.unassignedCommanderStats.set(await this.deckService.getUnassignedCommanderStats(userId));
    await this.deckListRef()?.refreshDecks();
  }

  constructor() {
    effect(() => {
      const userId = this.profileService.profile()?.id;
      if (!userId) {
        this.unassignedCommanderStats.set([]);
        return;
      }
      this.deckService.getUnassignedCommanderStats(userId).then((stats) => {
        this.unassignedCommanderStats.set(stats);
        this.commanderPage.set(0);
      });
    });

    effect(() => {
      const names = this.profileService.profile()?.favoriteCommanders ?? [];
      if (names.length === 0) {
        this.favoriteCommanderImages.set({});
        return;
      }
      Promise.all(
        names.map((n) => this.scryfall.findCard(n).then((card) => [n, card?.imageUrl ?? null] as const))
      ).then((entries) => {
        this.favoriteCommanderImages.set(Object.fromEntries(entries));
      });
    });
  }

  // --- Top-3-Lieblings-Commander (füllt den sonst leeren Bereich neben Avatar/Gruppen) ---

  readonly favoriteCommanderImages = signal<Record<string, string | null>>({});

  readonly showFavoriteCommanderDialog = signal(false);
  readonly favoriteCommanderQuery = signal('');
  readonly favoriteCommanderSuggestions = signal<string[]>([]);
  readonly favoriteCommanderBusy = signal(false);
  private favoriteCommanderSearchTimer: ReturnType<typeof setTimeout> | null = null;

  openFavoriteCommanderDialog(): void {
    this.favoriteCommanderQuery.set('');
    this.favoriteCommanderSuggestions.set([]);
    this.showFavoriteCommanderDialog.set(true);
  }

  closeFavoriteCommanderDialog(): void {
    this.showFavoriteCommanderDialog.set(false);
  }

  onFavoriteCommanderSearchInput(value: string): void {
    this.favoriteCommanderQuery.set(value);
    if (this.favoriteCommanderSearchTimer) clearTimeout(this.favoriteCommanderSearchTimer);
    this.favoriteCommanderSearchTimer = setTimeout(async () => {
      this.favoriteCommanderSuggestions.set(await this.scryfall.autocomplete(value));
    }, 250);
  }

  async addFavoriteCommander(name: string): Promise<void> {
    const current = this.profileService.profile()?.favoriteCommanders ?? [];
    if (current.length >= 3 || current.includes(name)) return;

    this.favoriteCommanderBusy.set(true);
    await this.profileService.updateFavoriteCommanders([...current, name]);
    this.favoriteCommanderBusy.set(false);
    this.favoriteCommanderQuery.set('');
    this.favoriteCommanderSuggestions.set([]);
  }

  async removeFavoriteCommander(name: string): Promise<void> {
    const current = this.profileService.profile()?.favoriteCommanders ?? [];

    this.favoriteCommanderBusy.set(true);
    await this.profileService.updateFavoriteCommanders(current.filter((c) => c !== name));
    this.favoriteCommanderBusy.set(false);
  }

  // --- Suche/Sortierung/Seiten für "Commander ohne Deck" ---

  private static readonly PAGE_SIZE = 10;

  readonly commanderSearchQuery = signal('');
  readonly commanderSortMode = signal<'alpha' | 'winRate' | 'games'>('alpha');
  readonly commanderPage = signal(0);

  readonly filteredSortedCommanderStats = computed<CommanderGameStats[]>(() => {
    const query = this.commanderSearchQuery().trim().toLowerCase();
    let list = this.unassignedCommanderStats();
    if (query) {
      list = list.filter((c) => c.commander.toLowerCase().includes(query));
    }

    const mode = this.commanderSortMode();
    list = [...list];
    if (mode === 'alpha') {
      list.sort((a, b) => a.commander.localeCompare(b.commander));
    } else if (mode === 'winRate') {
      list.sort((a, b) => b.winRate - a.winRate || b.games - a.games);
    } else {
      list.sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    }
    return list;
  });

  readonly commanderTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredSortedCommanderStats().length / ProfileTab.PAGE_SIZE))
  );

  readonly pagedCommanderStats = computed<CommanderGameStats[]>(() => {
    const start = this.commanderPage() * ProfileTab.PAGE_SIZE;
    return this.filteredSortedCommanderStats().slice(start, start + ProfileTab.PAGE_SIZE);
  });

  readonly commanderPageRangeEnd = computed(() =>
    Math.min((this.commanderPage() + 1) * ProfileTab.PAGE_SIZE, this.filteredSortedCommanderStats().length)
  );

  setCommanderSearchQuery(value: string): void {
    this.commanderSearchQuery.set(value);
    this.commanderPage.set(0);
  }

  setCommanderSortMode(mode: 'alpha' | 'winRate' | 'games'): void {
    this.commanderSortMode.set(mode);
    this.commanderPage.set(0);
  }

  prevCommanderPage(): void {
    this.commanderPage.update((p) => Math.max(0, p - 1));
  }

  nextCommanderPage(): void {
    this.commanderPage.update((p) => Math.min(this.commanderTotalPages() - 1, p + 1));
  }

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

  readonly showRepairInfoDialog = signal(false);
  readonly repairBusy = signal(false);
  readonly repairProgress = signal<{ done: number; total: number } | null>(null);
  readonly repairMessage = signal('');

  openRepairInfoDialog(): void {
    this.repairMessage.set('');
    this.showRepairInfoDialog.set(true);
  }

  closeRepairInfoDialog(): void {
    this.showRepairInfoDialog.set(false);
  }

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
    await this.refreshUnassignedAndDecks();
  }

  // --- Manuell Commander <-> Deck verlinken/entlinken ---

  readonly showManualLinkDialog = signal(false);
  readonly myDecksForLinking = signal<Deck[]>([]);

  readonly linkCommanderChoice = signal('');
  readonly linkDeckChoice = signal('');
  readonly linkBusy = signal(false);
  readonly linkMessage = signal('');

  readonly unlinkDeckChoice = signal('');
  readonly unlinkBusy = signal(false);
  readonly unlinkMessage = signal('');

  async openManualLinkDialog(): Promise<void> {
    const userId = this.profileService.profile()?.id;
    if (!userId) return;

    this.linkCommanderChoice.set('');
    this.linkDeckChoice.set('');
    this.linkMessage.set('');
    this.unlinkDeckChoice.set('');
    this.unlinkMessage.set('');
    this.myDecksForLinking.set(await this.deckService.loadDecksForUser(userId));
    this.showManualLinkDialog.set(true);
  }

  closeManualLinkDialog(): void {
    this.showManualLinkDialog.set(false);
  }

  async confirmManualLink(): Promise<void> {
    const userId = this.profileService.profile()?.id;
    const commander = this.linkCommanderChoice();
    const deckId = this.linkDeckChoice();
    if (!userId || !commander || !deckId) return;

    this.linkBusy.set(true);
    this.linkMessage.set('');

    const ok = await this.deckService.linkCommanderToDeck(userId, commander, deckId);

    this.linkBusy.set(false);

    if (ok) {
      this.linkMessage.set('Verlinkt!');
      this.linkCommanderChoice.set('');
      this.linkDeckChoice.set('');
      await this.refreshUnassignedAndDecks();
    } else {
      this.linkMessage.set('Verlinken fehlgeschlagen.');
    }
  }

  async confirmManualUnlink(): Promise<void> {
    const userId = this.profileService.profile()?.id;
    const deckId = this.unlinkDeckChoice();
    if (!userId || !deckId) return;

    this.unlinkBusy.set(true);
    this.unlinkMessage.set('');

    const ok = await this.deckService.unlinkDeckMatches(userId, deckId);

    this.unlinkBusy.set(false);

    if (ok) {
      this.unlinkMessage.set('Verknüpfung gelöst!');
      this.unlinkDeckChoice.set('');
      await this.refreshUnassignedAndDecks();
    } else {
      this.unlinkMessage.set('Lösen fehlgeschlagen.');
    }
  }

  // --- Hintergrundbilder ---

  readonly showBackgroundsDialog = signal(false);

  openBackgroundsDialog(): void {
    this.showBackgroundsDialog.set(true);
  }

  closeBackgroundsDialog(): void {
    this.showBackgroundsDialog.set(false);
  }

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