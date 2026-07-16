import { AfterViewInit, Component, ElementRef, OnDestroy, QueryList, ViewChildren, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { GameSessionService, IngameUnit } from '../game-session.service';
import { MtgService } from '../mtg.service';
import { BackgroundService } from '../background.service';
import { AuthService } from '../auth.service';
import { TEAM_OPTIONS } from '../models';

@Component({
  selector: 'app-ingame-tracker',
  imports: [CommonModule],
  templateUrl: './ingame-tracker.html',
  styleUrl: './ingame-tracker.scss',
})
export class IngameTracker implements AfterViewInit, OnDestroy {
  readonly session = inject(GameSessionService);
  readonly mtg = inject(MtgService);
  readonly backgrounds = inject(BackgroundService);
  private readonly auth = inject(AuthService);
  readonly teamOptions = TEAM_OPTIONS;

  readonly backgroundPickerFor = signal<string | null>(null);

  openBackgroundPicker(player: string): void {
    this.backgroundPickerFor.set(player);
    this.backgrounds.ensureLoaded();
  }

  closeBackgroundPicker(): void {
    this.backgroundPickerFor.set(null);
  }

  selectBackground(player: string, url: string | null): void {
    this.mtg.setPlayerBackground(player, url);
    this.closeBackgroundPicker();
  }

  readonly brokenBackgrounds = signal<Set<string>>(new Set());

  markBackgroundBroken(url: string): void {
    this.brokenBackgrounds.update((set) => {
      const next = new Set(set);
      next.add(url);
      return next;
    });
    console.warn(`Hintergrundbild nicht gefunden (404?): ${url}`);
  }

  async onBackgroundFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.backgrounds.uploadBackground(file);
  }

  isOwnUpload(uploadedBy: string): boolean {
    return uploadedBy === this.auth.currentUser()?.id;
  }

  async deleteCustomBackground(event: Event, id: string): Promise<void> {
    event.stopPropagation();
    if (confirm('Diesen hochgeladenen Hintergrund für die ganze Gruppe löschen?')) {
      await this.backgrounds.deleteCustomBackground(id);
    }
  }

  // --- Zentrales Options-Menü: ersetzt den alten Minimieren-Button (oben) und
  // den Spiel-beenden-Button (unten) durch einen einzigen Button in der Mitte. ---

  readonly showOptionsMenu = signal(false);

  openOptionsMenu(): void {
    this.showOptionsMenu.set(true);
  }

  closeOptionsMenu(): void {
    this.showOptionsMenu.set(false);
  }

  chooseMinimize(): void {
    this.showOptionsMenu.set(false);
    this.session.minimizeGame();
  }

  chooseEndGame(): void {
    this.showOptionsMenu.set(false);
    this.session.showWinnerPanel.set(true);
  }

  // --- Spieler neu anordnen: Tippen-zum-Tauschen-Modus ---

  readonly reorderMode = signal(false);
  readonly reorderFirstKey = signal<string | null>(null);

  openReorderMode(): void {
    this.showOptionsMenu.set(false);
    this.reorderMode.set(true);
    this.reorderFirstKey.set(null);
  }

  closeReorderMode(): void {
    this.reorderMode.set(false);
    this.reorderFirstKey.set(null);
  }

  selectForReorder(key: string): void {
    const first = this.reorderFirstKey();
    if (!first) {
      this.reorderFirstKey.set(key);
      return;
    }
    if (first === key) {
      this.reorderFirstKey.set(null);
      return;
    }
    this.session.swapUnits(first, key);
    this.reorderFirstKey.set(null);
  }

  // --- Longpress auf einen Panel-Namen: Menü zum freien Anheften des
  // Sonderslots unten (quer liegend bei ungerader Panel-Anzahl). ---

  readonly pinMenuFor = signal<string | null>(null);
  private pinLongPressTimer: ReturnType<typeof setTimeout> | null = null;

  startPinLongPress(key: string): void {
    this.cancelPinLongPress();
    this.pinLongPressTimer = setTimeout(() => {
      this.pinMenuFor.set(key);
      this.pinLongPressTimer = null;
    }, 550);
  }

  cancelPinLongPress(): void {
    if (this.pinLongPressTimer) {
      clearTimeout(this.pinLongPressTimer);
      this.pinLongPressTimer = null;
    }
  }

  closePinMenu(): void {
    this.pinMenuFor.set(null);
  }

  pinToBottom(key: string): void {
    this.session.setPinnedBottomKey(key);
    this.closePinMenu();
  }

  resetPinnedBottom(): void {
    this.session.setPinnedBottomKey(null);
    this.closePinMenu();
  }

  /** Ist dieser Index gerade der Sonderslot unten (volle Breite, quer)? */
  isBottomSpecialSlot(index: number): boolean {
    return this.session.hasOddBottomSlot() && index === this.session.ingameUnits().length - 1;
  }

  // NEU
  // --- Startspieler-Roulette: durchläuft alle Panel-Einheiten mehrfach
  // (schnell, wird zum Ende hin langsamer) und landet zufällig auf einer. ---

  readonly showRouletteOverlay = signal(false);
  readonly rouletteHighlightKey = signal<string | null>(null);
  readonly rouletteResultUnit = signal<IngameUnit | null>(null);
  private rouletteTimeout: ReturnType<typeof setTimeout> | null = null;

  // NEU
  startPlayerRoulette(): void {
    this.showOptionsMenu.set(false);
    const units = this.session.ingameUnits();
    if (units.length === 0) return;

    this.rouletteResultUnit.set(null);
    this.showRouletteOverlay.set(true);

    const finalIndex = Math.floor(Math.random() * units.length);
    // totalSteps so gewählt, dass der LETZTE Loop-Durchlauf (step = totalSteps - 1)
    // bereits exakt bei finalIndex landet – kein Nachkorrigieren am Ende nötig,
    // das Ergebnis entspricht immer genau der zuletzt angezeigten Ecke.
    const rounds = 3; // Mindestanzahl voller Umdrehungen vor dem Stopp
    const totalSteps = units.length * rounds + finalIndex + 1;
    let step = 0;

    const tick = (): void => {
      const currentIndex = step % units.length;
      this.rouletteHighlightKey.set(units[currentIndex].key);
      step++;

      if (step >= totalSteps) {
        this.rouletteResultUnit.set(units[currentIndex]);
        return;
      }

      const progress = step / totalSteps;
      const delay = 60 + Math.pow(progress, 3) * 340; // startet bei ~60ms, endet bei ~400ms
      this.rouletteTimeout = setTimeout(tick, delay);
    };

    tick();
  }

  closeRouletteOverlay(): void {
    if (this.rouletteTimeout) clearTimeout(this.rouletteTimeout);
    this.rouletteTimeout = null;
    this.showRouletteOverlay.set(false);
    this.rouletteHighlightKey.set(null);
    this.rouletteResultUnit.set(null);
  }

  @ViewChildren('panelRef') private panelRefs!: QueryList<ElementRef<HTMLDivElement>>;
  private resizeObserver: ResizeObserver | null = null;
  private panelRefsSub: Subscription | null = null;

  /** Tatsächliche Pixelgröße jeder Panel-Zelle, live gemessen – passt sich jeder Bildschirmgröße automatisch an. */
  readonly panelSizes = signal<Record<number, { width: number; height: number }>>({});

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      this.panelSizes.update((sizes) => {
        const next = { ...sizes };
        for (const entry of entries) {
          const indexAttr = (entry.target as HTMLElement).dataset['panelIndex'];
          if (indexAttr === undefined) continue;
          next[Number(indexAttr)] = { width: entry.contentRect.width, height: entry.contentRect.height };
        }
        return next;
      });
    });

    this.observeCurrentPanels();
    this.panelRefsSub = this.panelRefs.changes.subscribe(() => this.observeCurrentPanels());
  }

  private readonly iconCornerMap: Record<number, string> = {
    0: 'corner-tl',
    180: 'corner-br',
    90: 'corner-bl',
    [-90]: 'corner-tr',
  };

  iconPairCorner(index: number): string {
    const cols = this.session.ingameColumns();
    const row = Math.floor(index / cols);
    const col = index % cols;
    const isTopRight = (row + col) % 2 !== 0;
    return isTopRight ? 'corner-tr' : 'corner-tl';
  }

  iconPairDirection(_index: number): string {
    return 'column';
  }

  private observeCurrentPanels(): void {
    if (!this.resizeObserver) return;
    this.resizeObserver.disconnect();
    this.panelRefs.forEach((ref) => this.resizeObserver!.observe(ref.nativeElement));
  }

  panelInnerWidth(index: number): string {
    const size = this.panelSizes()[index];
    if (!size) return '100%';
    const rotated = Math.abs(this.session.panelRotation(index)) === 90;
    return `${rotated ? size.height : size.width}px`;
  }

  panelInnerHeight(index: number): string {
    const size = this.panelSizes()[index];
    if (!size) return '100%';
    const rotated = Math.abs(this.session.panelRotation(index)) === 90;
    return `${rotated ? size.width : size.height}px`;
  }

  // --- Press-and-Hold: sofort 1 Schritt, nach 400ms Wiederholung, ab 2s Schrittgröße 10 ---

  private readonly activeHolds = new Map<string, { timeout?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval>; startedAt: number }>();

  private startHold(key: string, action: (step: number) => void): void {
    if (this.activeHolds.has(key)) return;
    action(1);

    const state: { timeout?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval>; startedAt: number } = {
      startedAt: Date.now(),
    };
    state.timeout = setTimeout(() => {
      state.interval = setInterval(() => {
        const heldFor = Date.now() - state.startedAt;
        action(heldFor > 2000 ? 10 : 1);
      }, 150);
    }, 400);

    this.activeHolds.set(key, state);
  }

  private stopHold(key: string): void {
    const state = this.activeHolds.get(key);
    if (!state) return;
    if (state.timeout) clearTimeout(state.timeout);
    if (state.interval) clearInterval(state.interval);
    this.activeHolds.delete(key);
  }

  private stopAllHolds(): void {
    for (const key of [...this.activeHolds.keys()]) {
      this.stopHold(key);
    }
  }

  startLifeHold(player: string, sign: 1 | -1): void {
    this.startHold(`life-${player}-${sign}`, (step) => this.session.adjustLife(player, sign * step));
  }
  stopLifeHold(player: string, sign: 1 | -1): void {
    this.stopHold(`life-${player}-${sign}`);
  }

  startCommanderDamageHold(target: string, sourceKey: string, sign: 1 | -1): void {
    this.startHold(`cd-${target}-${sourceKey}-${sign}`, (step) => this.session.adjustCommanderDamage(target, sourceKey, sign * step));
  }
  stopCommanderDamageHold(target: string, sourceKey: string, sign: 1 | -1): void {
    this.stopHold(`cd-${target}-${sourceKey}-${sign}`);
  }

  startPoisonHold(player: string, sign: 1 | -1): void {
    this.startHold(`poison-${player}-${sign}`, (step) => this.session.adjustPoison(player, sign * step));
  }
  stopPoisonHold(player: string, sign: 1 | -1): void {
    this.stopHold(`poison-${player}-${sign}`);
  }

  ngOnDestroy(): void {
    this.stopAllHolds();
    this.cancelPinLongPress();
    if (this.rouletteTimeout) clearTimeout(this.rouletteTimeout); // NEU
    this.resizeObserver?.disconnect();
    this.panelRefsSub?.unsubscribe();
  }

  finishGame(): void {
    if (!this.session.canSave()) return;
    this.stopAllHolds();
    this.session.saveAndReset();
  }

  discardGame(): void {
    const confirmed = confirm(
      'Spiel wirklich ohne Speichern schließen? Lebenspunkte, Commander-Schaden und Gift-Marken gehen dabei verloren.',
    );
    if (!confirmed) return;

    this.stopAllHolds();
    this.session.discardAndReset();
  }
}