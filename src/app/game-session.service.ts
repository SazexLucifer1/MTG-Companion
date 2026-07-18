// NEU (komplette Datei)
import { Injectable, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { GameMode, MatchPlayer, TEAM_OPTIONS, TeamName } from './models';
import { MtgService } from './mtg.service';

export interface SelectedDraftSet {
  id: string;
  code?: string;
  name: string;
  releasedAt?: string;
  set_type?: string;
}

export interface DamageSource {
  key: string;
  label: string;
}

/**
 * Eine "Panel-Einheit" im Ingame-Grid: normalerweise ein einzelner Spieler,
 * bei Two-Headed Giant aber ein ganzes Team (2 Spieler teilen sich ein Panel
 * mit gemeinsamem Leben/Gift/Commander-Schaden/Hintergrund). `key` ist der
 * Identifier, unter dem sämtliche Session-Signals (lifeTotals, poisonCounters,
 * deadPlayers, playerBackgrounds, ...) diese Einheit ablegen – bei normalen
 * Modi der Spielername, bei 2HG der Team-Name (z.B. "Team 1").
 */
export interface IngameUnit {
  key: string;
  label: string;
  commander?: string;
  partnerCommander?: string;
  members: MatchPlayer[];
}

/**
 * Hält den kompletten Zustand des aktuell laufenden (oder in Vorbereitung befindlichen) Matches.
 * Lebt als Singleton-Service statt in MatchTab, damit ein laufendes Spiel Tab-Wechsel übersteht –
 * Angular zerstört Komponenten beim Wechsel des @switch-Zweigs in app.html, Services nicht.
 */
@Injectable({ providedIn: 'root' })
export class GameSessionService {
  private readonly mtg = inject(MtgService);

  readonly OTHERS = '__OTHERS__';
  readonly DRAW = '__DRAW__';

  readonly phase = signal<'setup' | 'ingame'>('setup');
  readonly minimized = signal(false);
  readonly showWinnerPanel = signal(false);

  readonly mode = signal<GameMode>('Commander');
  readonly selectedPlayers = signal<MatchPlayer[]>([]);
  readonly winner = signal<string | null>(null);
  readonly selectedCubeId = signal<string | null>(null);
  readonly selectedDraftSet = signal<SelectedDraftSet | null>(null);

  /**
   * lifeTotals & co. sind ab jetzt generisch nach "Panel-Key" indiziert:
   * bei normalen Modi der Spielername, bei 2HG der Team-Name. Die Methoden
   * selbst (adjustLife, toggleDead, ...) kennt den Unterschied nicht – sie
   * nehmen einfach einen String-Key entgegen.
   */
  readonly lifeTotals = signal<Record<string, number>>({});
  /** commanderDamage[Ziel-Key][Quelle-Key] = Schaden */
  readonly commanderDamage = signal<Record<string, Record<string, number>>>({});
  /** poisonCounters[Panel-Key] = Anzahl Gift-Marken (10 = Niederlage) */
  readonly poisonCounters = signal<Record<string, number>>({});

  /** Zeigt ein Panel gerade Gift statt Leben? Rein lokal, betrifft nur dieses eine Panel. */
  readonly poisonView = signal<Record<string, boolean>>({});

  /** Rein visueller "Tot"-Status pro Panel – greift bewusst nicht in Leben/Sieger-Logik ein. */

  readonly deadPlayers = signal<Record<string, boolean>>({});

  private readonly deathMessages = [
    '💀 Ins Gras gebissen',
    '⚰️ Der Tod hat gewonnen',
    '👻 Schon im Jenseits',
    '🪦 Hier ruht... nicht mehr viel',
    '☠️ Game Over, Champ',
    '🕯️ Das Licht ist aus',
    '💥 Komplett weggewischt',
    '🍃 Staub zu Staub, Karte zu Friedhof',
    '🦴 Nur noch Knochen übrig',
    '🌑 In der Grube gelandet',
    '⚔️ Ehrenvoll gefallen (oder auch nicht)',
    '🧟 Untot... aber nicht im guten Sinne',
    '🎲 Würfel gefallen, Leben auch',
    '🪄 Zauber verpufft, Spieler auch',
    '🔥 Verbrannt bis auf die Grundkarten',
  ];

  /** Zufällig gezogener Todes-Spruch pro Panel, bleibt bis zur Wiederbelebung stabil. */
  readonly deadMessageMap = signal<Record<string, string>>({});

  isDead(key: string): boolean {
    return this.deadPlayers()[key] ?? false;
  }

  // NEU (ersetzt die bisherige toggleDead-Methode)
  toggleDead(key: string): void {
    const wasDead = this.isDead(key);
    this.deadPlayers.update((all) => ({ ...all, [key]: !wasDead }));

    if (!wasDead) {
      // Wird gerade als tot markiert -> neuen zufälligen Spruch ziehen.
      const msg = this.deathMessages[Math.floor(Math.random() * this.deathMessages.length)];
      this.deadMessageMap.update((all) => ({ ...all, [key]: msg }));
    }
  }

  /** Aktueller Todes-Spruch fürs Panel, Fallback falls (noch) keiner gezogen wurde. */
  deadMessage(key: string): string {
    return this.deadMessageMap()[key] ?? '☠ TOT';
  }

  /**
   * Wenn gesetzt: die genannte Panel-Einheit sammelt gerade Commander-Schaden ein.
   * Ihr eigenes Panel zeigt dann nur 2 Buttons, alle anderen Panels werden zu
   * Eingabe-Trackern für ihre eigenen Commander/Partner gegen genau diese Einheit.
   */
  readonly commanderDamageFocus = signal<string | null>(null);

  // NEU
  /**
   * Manuell festgelegte Reihenfolge der Panel-Keys (durch "Spieler neu
   * anordnen" im Options-Menü). Wird in ingameUnits() angewendet, BEVOR der
   * pinnedBottomKey den Sonderslot unten erzwingt – so bleibt der Sonderslot
   * auch nach manuellem Tauschen konsistent.
   */
  readonly manualOrder = signal<string[] | null>(null);

  /** Tauscht die Positionen zweier Panel-Einheiten (per Key) in der Anzeige-Reihenfolge. */
  swapUnits(keyA: string, keyB: string): void {
    if (keyA === keyB) return;
    const currentOrder = this.ingameUnits().map((u) => u.key);
    const idxA = currentOrder.indexOf(keyA);
    const idxB = currentOrder.indexOf(keyB);
    if (idxA === -1 || idxB === -1) return;
    const next = [...currentOrder];
    [next[idxA], next[idxB]] = [next[idxB], next[idxA]];
    this.manualOrder.set(next);
  }

  // NEU
  /**
   * Panel-Key, der bei ungerader Panel-Anzahl den Sonderslot unten (volle
   * Bildschirmbreite, quer liegend) bekommt. Frei wählbar per Longpress auf
   * den Spieler-/Team-Namen (siehe IngameTracker.pinToBottom). Wird bei
   * Archenemy automatisch auf den Archenemy vorbelegt, wenn der Nutzer noch
   * nichts explizit gewählt hat (siehe startGame()).
   */
  readonly pinnedBottomKey = signal<string | null>(null);

  setPinnedBottomKey(key: string | null): void {
    this.pinnedBottomKey.set(key);
  }

  readonly isTwoHeadedGiantMode = computed(() => this.mode() === 'Two-Headed Giant');

  /**
   * Panel-Einheiten fürs Ingame-Grid. Bei 2HG: ein Eintrag pro Team, Label =
   * beide Spielernamen mit "&" verbunden, members = beide Teammitglieder.
   * Sonst: ein Eintrag pro Spieler wie bisher.
   */
  readonly ingameUnits = computed<IngameUnit[]>(() => {
    let units: IngameUnit[];

    if (this.isTwoHeadedGiantMode()) {
      const teamOrder: string[] = [];
      const teams = new Map<string, MatchPlayer[]>();
      for (const p of this.selectedPlayers()) {
        const team = p.team ?? 'Unbekannt';
        if (!teams.has(team)) {
          teams.set(team, []);
          teamOrder.push(team);
        }
        teams.get(team)!.push(p);
      }
      units = teamOrder.map((team) => {
        const members = teams.get(team)!;
        return {
          key: team,
          label: members.map((m) => m.name).join(' & '),
          members,
        };
      });
    } else {
      units = this.selectedPlayers().map((p) => ({
        key: p.name,
        label: p.name,
        commander: p.commander,
        partnerCommander: p.partnerCommander,
        members: [p],
      }));
    }
    const manual = this.manualOrder();
    if (manual) {
      const byKey = new Map(units.map((u) => [u.key, u]));
      const ordered: IngameUnit[] = [];
      for (const key of manual) {
        const unit = byKey.get(key);
        if (unit) {
          ordered.push(unit);
          byKey.delete(key);
        }
      }
      ordered.push(...byKey.values());
      units = ordered;
    }

    // Sonderslot unten (ungerade Anzahl, quer liegend): der angeheftete Key
    // landet am Ende der Liste und damit automatisch im letzten Grid-Index.
    const pinned = this.pinnedBottomKey();
    if (pinned) {
      const idx = units.findIndex((u) => u.key === pinned);
      if (idx !== -1 && idx !== units.length - 1) {
        const [unit] = units.splice(idx, 1);
        units.push(unit);
      }
    }

    return units;
  });

  readonly requiresCommanderSelection = computed(() => {
    if (
      this.mode() === 'Commander' ||
      this.mode() === 'Two-Headed Giant' ||
      this.mode() === 'Archenemy'
    )
      return true;
    if (this.mode() === 'Cube') {
      const cube = this.mtg.cubes().find((c) => c.id === this.selectedCubeId());
      return Boolean(cube && cube.isCommander);
    }
    if (this.mode() === 'Draft') {
      const ds = this.selectedDraftSet();
      return Boolean(ds && ds.set_type === 'commander');
    }
    return false;
  });

  readonly canSave = computed(() => {
    if (this.selectedPlayers().length < 2 || this.winner() === null) return false;

    if (this.isTwoHeadedGiantMode()) {
      return this.selectedPlayers().every((player) => Boolean(player.team));
    }

    if (this.mode() === 'Archenemy') {
      const archenemies = this.selectedPlayers().filter((p) => p.isArchenemy);
      if (archenemies.length !== 1) return false;
      if (!this.selectedPlayers().every((p) => Boolean(p.commander))) return false;
      const w = this.winner();
      if (!w) return false;
      if (w === this.OTHERS) return true;
      if (w === this.DRAW) return true;
      return this.selectedPlayers().some((p) => p.name === w);
    }

    return true;
  });

  readonly canStartGame = computed(() => {
    if (this.selectedPlayers().length < 2) return false;

    if (this.isTwoHeadedGiantMode()) {
      return this.selectedPlayers().every((player) => Boolean(player.team));
    }

    if (this.mode() === 'Archenemy') {
      const archenemies = this.selectedPlayers().filter((p) => p.isArchenemy);
      if (archenemies.length !== 1) return false;
    }

    return true;
  });

  readonly ingameColumns = computed(() => (this.ingameUnits().length <= 2 ? 1 : 2));

  // NEU
  /** Gibt es bei der aktuellen Panel-Anzahl einen Sonderslot unten (ungerade Anzahl im 2-Spalten-Grid)? */
  readonly hasOddBottomSlot = computed(
    () => this.ingameColumns() === 2 && this.ingameUnits().length % 2 === 1
  );
  // NEU
  /**
   * Vertikale Position (in % der Overlay-Höhe) für den zentralen ⋮-Button.
   * Normalfall: 50% (Mitte des gesamten Grids, alle Reihen gleich behandelt).
   * Bei ungeradem Sonderslot unten (eigene, gleich hohe Reihe für sich allein)
   * soll der Button stattdessen in der Mitte der verbleibenden "4-Spieler"-
   * Reihen sitzen statt in der Mitte des gesamten Bildschirms – sonst rutscht
   * er optisch zu weit nach unten Richtung Sonderslot.
   */
  readonly centerButtonTopPercent = computed(() => {
    if (!this.hasOddBottomSlot()) return 50;
    const cols = this.ingameColumns();
    const totalRows = Math.ceil(this.ingameUnits().length / cols);
    return ((totalRows - 1) / (2 * totalRows)) * 100;
  });

  constructor() {
    // Automatische Sieger-Vorauswahl: sobald nur noch eine Panel-Einheit
    // lebt, wird sie als Gewinner vorgeschlagen; sterben alle gleichzeitig,
    // wird "Unentschieden" vorgeschlagen. Der Nutzer muss trotzdem immer
    // noch aktiv auf "Match speichern & beenden" klicken – hier wird nur
    // die Chip-Auswahl im Winner-Screen vorbelegt. Archenemy bewusst
    // ausgenommen: "nur noch einer lebt" hat dort eine andere Bedeutung.
    effect(
      () => {
        if (this.phase() !== 'ingame' || this.mode() === 'Archenemy') return;
        const units = this.ingameUnits();
        if (units.length < 2) return;
        const alive = units.filter((u) => !this.isDead(u.key));
        if (alive.length === 1) {
          this.winner.set(alive[0].key);
        } else if (alive.length === 0) {
          this.winner.set(this.DRAW);
        }
      },
      { allowSignalWrites: true }
    );
  }

  /** Alle Commander/Partner-Commander der Mitglieder einer Panel-Einheit als eigene Schadensquellen. */
  panelRotation(index: number): number {
    const cols = this.ingameColumns();

    // NEU
    if (this.hasOddBottomSlot() && index === this.ingameUnits().length - 1) {
      return 0;
    }

    if (cols === 1) {
      return index % 2 === 0 ? 180 : 0;
    }
    const col = index % cols;
    return col === 0 ? 90 : -90;
  }

  /** Alle Commander/Partner-Commander der Mitglieder einer Panel-Einheit als eigene Schadensquellen. */
  commandersOf(unit: IngameUnit): DamageSource[] {
    const sources: DamageSource[] = [];
    for (const m of unit.members) {
      if (m.commander) sources.push({ key: `${m.name}::main`, label: m.commander });
      if (m.partnerCommander)
        sources.push({ key: `${m.name}::partner`, label: m.partnerCommander });
    }
    if (sources.length === 0) sources.push({ key: `${unit.key}::main`, label: unit.label });
    return sources;
  }

  commanderDamageValue(target: string, sourceKey: string): number {
    return this.commanderDamage()[target]?.[sourceKey] ?? 0;
  }

  adjustLife(key: string, delta: number): void {
    this.lifeTotals.update((totals) => ({ ...totals, [key]: (totals[key] ?? 0) + delta }));
  }

  adjustCommanderDamage(target: string, sourceKey: string, delta: number): void {
    const current = this.commanderDamageValue(target, sourceKey);
    const next = Math.max(0, current + delta);
    const actualDelta = next - current;
    if (actualDelta === 0) return;

    this.commanderDamage.update((all) => ({
      ...all,
      [target]: { ...(all[target] ?? {}), [sourceKey]: next },
    }));
    // Commander-Schaden ist zugleich normaler Lebenspunktverlust -> Leben sinkt, wenn Schaden steigt.
    this.adjustLife(target, -actualDelta);
  }

  poisonValue(key: string): number {
    return this.poisonCounters()[key] ?? 0;
  }

  adjustPoison(key: string, delta: number): void {
    this.poisonCounters.update((totals) => ({
      ...totals,
      [key]: Math.max(0, (totals[key] ?? 0) + delta),
    }));
  }

  // --- Gepuffertes Tippen: Leben/Gift/Commander-Schaden ändern sich beim Tippen/Halten NICHT
  // sofort sichtbar - stattdessen sammelt sich ein "schwebendes" Delta (z.B. "-6"), das erst nach
  // einer kurzen Pause ohne weitere Eingabe auf einmal verrechnet wird. Das erspart Kopfrechnen
  // ("23 Leben, 6 Schaden -> 17") beim schnellen Eintippen von Schaden. ---

  private static readonly PENDING_COMMIT_DELAY_MS = 700;
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Panel-Key -> noch nicht verrechnetes Lebens-Delta. */
  readonly pendingLifeDelta = signal<Record<string, number>>({});
  /** Panel-Key -> noch nicht verrechnetes Gift-Delta. */
  readonly pendingPoisonDelta = signal<Record<string, number>>({});
  /** "target::sourceKey" -> noch nicht verrechnetes Commander-Schaden-Delta. */
  readonly pendingCommanderDamageDelta = signal<Record<string, number>>({});

  private bufferChange(
    pendingSignal: WritableSignal<Record<string, number>>,
    timerNamespace: string,
    key: string,
    delta: number,
    commit: (totalDelta: number) => void
  ): void {
    pendingSignal.update((map) => ({ ...map, [key]: (map[key] ?? 0) + delta }));

    const timerKey = `${timerNamespace}:${key}`;
    const existing = this.pendingTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    this.pendingTimers.set(
      timerKey,
      setTimeout(() => {
        this.pendingTimers.delete(timerKey);
        const total = pendingSignal()[key] ?? 0;
        pendingSignal.update((map) => {
          const next = { ...map };
          delete next[key];
          return next;
        });
        if (total !== 0) commit(total);
      }, GameSessionService.PENDING_COMMIT_DELAY_MS)
    );
  }

  bufferLifeChange(key: string, delta: number): void {
    this.bufferChange(this.pendingLifeDelta, 'life', key, delta, (total) =>
      this.adjustLife(key, total)
    );
  }

  bufferPoisonChange(key: string, delta: number): void {
    this.bufferChange(this.pendingPoisonDelta, 'poison', key, delta, (total) =>
      this.adjustPoison(key, total)
    );
  }

  bufferCommanderDamageChange(target: string, sourceKey: string, delta: number): void {
    const key = `${target}::${sourceKey}`;
    this.bufferChange(this.pendingCommanderDamageDelta, 'cd', key, delta, (total) =>
      this.adjustCommanderDamage(target, sourceKey, total)
    );
  }

  isPoisonView(key: string): boolean {
    return this.poisonView()[key] ?? false;
  }

  /** Eigenes Panel: schaltet nur lokal zwischen Leben- und Gift-Anzeige um. */
  togglePoisonView(key: string): void {
    this.poisonView.update((views) => ({ ...views, [key]: !(views[key] ?? false) }));
  }

  /** Eigenes Panel: startet den globalen "Schaden gegen mich"-Modus für alle Panels. */
  startCommanderDamageFocus(key: string): void {
    this.commanderDamageFocus.set(key);
  }

  /** Beendet den Fokus-Modus, alle Panels kehren zu ihrer normalen Leben/Gift-Ansicht zurück. */
  exitCommanderDamageFocus(): void {
    this.commanderDamageFocus.set(null);
  }

  /** Aus dem Fokus-Modus heraus direkt zur eigenen Gift-Ansicht wechseln. */
  goToPoisonFromFocus(key: string): void {
    this.poisonView.update((views) => ({ ...views, [key]: true }));
    this.commanderDamageFocus.set(null);
  }

  private defaultStartingLife(): number {
    const mode = this.mode();
    if (mode === 'Two-Headed Giant') return 60;
    if (mode === 'Cube') {
      const cube = this.mtg.cubes().find((c) => c.id === this.selectedCubeId());
      return cube?.isCommander ? 40 : 20;
    }
    if (mode === 'Draft') {
      return this.selectedDraftSet()?.set_type === 'commander' ? 40 : 20;
    }
    return 40;
  }

  startGame(): void {
    if (!this.canStartGame()) return;

    // NEU
    // Archenemy landet standardmäßig im Sonderslot unten, solange der Nutzer
    // noch nichts anderes per Longpress festgelegt hat.
    if (this.mode() === 'Archenemy' && this.pinnedBottomKey() === null) {
      const archenemy = this.selectedPlayers().find((p) => p.isArchenemy);
      if (archenemy) this.pinnedBottomKey.set(archenemy.name);
    }

    const startLife = this.defaultStartingLife();
    const totals: Record<string, number> = {};
    const damage: Record<string, Record<string, number>> = {};
    const poison: Record<string, number> = {};
    const poisonViews: Record<string, boolean> = {};
    for (const unit of this.ingameUnits()) {
      totals[unit.key] = startLife;
      damage[unit.key] = {};
      poison[unit.key] = 0;
      poisonViews[unit.key] = false;
    }
    this.lifeTotals.set(totals);
    this.commanderDamage.set(damage);
    this.poisonCounters.set(poison);
    this.poisonView.set(poisonViews);
    this.commanderDamageFocus.set(null);
    this.deadPlayers.set({});
    this.showWinnerPanel.set(false);
    this.winner.set(null);
    this.minimized.set(false);
    this.phase.set('ingame');
  }

  minimizeGame(): void {
    this.minimized.set(true);
  }

  reopenGame(): void {
    this.minimized.set(false);
  }

  /** Speichert das Match und setzt die komplette Session zurück. Setzt voraus, dass canSave() bereits geprüft wurde. */
  async saveAndReset(): Promise<void> {
    const winner = this.winner();
    if (!winner || !this.canSave()) return;

    const cube = this.mtg.cubes().find((c) => c.id === this.selectedCubeId());
    const draftSet = this.selectedDraftSet();

    await this.mtg.addMatch({
      mode: this.mode(),
      players: this.selectedPlayers(),
      winner,
      cube: cube ? { id: cube.id, name: cube.name, isCommander: cube.isCommander } : undefined,
      draftSet:
        this.mode() === 'Draft' && draftSet
          ? {
              id: draftSet.id,
              code: draftSet.code,
              name: draftSet.name,
              releasedAt: draftSet.releasedAt,
            }
          : undefined,
    });

    this.resetAll();
    this.deadMessageMap.set({}); // NEU
  }

  /** Verwirft die Session ohne zu speichern. */
  discardAndReset(): void {
    this.resetAll();
  }

  private resetAll(): void {
    this.phase.set('setup');
    this.showWinnerPanel.set(false);
    this.minimized.set(false);
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    this.pendingLifeDelta.set({});
    this.pendingPoisonDelta.set({});
    this.pendingCommanderDamageDelta.set({});
    this.lifeTotals.set({});
    this.commanderDamage.set({});
    this.poisonCounters.set({});
    this.poisonView.set({});
    this.commanderDamageFocus.set(null);
    this.deadPlayers.set({});
    this.selectedPlayers.set([]);
    this.winner.set(null);
    this.selectedCubeId.set(null);
    this.selectedDraftSet.set(null);
    this.mode.set('Commander');
    this.pinnedBottomKey.set(null);
    this.pinnedBottomKey.set(null);
    this.manualOrder.set(null); // NEU // NEU
  }

  // --- Setup-Mutationen (Spieler, Commander, Team, Archenemy) ---

  togglePlayer(name: string): void {
    const current = this.selectedPlayers();
    if (current.some((p) => p.name === name)) {
      this.selectedPlayers.set(current.filter((p) => p.name !== name));
      if (this.winner() === name) this.winner.set(null);
    } else {
      this.selectedPlayers.set([...current, { name }]);
    }
  }

  isSelected(name: string): boolean {
    return this.selectedPlayers().some((p) => p.name === name);
  }

  assignCommander(playerName: string, commander: string): void {
    this.selectedPlayers.update((players) =>
      players.map((p) => (p.name === playerName ? { ...p, commander, deckId: undefined } : p))
    );
  }

  /** Weist ein importiertes Deck zu - übernimmt dessen Commander (+Partner) und merkt sich die Deck-ID fürs Tracking. */
  assignDeck(playerName: string, deckId: string, commander: string, partnerCommander?: string): void {
    this.selectedPlayers.update((players) =>
      players.map((p) => (p.name === playerName ? { ...p, commander, partnerCommander, deckId } : p))
    );
  }

  clearCommander(playerName: string): void {
    this.selectedPlayers.update((players) =>
      players.map((p) =>
        p.name === playerName
          ? { ...p, commander: undefined, partnerCommander: undefined, deckId: undefined }
          : p
      )
    );
  }

  assignPartnerCommander(playerName: string, commander: string): void {
    this.selectedPlayers.update((players) =>
      players.map((p) => (p.name === playerName ? { ...p, partnerCommander: commander } : p))
    );
  }

  clearPartnerCommander(playerName: string): void {
    this.selectedPlayers.update((players) =>
      players.map((p) => (p.name === playerName ? { ...p, partnerCommander: undefined } : p))
    );
  }

  setPlayerTeam(playerName: string, team: string): void {
    const normalizedTeam = TEAM_OPTIONS.includes(team as TeamName) ? (team as TeamName) : undefined;
    this.selectedPlayers.update((players) =>
      players.map((p) => (p.name === playerName ? { ...p, team: normalizedTeam } : p))
    );
  }

  toggleArchenemy(playerName: string): void {
    this.selectedPlayers.update((players) =>
      players.map((p) => ({
        ...p,
        isArchenemy: p.name === playerName ? !(p.isArchenemy ?? false) : false,
      }))
    );
    const w = this.winner();
    if (w && w !== this.OTHERS && !this.selectedPlayers().some((p) => p.name === w)) {
      this.winner.set(null);
    }
  }

  selectDraftSet(
    set: { id: string; code?: string; name: string; released_at?: string; set_type?: string } | null
  ): void {
    if (!set) {
      this.selectedDraftSet.set(null);
      return;
    }
    this.selectedDraftSet.set({
      id: set.id,
      code: set.code,
      name: set.name,
      releasedAt: set.released_at,
      set_type: set.set_type,
    });
  }
}
