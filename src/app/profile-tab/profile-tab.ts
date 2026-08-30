import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import QRCode from 'qrcode';
import { ProfileService } from '../profile.service';
import { MtgService } from '../mtg.service';
import { GroupService } from '../group.service';
import { DeckList } from '../deck-list/deck-list';
import { DeckService, CommanderGameStats, CrossGroupPersonalStats, DeckOwner } from '../deck.service';
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
import { CommanderStatList } from '../commander-stat-list/commander-stat-list';
import { FavoriteCommanderEditor } from '../favorite-commander-editor/favorite-commander-editor';

@Component({
  selector: 'app-profile-tab',
  imports: [FormsModule, DatePipe, DecimalPipe, DeckList, CardImage, CommanderStatList, FavoriteCommanderEditor],
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
  readonly ownCommanderListRef = viewChild<CommanderStatList>('ownCommanderListRef');
  readonly viewingCommanderListRef = viewChild<CommanderStatList>('viewingCommanderListRef');
  readonly viewingNpcCommanderListRef = viewChild<CommanderStatList>('viewingNpcCommanderListRef');

  /** Ob beim Ansehen eines FREMDEN Profils oder NPC-Profils die Statistiken (Deck-Winrates,
   * Platzierungsverteilung, Commander ohne Deck) ausgeblendet werden müssen, weil der Host dem
   * eingeloggten Viewer in der Sichtbarkeits-Matrix alle Modi gesperrt hat - der Host selbst ist
   * davon ausgenommen. */
  readonly othersStatsHidden = computed(
    () =>
      (!!this.profileService.viewingUserId() || !!this.profileService.viewingPlayerId()) &&
      this.mtg.allModesHiddenForMe() &&
      !this.groupService.isOwner()
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

  /** Deck-Besitzer für ein gerade angesehenes NPC-Profil (siehe viewNpcProfile in profile.service.ts). */
  readonly viewingNpcDeckOwner = computed<DeckOwner | null>(() => {
    const playerId = this.profileService.viewingPlayerId();
    return playerId ? { kind: 'player', playerId } : null;
  });

  /** Lieblingscommander des gerade angesehenen NPC-Profils (players.favorite_commanders, vom Host
   * gepflegt) - kommt direkt aus MtgService statt aus einem eigenen Ladevorgang, siehe
   * ProfileService.viewingPlayerId. */
  readonly viewingNpcFavoriteCommanders = computed<string[]>(() => {
    const name = this.profileService.viewingPlayerName();
    return name ? this.mtg.playerFavoriteCommanders()[name] ?? [] : [];
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
   * Gilt für das gerade angezeigte Profil (eigenes, ein fremder Account oder ein NPC).
   */
  readonly placementDistribution = computed<{ placement: number; count: number }[]>(() => {
    const npcName = this.profileService.viewingPlayerName();
    const userId = this.profileService.viewingUserId() ?? this.profileService.profile()?.id ?? null;
    const name = npcName ?? this.playerNameForUserId(userId);
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
  /** Gleiches wie viewingUnassignedCommanderStats, aber für ein gerade angesehenes NPC-Profil. */
  readonly viewingNpcUnassignedCommanderStats = signal<CommanderGameStats[]>([]);
  readonly npcFavoriteCommanderBusy = signal(false);

  /** Gesamt-Statistik über ALLE Gruppen des eigenen Accounts hinweg (siehe DeckService.getCrossGroupPersonalStats) -
   * bewusst nur fürs eigene Profil, nicht beim Ansehen eines fremden. Das Stats-Tab bleibt unverändert pro aktiver Gruppe. */
  readonly crossGroupStats = signal<CrossGroupPersonalStats | null>(null);

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
        this.ownCommanderListRef()?.reset();
      });
    });

    effect(() => {
      const userId = this.profileService.profile()?.id;
      if (!userId) {
        this.crossGroupStats.set(null);
        return;
      }
      this.deckService.getCrossGroupPersonalStats(userId).then((stats) => this.crossGroupStats.set(stats));
    });

    effect(() => {
      const userId = this.profileService.viewingUserId();
      if (!userId) {
        this.viewingUnassignedCommanderStats.set([]);
        return;
      }
      this.deckService.getUnassignedCommanderStats({ kind: 'user', userId }).then((stats) => {
        this.viewingUnassignedCommanderStats.set(stats);
        this.viewingCommanderListRef()?.reset();
      });
    });

    effect(() => {
      const playerId = this.profileService.viewingPlayerId();
      if (!playerId) {
        this.viewingNpcUnassignedCommanderStats.set([]);
        return;
      }
      this.deckService.getUnassignedCommanderStats({ kind: 'player', playerId }).then((stats) => {
        this.viewingNpcUnassignedCommanderStats.set(stats);
        this.viewingNpcCommanderListRef()?.reset();
      });
    });

    effect(() => {
      // Lädt Bilder für die eigenen, die eines gerade angesehenen fremden Accounts UND die eines
      // gerade angesehenen NPC-Profils - die Karte ist nach Namen (nicht nach Nutzer) geschlüsselt,
      // ein gemeinsamer Cache reicht also.
      const ownNames = this.profileService.profile()?.favoriteCommanders ?? [];
      const viewedNames = this.profileService.viewingProfile()?.favoriteCommanders ?? [];
      const npcNames = this.viewingNpcFavoriteCommanders();
      const names = [...new Set([...ownNames, ...viewedNames, ...npcNames])];
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
        ...this.unassignedCommanderStats().map((c) => c.commander),
        ...this.viewingUnassignedCommanderStats().map((c) => c.commander),
        ...this.viewingNpcUnassignedCommanderStats().map((c) => c.commander),
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

  /** Als gebundene Arrow-Function-Property statt Methode gehalten, damit sie unverändert als
   * Input an app-commander-stat-list durchgereicht werden kann (eine normale Methode würde dabei
   * ihren this-Bezug verlieren). */
  readonly commanderImage = (name: string | undefined): string | null => {
    if (!name) return null;
    return this.commanderCards()[name.toLowerCase()]?.imageUrl ?? null;
  };

  readonly commanderBackImage = (name: string | undefined): string | null => {
    if (!name) return null;
    return this.commanderCards()[name.toLowerCase()]?.backImageUrl ?? null;
  };

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
  readonly favoriteCommanderBusy = signal(false);

  openFavoriteCommanderDialog(): void {
    this.showFavoriteCommanderDialog.set(true);
  }

  closeFavoriteCommanderDialog(): void {
    this.showFavoriteCommanderDialog.set(false);
  }

  /** Als gebundene Arrow-Function-Properties gehalten, damit sie unverändert als onAdd/onRemove-
   * Inputs an app-favorite-commander-editor durchgereicht werden können. */
  readonly addFavoriteCommander = async (name: string): Promise<void> => {
    const current = this.profileService.profile()?.favoriteCommanders ?? [];
    if (current.length >= 3 || current.includes(name)) return;

    this.favoriteCommanderBusy.set(true);
    await this.profileService.updateFavoriteCommanders([...current, name]);
    this.favoriteCommanderBusy.set(false);
  };

  readonly removeFavoriteCommander = async (name: string): Promise<void> => {
    const current = this.profileService.profile()?.favoriteCommanders ?? [];

    this.favoriteCommanderBusy.set(true);
    await this.profileService.updateFavoriteCommanders(current.filter((c) => c !== name));
    this.favoriteCommanderBusy.set(false);
  };

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

  // --- Lieblingscommander eines gerade angesehenen NPC-Profils (nur Host, siehe group-tab.ts
  // openNpcProfileView) - gleiche Logik wie oben fürs eigene Profil, nur gegen
  // MtgService.setPlayerFavoriteCommanders statt ProfileService.updateFavoriteCommanders. ---

  readonly addNpcFavoriteCommander = async (name: string): Promise<void> => {
    const playerName = this.profileService.viewingPlayerName();
    if (!playerName) return;
    const current = this.viewingNpcFavoriteCommanders();
    if (current.length >= 3 || current.includes(name)) return;

    this.npcFavoriteCommanderBusy.set(true);
    await this.mtg.setPlayerFavoriteCommanders(playerName, [...current, name]);
    this.npcFavoriteCommanderBusy.set(false);
  };

  readonly removeNpcFavoriteCommander = async (name: string): Promise<void> => {
    const playerName = this.profileService.viewingPlayerName();
    if (!playerName) return;
    const current = this.viewingNpcFavoriteCommanders();

    this.npcFavoriteCommanderBusy.set(true);
    await this.mtg.setPlayerFavoriteCommanders(
      playerName,
      current.filter((c) => c !== name)
    );
    this.npcFavoriteCommanderBusy.set(false);
  };

  readonly canAutofillNpcFavoriteCommanders = computed(() => {
    const name = this.profileService.viewingPlayerName();
    const current = this.viewingNpcFavoriteCommanders();
    if (!name || current.length >= 3) return false;
    return this.topPlayedCommanders(name, 3).some((c) => !current.includes(c));
  });

  async autofillNpcFavoriteCommanders(): Promise<void> {
    const name = this.profileService.viewingPlayerName();
    if (!name || this.npcFavoriteCommanderBusy()) return;

    const current = this.viewingNpcFavoriteCommanders();
    const remaining = 3 - current.length;
    if (remaining <= 0) return;

    const additions = this.topPlayedCommanders(name, current.length + remaining)
      .filter((c) => !current.includes(c))
      .slice(0, remaining);
    if (additions.length === 0) return;

    this.npcFavoriteCommanderBusy.set(true);
    await this.mtg.setPlayerFavoriteCommanders(name, [...current, ...additions]);
    this.npcFavoriteCommanderBusy.set(false);
  }

  /**
   * Vereinheitlicht die Lieblingscommander-Bindings für den Bearbeiten-Dialog, je nachdem ob
   * gerade das eigene Profil oder ein NPC-Profil offen ist - hält das Template frei von Ternaries
   * an jeder einzelnen Stelle im Dialog.
   */
  readonly favoriteCommandersDialogTarget = computed(() => {
    if (this.profileService.viewingPlayerId()) {
      return {
        isNpc: true as const,
        favorites: this.viewingNpcFavoriteCommanders(),
        busy: this.npcFavoriteCommanderBusy(),
        canAutofill: this.canAutofillNpcFavoriteCommanders(),
        onAdd: this.addNpcFavoriteCommander,
        onRemove: this.removeNpcFavoriteCommander,
        onAutofill: () => this.autofillNpcFavoriteCommanders(),
      };
    }
    return {
      isNpc: false as const,
      favorites: this.profileService.profile()?.favoriteCommanders ?? [],
      busy: this.favoriteCommanderBusy(),
      canAutofill: this.canAutofillFavoriteCommanders(),
      onAdd: this.addFavoriteCommander,
      onRemove: this.removeFavoriteCommander,
      onAutofill: () => this.autofillFavoriteCommanders(),
    };
  });

  readonly editedName = signal('');
  readonly isEditing = signal(false);
  readonly saveMessage = signal('');

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
    /** Host repariert beim Ansehen eines FREMDEN Profils oder NPC-Profils dessen Decks, sonst geht's um den eigenen Account. */
    const viewingPlayerId = this.profileService.viewingPlayerId();
    const viewingUserId = this.profileService.viewingUserId();
    const owner: DeckOwner | null = viewingPlayerId
      ? { kind: 'player', playerId: viewingPlayerId }
      : this.resolveUserOwner(viewingUserId);
    if (!owner) return;

    this.repairBusy.set(true);
    this.repairMessage.set('');
    this.repairProgress.set({ done: 0, total: 0 });

    const result = await this.deckService.repairCommanderNames(owner, (done, total) =>
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

    if (viewingPlayerId) {
      this.viewingNpcUnassignedCommanderStats.set(await this.deckService.getUnassignedCommanderStats(owner));
    } else if (viewingUserId) {
      this.viewingUnassignedCommanderStats.set(await this.deckService.getUnassignedCommanderStats(owner));
    } else {
      await this.refreshUnassignedAndDecks();
    }
  }

  /** null nur, wenn weder ein fremder Account angesehen wird noch überhaupt ein Account eingeloggt ist (sollte im Profil-Tab praktisch nie vorkommen). */
  private resolveUserOwner(viewingUserId: string | null): DeckOwner | null {
    const userId = viewingUserId ?? this.auth.currentUser()?.id;
    return userId ? { kind: 'user', userId } : null;
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

  /** Für den Host, der beim Ansehen eines NPC-Profils dessen Alt-Spiele nachträglich verlinkt. */
  async openManualLinkDialogForNpc(playerId: string): Promise<void> {
    const owner: DeckOwner = { kind: 'player', playerId };
    await this.manualDeckLink.open(owner, async () => {
      this.viewingNpcUnassignedCommanderStats.set(await this.deckService.getUnassignedCommanderStats(owner));
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
    link.download = `statsfinity-daten-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- Account löschen (Danger Zone) ---

  readonly showDeleteAccountConfirm = signal(false);
  readonly deleteAccountConfirmText = signal('');
  readonly deleteAccountBusy = signal(false);
  readonly deleteAccountError = signal('');

  readonly canConfirmDeleteAccount = computed(() => this.i18n.isDeleteConfirmed(this.deleteAccountConfirmText()));

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