import { Injectable, computed, inject, signal } from '@angular/core';
import { DeckService, Deck, DeckCard } from './deck.service';
import { shuffle } from './array-utils';

export type GoldfishZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';
export type BattlefieldRow = 'creature' | 'other' | 'land';

export interface GoldfishCardInstance {
  instanceId: string;
  cardName: string;
  imageUrl: string | null;
  typeLine: string | null;
  isCommander: boolean;
  zone: GoldfishZone;
  /** Nur in 'battlefield' relevant - wird bei jedem Zonenwechsel zurückgesetzt. */
  tapped: boolean;
}

const OPENING_HAND_SIZE = 7;

/** Sortier-Reihenfolge der mittleren "Rest"-Zeile - alles, was nicht Kreatur oder Land ist. */
const REST_TYPE_PRIORITY = ['Artifact', 'Enchantment', 'Planeswalker', 'Battle'];

/** Ordnet eine Karte anhand ihrer Type-Line automatisch einer der 3 Spielfeld-Zeilen zu - unabhängig davon, wo sie hingezogen wurde. */
function classifyRow(typeLine: string | null): BattlefieldRow {
  const t = typeLine ?? '';
  if (t.includes('Land')) return 'land';
  if (t.includes('Creature')) return 'creature';
  return 'other';
}

function restTypePriority(typeLine: string | null): number {
  const t = typeLine ?? '';
  const idx = REST_TYPE_PRIORITY.findIndex((p) => t.includes(p));
  return idx === -1 ? REST_TYPE_PRIORITY.length : idx;
}

/** Instants/Sorceries sind keine Permanents - "ins Spiel legen" bedeutet für sie: wirken und direkt in den Friedhof. */
export function isEphemeralSpell(typeLine: string | null): boolean {
  const t = typeLine ?? '';
  return t.includes('Instant') || t.includes('Sorcery');
}

/**
 * Rein clientseitiger Solo-Deck-Simulator ("Goldfishing") - kein Bezug zu GameSessionService,
 * keine Supabase-Schreibaktionen, kein Einfluss auf Match-Historie/Statistiken. Zustand lebt nur
 * so lange wie das Overlay offen ist (siehe open()/close(), Muster wie DeckViewerService).
 */
@Injectable({ providedIn: 'root' })
export class GoldfishService {
  private readonly deckService = inject(DeckService);

  readonly activeDeck = signal<Deck | null>(null);
  readonly busy = signal(false);
  readonly mulliganCount = signal(0);

  /** Einzige Quelle der Wahrheit - Zonen sind computed-Filter darüber (siehe unten). */
  readonly cards = signal<GoldfishCardInstance[]>([]);

  /** Instanz-ID, für die gerade das Verschiebe-Menü offen ist. */
  readonly moveMenuFor = signal<string | null>(null);
  /** Welcher Stapel (Bibliothek/Friedhof/Exil) gerade als durchsuchbare Liste aufgeklappt ist. */
  readonly zoneListView = signal<GoldfishZone | null>(null);
  readonly zoneListSearch = signal('');
  /** Karte, die gerade groß in der Vorschau angezeigt wird (Lupe-Symbol auf jeder Kachel). */
  readonly previewCard = signal<GoldfishCardInstance | null>(null);

  readonly library = computed(() => this.cards().filter((c) => c.zone === 'library'));
  readonly hand = computed(() => this.cards().filter((c) => c.zone === 'hand'));
  readonly battlefield = computed(() => this.cards().filter((c) => c.zone === 'battlefield'));
  readonly graveyard = computed(() => this.cards().filter((c) => c.zone === 'graveyard'));
  readonly exile = computed(() => this.cards().filter((c) => c.zone === 'exile'));
  readonly command = computed(() => this.cards().filter((c) => c.zone === 'command'));
  readonly libraryEmpty = computed(() => this.library().length === 0);

  /** Die 3 automatisch sortierten Spielfeld-Zeilen - Zugehörigkeit ergibt sich immer aus der Type-Line, nie aus der Ablageposition. */
  readonly battlefieldCreatures = computed(() => this.battlefield().filter((c) => classifyRow(c.typeLine) === 'creature'));
  readonly battlefieldLands = computed(() => this.battlefield().filter((c) => classifyRow(c.typeLine) === 'land'));
  readonly battlefieldOther = computed(() =>
    [...this.battlefield().filter((c) => classifyRow(c.typeLine) === 'other')].sort(
      (a, b) => restTypePriority(a.typeLine) - restTypePriority(b.typeLine)
    )
  );

  readonly zoneListCards = computed(() => {
    const zone = this.zoneListView();
    if (!zone) return [];
    const all = this.cards().filter((c) => c.zone === zone);
    const q = this.zoneListSearch().trim().toLowerCase();
    return q ? all.filter((c) => c.cardName.toLowerCase().includes(q)) : all;
  });

  async open(deck: Deck): Promise<void> {
    this.activeDeck.set(deck);
    this.busy.set(true);
    this.cards.set([]);
    this.mulliganCount.set(0);
    this.moveMenuFor.set(null);
    this.zoneListView.set(null);
    this.zoneListSearch.set('');
    this.previewCard.set(null);

    const deckCards = await this.deckService.loadDeckCards(deck.id);
    const instances = this.buildInstances(deckCards);
    const commanders = instances.filter((c) => c.isCommander).map((c) => ({ ...c, zone: 'command' as const }));
    const rest = shuffle(instances.filter((c) => !c.isCommander));

    this.cards.set([...commanders, ...rest]);
    this.busy.set(false);
    this.draw(OPENING_HAND_SIZE);
  }

  close(): void {
    this.activeDeck.set(null);
    this.busy.set(false);
    this.cards.set([]);
    this.mulliganCount.set(0);
    this.moveMenuFor.set(null);
    this.zoneListView.set(null);
    this.zoneListSearch.set('');
    this.previewCard.set(null);
  }

  private buildInstances(deckCards: DeckCard[]): GoldfishCardInstance[] {
    const instances: GoldfishCardInstance[] = [];
    for (const card of deckCards) {
      for (let i = 0; i < card.quantity; i++) {
        instances.push({
          instanceId: crypto.randomUUID(),
          cardName: card.cardName,
          imageUrl: card.imageUrl,
          typeLine: card.typeLine,
          isCommander: card.isCommander,
          zone: 'library',
          tapped: false,
        });
      }
    }
    return instances;
  }

  shuffleLibrary(): void {
    this.cards.update((all) => {
      const rest = all.filter((c) => c.zone !== 'library');
      const shuffled = shuffle(all.filter((c) => c.zone === 'library'));
      return [...rest, ...shuffled];
    });
  }

  /** Zieht so viele Karten wie verfügbar (0..n) - stiller No-Op bei leerer Bibliothek, kein Crash. */
  draw(n: number): void {
    if (n <= 0) return;
    this.cards.update((all) => {
      let remaining = n;
      return all.map((c) => {
        if (c.zone === 'library' && remaining > 0) {
          remaining--;
          return { ...c, zone: 'hand' as const, tapped: false };
        }
        return c;
      });
    });
  }

  /**
   * Generischer Zonenwechsel - keine Regel-Einschränkung, jede Karte darf in jede Zone, mit einer
   * Ausnahme: Instant/Sorcery aufs Spielfeld gelegt heißt "gewirkt" und landet direkt im Friedhof.
   */
  moveCard(instanceId: string, toZone: GoldfishZone): void {
    this.cards.update((all) =>
      all.map((c) => {
        if (c.instanceId !== instanceId) return c;
        const zone = toZone === 'battlefield' && isEphemeralSpell(c.typeLine) ? 'graveyard' : toZone;
        return { ...c, zone, tapped: false };
      })
    );
    this.closeMoveMenu();
  }

  toggleTapped(instanceId: string): void {
    this.cards.update((all) =>
      all.map((c) => (c.instanceId === instanceId && c.zone === 'battlefield' ? { ...c, tapped: !c.tapped } : c))
    );
  }

  untapAll(): void {
    this.cards.update((all) => all.map((c) => (c.zone === 'battlefield' ? { ...c, tapped: false } : c)));
  }

  /** Vereinfachtes, freies Mulligan: Hand zurück in die Bibliothek, mischen, gleiche Anzahl neu ziehen - kein Bottoming. */
  mulligan(): void {
    const handSize = this.hand().length;
    this.cards.update((all) => all.map((c) => (c.zone === 'hand' ? { ...c, zone: 'library' as const, tapped: false } : c)));
    this.shuffleLibrary();
    this.mulliganCount.update((n) => n + 1);
    this.draw(handSize);
  }

  /** Alles außer der Kommandozone zurück in die Bibliothek, neue Starthand - bewusst ohne Bestätigungsdialog (Kernloop des Features). */
  restart(): void {
    this.cards.update((all) =>
      all.map((c) => (c.zone === 'command' ? c : { ...c, zone: 'library' as const, tapped: false }))
    );
    this.shuffleLibrary();
    this.mulliganCount.set(0);
    this.draw(OPENING_HAND_SIZE);
  }

  openMoveMenu(instanceId: string): void {
    this.moveMenuFor.set(instanceId);
  }

  closeMoveMenu(): void {
    this.moveMenuFor.set(null);
  }

  openZoneList(zone: GoldfishZone): void {
    this.zoneListView.set(zone);
    this.zoneListSearch.set('');
  }

  closeZoneList(): void {
    this.zoneListView.set(null);
    this.zoneListSearch.set('');
  }

  openPreview(card: GoldfishCardInstance): void {
    this.previewCard.set(card);
  }

  closePreview(): void {
    this.previewCard.set(null);
  }
}
