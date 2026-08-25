import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import QRCode from 'qrcode';
import { ProfileService } from '../profile.service';
import { MtgService } from '../mtg.service';
import { GroupService } from '../group.service';
import { DeckList } from '../deck-list/deck-list';
import { DeckService, CommanderGameStats, DeckOwner } from '../deck.service';
import { ManualDeckLinkService } from '../manual-deck-link.service';
import { CardPreviewService } from '../card-preview.service';
import { AuthService } from '../auth.service';
import { BackgroundService } from '../background.service';
import { ScryfallCard, ScryfallService } from '../scryfall.service';
import { I18nService } from '../i18n.service';
import { TutorialService } from '../tutorial.service';
import { FeedbackService } from '../feedback.service';
import { DialogService } from '../dialog.service';
import { CardImage } from '../card-image/card-image';

@Component({
  selector: 'app-profile-tab',
  imports: [FormsModule, DecimalPipe, DatePipe, DeckList, CardImage],
  templateUrl: './profile-tab.html',
  styleUrl: './profile-tab.scss',
})
export class ProfileTab {
  readonly profileService = inject(ProfileService);
  readonly mtg = inject(MtgService);
  readonly groupService = inject(GroupService);
  private readonly deckService = inject(DeckService);
  readonly manualDeckLink = inject(ManualDeckLinkService);
  readonly cardPreview = inject(CardPreviewService);
  private readonly auth = inject(AuthService);
  readonly backgrounds = inject(BackgroundService);
  private readonly scryfall = inject(ScryfallService);
  readonly i18n = inject(I18nService);
  readonly tutorial = inject(TutorialService);
  readonly feedback = inject(FeedbackService);
  private readonly dialog = inject(DialogService);

  readonly deckListRef = viewChild<DeckList>('deckListRef');

  /** Ob beim Ansehen eines FREMDEN Profils die Statistiken (Deck-Winrates, Platzierungsverteilung, Commander ohne Deck) wegen einer aktiven Gruppen-Sperre ausgeblendet werden müssen - der Host ist davon ausgenommen. */
  readonly othersStatsHidden = computed(
    () => !!this.profileService.viewingUserId() && this.groupService.statsLocked() && !this.groupService.isOwner()
  );

  /** Als computed() statt eines Inline-Objektliterals im Template gehalten - sonst würde bei jedem
   * Change-Detection-Durchlauf ein neues Objekt entstehen und der owner-Input von DeckList (ein
   * Signal-Input) bei jedem Tick als "geändert" gelten, was den internen Lade-Effect dort in eine
   * Dauerschleife von Deck-Neuladungen schickt. */
  readonly ownDeckOwner = computed<DeckOwner | null>(() => {
    const userId = this.profileService.profile()?.id;
    return userId ? { kind: 'user', userId } : null;
  });

  readonly viewingDeckOwner = computed<DeckOwner | null>(() => {
    const userId = this.profileService.viewingUserId();
    return userId ? { kind: 'user', userId } : null;
  });

  /** Findet den Spielernamen (mtg.playerUserIds ist name-indiziert) zu einer Account-User-ID, oder null ohne Zuordnung. */
  private playerNameForUserId(userId: string | null): string | null {
    if (!userId) return null;
    const entry = Object.entries(this.mtg.playerUserIds()).find(([, uid]) => uid === userId);
    return entry?.[0] ?? null;
  }

  /**
   * Wie oft welcher Platz (1., 2., ...) erreicht wurde - nur Matches mit eingetragener
   * Platzierung zählen mit (rein optionale Zusatz-Info, siehe models.ts MatchPlayer.placement).
   * Gilt für das gerade angezeigte Profil (eigenes oder fremdes, je nach viewingUserId).
   */
  readonly placementDistribution = computed<{ placement: number; count: number }[]>(() => {
    const userId = this.profileService.viewingUserId() ?? this.profileService.profile()?.id ?? null;
    const name = this.playerNameForUserId(userId);
    if (!name) return [];

    const counts = new Map<number, number>();
    for (const match of this.mtg.history()) {
      if (match.countsInGeneralStats === false) continue;
      const placement = match.players.find((p) => p.name === name)?.placement;
      if (placement != null) counts.set(placement, (counts.get(placement) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([placement, count]) => ({ placement, count }));
  });

  readonly unassignedCommanderStats = signal<CommanderGameStats[]>([]);
  /** Gleiches wie unassignedCommanderStats, aber für ein FREMDES Profil - rein zum Ansehen, ohne Reparieren/Verlinken (das kann nur der Account-Besitzer selbst). */
  readonly viewingUnassignedCommanderStats = signal<CommanderGameStats[]>([]);

  private async refreshUnassignedAndDecks(): Promise<void> {
    const userId = this.profileService.profile()?.id;
    if (!userId) return;
    this.unassignedCommanderStats.set(
      await this.deckService.getUnassignedCommanderStats({ kind: 'user', userId })
    );
    await this.deckListRef()?.refreshDecks();
  }

  constructor() {
    effect(() => {
      const userId = this.profileService.profile()?.id;
      if (!userId) {
        this.unassignedCommanderStats.set([]);
        return;
      }
      this.deckService.getUnassignedCommanderStats({ kind: 'user', userId }).then((stats) => {
        this.unassignedCommanderStats.set(stats);
        this.commanderPage.set(0);
      });
    });

    effect(() => {
      const userId = this.profileService.viewingUserId();
      if (!userId) {
        this.viewingUnassignedCommanderStats.set([]);
        return;
      }
      this.deckService.getUnassignedCommanderStats({ kind: 'user', userId }).then((stats) => {
        this.viewingUnassignedCommanderStats.set(stats);
        this.viewingCommanderSearchQuery.set('');
        this.viewingCommanderSortMode.set('alpha');
        this.viewingCommanderPage.set(0);
      });
    });

    effect(() => {
      // Lädt Bilder sowohl für die eigenen als auch für die eines gerade angesehenen fremden Profils -
      // die Karte ist nach Namen (nicht nach Nutzer) geschlüsselt, ein gemeinsamer Cache reicht also.
      const ownNames = this.profileService.profile()?.favoriteCommanders ?? [];
      const viewedNames = this.profileService.viewingProfile()?.favoriteCommanders ?? [];
      const names = [...new Set([...ownNames, ...viewedNames])];
      if (names.length === 0) {
        this.favoriteCommanderCards.set({});
        return;
      }
      Promise.all(names.map((n) => this.scryfall.findCard(n).then((card) => [n, card] as const))).then((entries) => {
        this.favoriteCommanderCards.set(Object.fromEntries(entries));
      });
    });

    effect(() => {
      const names = [
        ...this.pagedCommanderStats().map((c) => c.commander),
        ...this.viewingUnassignedCommanderStats().map((c) => c.commander),
      ];
      const cache = this.commanderCards();
      const missing = [...new Set(names)].filter((n) => !(n.toLowerCase() in cache));
      if (missing.length === 0) return;

      this.scryfall.findCardsBulk(missing).then((found) => {
        this.commanderCards.update((current) => {
          const next = { ...current };
          for (const name of missing) {
            next[name.toLowerCase()] = found.get(name.toLowerCase()) ?? null;
          }
          return next;
        });
      });
    });

    // Lädt die Feedback-Eingänge einmalig nach, sobald erkannt wird, dass der Account App-Admin ist.
    let feedbackLoadTriggered = false;
    effect(() => {
      if (!this.profileService.profile()?.isAppAdmin || feedbackLoadTriggered) return;
      feedbackLoadTriggered = true;
      this.feedback.loadEntries();
    });
  }

  /** Kartenname (lowercase) -> Scryfall-Daten oder null (nicht gefunden), für die "Commander ohne Deck"-Liste. */
  private readonly commanderCards = signal<Record<string, ScryfallCard | null>>({});

  commanderImage(name: string | undefined): string | null {
    if (!name) return null;
    return this.commanderCards()[name.toLowerCase()]?.imageUrl ?? null;
  }

  commanderBackImage(name: string | undefined): string | null {
    if (!name) return null;
    return this.commanderCards()[name.toLowerCase()]?.backImageUrl ?? null;
  }

  /** Öffnet die große Kartenvorschau für einen Lieblingscommander (fremdes Profil - beim eigenen
   * öffnet der Klick stattdessen den Bearbeiten-Dialog, siehe openFavoriteCommanderDialog()). */
  openFavoriteCommanderPreview(name: string): void {
    const card = this.favoriteCommanderCards()[name];
    if (!card?.imageUrl) return;
    this.cardPreview.open(card.imageUrl, card.backImageUrl, name);
  }

  /** Feedback-Einträge für die Admin-Ansicht - "erledigt" standardmäßig ausgeblendet. */
  readonly visibleFeedbackEntries = computed(() =>
    this.feedback.showDoneEntries()
      ? this.feedback.entries()
      : this.feedback.entries().filter((e) => e.status === 'open')
  );

  // --- Top-3-Lieblings-Commander (füllt den sonst leeren Bereich neben Avatar/Gruppen) ---

  readonly favoriteCommanderCards = signal<Record<string, ScryfallCard | null>>({});

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

  /** Meistgespielte Commander (Hauptcommander, Partner zählt nicht mit) dieser Person, absteigend - respektiert countsInGeneralStats wie der Rest der Statistik. */
  private topPlayedCommanders(playerName: string, limit: number): string[] {
    const counts = new Map<string, number>();
    for (const match of this.mtg.history()) {
      if (match.countsInGeneralStats === false) continue;
      const commander = match.players.find((p) => p.name === playerName)?.commander;
      if (commander) counts.set(commander, (counts.get(commander) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, limit);
  }

  readonly canAutofillFavoriteCommanders = computed(() => {
    const name = this.mtg.myPlayerName();
    const current = this.profileService.profile()?.favoriteCommanders ?? [];
    if (!name || current.length >= 3) return false;
    return this.topPlayedCommanders(name, 3).some((c) => !current.includes(c));
  });

  /** Füllt die restlichen freien Lieblings-Commander-Plätze mit den meistgespielten Commandern dieser Person auf - für alle, die die Liste nicht von Hand befüllen wollen. */
  async autofillFavoriteCommanders(): Promise<void> {
    const name = this.mtg.myPlayerName();
    if (!name || this.favoriteCommanderBusy()) return;

    const current = this.profileService.profile()?.favoriteCommanders ?? [];
    const remaining = 3 - current.length;
    if (remaining <= 0) return;

    const additions = this.topPlayedCommanders(name, current.length + remaining)
      .filter((c) => !current.includes(c))
      .slice(0, remaining);
    if (additions.length === 0) return;

    this.favoriteCommanderBusy.set(true);
    await this.profileService.updateFavoriteCommanders([...current, ...additions]);
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

  // --- Gleiches wie oben, aber für die Commander-Statistik eines FREMDEN Profils - eigene Signale,
  // damit Suche/Sortierung/Seite dort unabhängig vom eigenen Profil bleiben. ---

  readonly viewingCommanderSearchQuery = signal('');
  readonly viewingCommanderSortMode = signal<'alpha' | 'winRate' | 'games'>('alpha');
  readonly viewingCommanderPage = signal(0);

  readonly filteredSortedViewingCommanderStats = computed<CommanderGameStats[]>(() => {
    const query = this.viewingCommanderSearchQuery().trim().toLowerCase();
    let list = this.viewingUnassignedCommanderStats();
    if (query) {
      list = list.filter((c) => c.commander.toLowerCase().includes(query));
    }

    const mode = this.viewingCommanderSortMode();
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

  readonly viewingCommanderTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredSortedViewingCommanderStats().length / ProfileTab.PAGE_SIZE))
  );

  readonly pagedViewingCommanderStats = computed<CommanderGameStats[]>(() => {
    const start = this.viewingCommanderPage() * ProfileTab.PAGE_SIZE;
    return this.filteredSortedViewingCommanderStats().slice(start, start + ProfileTab.PAGE_SIZE);
  });

  readonly viewingCommanderPageRangeEnd = computed(() =>
    Math.min((this.viewingCommanderPage() + 1) * ProfileTab.PAGE_SIZE, this.filteredSortedViewingCommanderStats().length)
  );

  setViewingCommanderSearchQuery(value: string): void {
    this.viewingCommanderSearchQuery.set(value);
    this.viewingCommanderPage.set(0);
  }

  setViewingCommanderSortMode(mode: 'alpha' | 'winRate' | 'games'): void {
    this.viewingCommanderSortMode.set(mode);
    this.viewingCommanderPage.set(0);
  }

  prevViewingCommanderPage(): void {
    this.viewingCommanderPage.update((p) => Math.max(0, p - 1));
  }

  nextViewingCommanderPage(): void {
    this.viewingCommanderPage.update((p) => Math.min(this.viewingCommanderTotalPages() - 1, p + 1));
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
      this.saveMessage.set(this.i18n.t('profile.msg.nameSaved'));
      setTimeout(() => this.saveMessage.set(''), 2000);
    } else {
      this.saveMessage.set(this.i18n.t('profile.msg.nameSaveFailed'));
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
      this.avatarError.set(this.i18n.t('profile.msg.pleaseSelectImage'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.avatarError.set(this.i18n.t('profile.msg.avatarTooLarge'));
      return;
    }

    this.avatarError.set('');
    this.avatarUploading.set(true);
    const success = await this.profileService.uploadAvatar(file);
    this.avatarUploading.set(false);

    if (!success) {
      this.avatarError.set(this.i18n.t('profile.msg.avatarUploadFailed'));
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

    const result = await this.deckService.repairCommanderNames({ kind: 'user', userId }, (done, total) =>
      this.repairProgress.set({ done, total })
    );

    this.repairBusy.set(false);
    this.repairProgress.set(null);
    this.repairMessage.set(
      result.checked === 0
        ? this.i18n.t('profile.msg.repairNothingToCheck')
        : this.i18n.t('profile.msg.repairDone', {
            checked: result.checked,
            fixed: result.fixed,
            linked: result.linked,
          })
    );
    await this.refreshUnassignedAndDecks();
  }

  // --- Manuell Commander <-> Deck verlinken/entlinken (Dialog + Logik in ManualDeckLinkService) ---

  async openManualLinkDialog(): Promise<void> {
    const userId = this.profileService.profile()?.id;
    if (!userId) return;
    await this.manualDeckLink.open({ kind: 'user', userId }, () => this.refreshUnassignedAndDecks());
  }

  /** Für den Admin, der beim Ansehen eines FREMDEN Profils Alt-Spiele dieser Person nachträglich verlinkt. */
  async openManualLinkDialogFor(viewingUserId: string): Promise<void> {
    const owner: DeckOwner = { kind: 'user', userId: viewingUserId };
    await this.manualDeckLink.open(owner, async () => {
      this.viewingUnassignedCommanderStats.set(await this.deckService.getUnassignedCommanderStats(owner));
    });
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
    if (await this.dialog.confirm(this.i18n.t('profile.msg.confirmDeleteBackground'))) {
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
    this.shareMessage.set(ok ? this.i18n.t('profile.msg.shared') : this.i18n.t('profile.msg.shareFailed'));
    if (ok) setTimeout(() => this.shareMessage.set(''), 2000);
  }

  // --- Datenexport (Art. 20 DSGVO) ---

  readonly exportBusy = signal(false);

  async downloadMyData(): Promise<void> {
    this.exportBusy.set(true);
    const data = await this.profileService.exportMyData();
    this.exportBusy.set(false);

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mtg-companion-daten-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- Account löschen (Danger Zone) ---

  readonly showDeleteAccountConfirm = signal(false);
  readonly deleteAccountConfirmText = signal('');
  readonly deleteAccountBusy = signal(false);
  readonly deleteAccountError = signal('');

  readonly canConfirmDeleteAccount = computed(
    () => this.deleteAccountConfirmText().trim().toUpperCase() === this.i18n.t('stats.deleteConfirmWord')
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
      this.deleteAccountError.set(this.i18n.t('stats.msg.unknownDeleteError'));
      return;
    }
    // Erfolgreich: auth.currentUser() wird durch das signOut() in deleteAccount() null,
    // die App zeigt danach automatisch den Login-Screen.
  }
}