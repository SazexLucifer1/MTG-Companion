import { Injectable, inject, signal } from '@angular/core';
import { DeckService, Deck } from './deck.service';
import { PreconService, PreconSummary } from './precon.service';
import { ScryfallService } from './scryfall.service';
import { EdhrecService, EdhrecTag } from './edhrec.service';
import { I18nService } from './i18n.service';

/** Diese App ist reine Commander-App - das Format ist also immer dasselbe, keine Abfrage nötig. */
const FIXED_FORMAT = 'Commander';

/**
 * Hält den Zustand der Deck-Import-/Precon-Import-Dialoge global (statt lokal in DeckList), damit
 * die Dialoge als eigene, root-level gerenderte Komponente existieren können (analog
 * DeckViewerService) - nur so lässt sich echtes position:fixed über den ganzen Viewport erreichen,
 * ohne von einem `.glass-card`-Vorfahren mit backdrop-filter eingefangen zu werden.
 */
@Injectable({ providedIn: 'root' })
export class DeckImportService {
  private readonly deckService = inject(DeckService);
  private readonly preconService = inject(PreconService);
  private readonly scryfall = inject(ScryfallService);
  private readonly edhrec = inject(EdhrecService);
  readonly i18n = inject(I18nService);

  private userId = '';
  private onSaved: (() => void) | null = null;

  // --- EDHREC-Theme-Tag - gemeinsam für beide Deck-anlegen-Dialoge (Import + Leeres Deck), da nie
  // beide gleichzeitig offen sind. Steuert später die EDHREC-Vorschläge im Bearbeiten-Modus. ---

  readonly availableCommanderTags = signal<EdhrecTag[]>([]);
  readonly commanderTagsBusy = signal(false);
  readonly selectedCommanderTag = signal<string | null>(null);
  private lastTagsCommander: string | null = null;

  setSelectedCommanderTag(slug: string | null): void {
    this.selectedCommanderTag.set(slug);
  }

  /** Lädt die verfügbaren EDHREC-Tags neu, wenn sich der (erkannte) Commander geändert hat - No-op sonst. */
  private async loadTagsForCommander(commanderName: string | null, keepTag: string | null = null): Promise<void> {
    if (commanderName === this.lastTagsCommander) return;
    this.lastTagsCommander = commanderName;
    this.selectedCommanderTag.set(keepTag);
    this.availableCommanderTags.set([]);
    if (!commanderName) return;

    this.commanderTagsBusy.set(true);
    const tags = await this.edhrec.getCommanderTags(commanderName);
    this.commanderTagsBusy.set(false);

    let list = tags ?? [];
    // Gespeicherten Tag immer als Option anbieten, auch falls er in der frisch geladenen Liste
    // fehlen sollte (z.B. EDHREC hat den Tag seither umbenannt) - sonst würde die Auswahl im
    // <select> unsichtbar auf "nichts ausgewählt" zurückfallen, obwohl ein Wert gespeichert ist.
    if (keepTag && !list.some((t) => t.slug === keepTag)) {
      list = [{ slug: keepTag, value: keepTag, count: 0 }, ...list];
    }
    this.availableCommanderTags.set(list);
  }

  // --- Deck anlegen / aktualisieren ---

  readonly showImportDialog = signal(false);
  readonly editingDeckId = signal<string | null>(null);
  readonly deckName = signal('');
  readonly deckText = signal('');
  readonly importBusy = signal(false);
  readonly importMessage = signal('');
  private deckTextCommanderTimer: ReturnType<typeof setTimeout> | null = null;

  openNewDeckDialog(userId: string, onSaved: () => void): void {
    this.userId = userId;
    this.onSaved = onSaved;
    this.editingDeckId.set(null);
    this.deckName.set('');
    this.deckText.set('');
    this.importMessage.set('');
    this.lastTagsCommander = null;
    this.selectedCommanderTag.set(null);
    this.availableCommanderTags.set([]);
    this.showImportDialog.set(true);
  }

  async openEditDeckDialog(userId: string, deck: Deck, onSaved: () => void): Promise<void> {
    this.userId = userId;
    this.onSaved = onSaved;
    this.editingDeckId.set(deck.id);
    this.deckName.set(deck.name);
    this.importMessage.set('');
    const cards = await this.deckService.loadDeckCards(deck.id);
    this.deckText.set(cards.map((c) => `${c.quantity} ${c.cardName}`).join('\n'));
    this.lastTagsCommander = null;
    const commander = cards.find((c) => c.isCommander)?.cardName ?? null;
    await this.loadTagsForCommander(commander, deck.edhrecTag);
    this.showImportDialog.set(true);
  }

  closeImportDialog(): void {
    this.showImportDialog.set(false);
  }

  /** Erkennt den Commander live aus der eingefügten Kartenliste (Abschnitt "Commander:"), um die passenden EDHREC-Tags anzubieten. */
  onDeckTextInput(value: string): void {
    this.deckText.set(value);
    if (this.deckTextCommanderTimer) clearTimeout(this.deckTextCommanderTimer);
    this.deckTextCommanderTimer = setTimeout(() => {
      const commander = this.deckService.parseDecklistText(value).find((p) => p.isCommander)?.name ?? null;
      this.loadTagsForCommander(commander);
    }, 400);
  }

  async saveDeck(): Promise<void> {
    const name = this.deckName().trim();
    if (!name || !this.deckText().trim()) return;

    this.importBusy.set(true);
    this.importMessage.set('');

    const ok = await this.deckService.saveDeck(
      this.userId,
      name,
      FIXED_FORMAT,
      this.deckText(),
      this.editingDeckId(),
      false,
      this.selectedCommanderTag()
    );

    this.importBusy.set(false);

    if (ok) {
      this.showImportDialog.set(false);
      this.onSaved?.();
    } else {
      this.importMessage.set(this.i18n.t('importDialog.msg.saveFailed'));
    }
  }

  // --- Leeres Deck anlegen (Name + Commander, dann direkt in der Detailansicht per Hand
  // aufbauen statt eine ganze Kartenliste einzufügen) ---

  private onEmptyDeckCreated: ((deck: Deck) => void) | null = null;
  private emptyDeckCommanderSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly showNewEmptyDeckDialog = signal(false);
  readonly newDeckName = signal('');
  readonly newDeckCommanderQuery = signal('');
  readonly newDeckCommanderSuggestions = signal<string[]>([]);
  readonly newDeckCommanderSelected = signal<string | null>(null);
  readonly newDeckBusy = signal(false);
  readonly newDeckMessage = signal('');

  openNewEmptyDeckDialog(userId: string, onCreated: (deck: Deck) => void): void {
    this.userId = userId;
    this.onEmptyDeckCreated = onCreated;
    this.newDeckName.set('');
    this.newDeckCommanderQuery.set('');
    this.newDeckCommanderSuggestions.set([]);
    this.newDeckCommanderSelected.set(null);
    this.newDeckMessage.set('');
    this.lastTagsCommander = null;
    this.selectedCommanderTag.set(null);
    this.availableCommanderTags.set([]);
    this.showNewEmptyDeckDialog.set(true);
  }

  closeNewEmptyDeckDialog(): void {
    this.showNewEmptyDeckDialog.set(false);
  }

  onNewDeckCommanderInput(value: string): void {
    this.newDeckCommanderQuery.set(value);
    this.newDeckCommanderSelected.set(null);
    if (this.emptyDeckCommanderSearchTimer) clearTimeout(this.emptyDeckCommanderSearchTimer);
    this.emptyDeckCommanderSearchTimer = setTimeout(async () => {
      this.newDeckCommanderSuggestions.set(await this.scryfall.autocomplete(value));
    }, 250);
  }

  selectNewDeckCommander(name: string): void {
    this.newDeckCommanderSelected.set(name);
    this.newDeckCommanderQuery.set(name);
    this.newDeckCommanderSuggestions.set([]);
    this.loadTagsForCommander(name);
  }

  async createEmptyDeck(): Promise<void> {
    const name = this.newDeckName().trim();
    const commander = this.newDeckCommanderSelected();
    if (!name || !commander) return;

    this.newDeckBusy.set(true);
    this.newDeckMessage.set('');

    const tag = this.selectedCommanderTag();
    const deckId = await this.deckService.saveDeck(
      this.userId,
      name,
      FIXED_FORMAT,
      `Commander:\n1 ${commander}`,
      null,
      false,
      tag
    );

    this.newDeckBusy.set(false);

    if (deckId) {
      this.showNewEmptyDeckDialog.set(false);
      this.onEmptyDeckCreated?.({
        id: deckId,
        userId: this.userId,
        name,
        format: FIXED_FORMAT,
        updatedAt: new Date().toISOString(),
        isPrecon: false,
        edhrecTag: tag,
        isPrivate: false,
        isOutdated: false,
      });
    } else {
      this.newDeckMessage.set(this.i18n.t('importDialog.msg.createFailed'));
    }
  }

  // --- Precon-Import ---

  readonly showPreconDialog = signal(false);
  readonly preconYear = signal<number>(new Date().getFullYear());
  readonly preconOptions = signal<PreconSummary[]>([]);
  readonly selectedPreconFileNames = signal<Set<string>>(new Set());
  readonly preconSearchBusy = signal(false);
  readonly preconImportBusy = signal(false);
  readonly preconImportProgress = signal<{ done: number; total: number } | null>(null);
  readonly preconMessage = signal('');

  async openPreconDialog(userId: string, onSaved: () => void): Promise<void> {
    this.userId = userId;
    this.onSaved = onSaved;
    this.showPreconDialog.set(true);
    this.preconMessage.set('');
    this.selectedPreconFileNames.set(new Set());
    await this.searchPreconsForYear();
  }

  closePreconDialog(): void {
    this.showPreconDialog.set(false);
    this.preconOptions.set([]);
    this.selectedPreconFileNames.set(new Set());
  }

  setPreconYear(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isNaN(value)) this.preconYear.set(value);
  }

  async searchPreconsForYear(): Promise<void> {
    this.preconSearchBusy.set(true);
    this.preconMessage.set('');
    this.selectedPreconFileNames.set(new Set());
    this.preconOptions.set(await this.preconService.getPreconsForYear(this.preconYear()));
    this.preconSearchBusy.set(false);
  }

  isPreconSelected(fileName: string): boolean {
    return this.selectedPreconFileNames().has(fileName);
  }

  togglePreconSelected(fileName: string): void {
    this.selectedPreconFileNames.update((set) => {
      const next = new Set(set);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  }

  toggleAllPrecons(): void {
    const all = this.preconOptions();
    this.selectedPreconFileNames.set(
      this.selectedPreconFileNames().size === all.length ? new Set() : new Set(all.map((p) => p.fileName))
    );
  }

  async importSelectedPrecons(): Promise<void> {
    const selected = this.preconOptions().filter((p) => this.selectedPreconFileNames().has(p.fileName));
    if (selected.length === 0) return;

    this.preconImportBusy.set(true);
    this.preconMessage.set('');
    this.preconImportProgress.set({ done: 0, total: selected.length });

    let failed = 0;
    for (const precon of selected) {
      const text = await this.preconService.loadPreconAsText(precon.fileName);
      const ok =
        text !== null &&
        (await this.deckService.saveDeck(this.userId, precon.name, 'Commander', text, null, true));
      if (!ok) failed++;
      this.preconImportProgress.update((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    this.preconImportBusy.set(false);
    this.preconImportProgress.set(null);
    this.onSaved?.();

    this.preconMessage.set(
      failed === 0
        ? this.i18n.t('importDialog.msg.allImported', { count: selected.length })
        : this.i18n.t('importDialog.msg.partialImported', {
            success: selected.length - failed,
            total: selected.length,
            failed,
          })
    );
    this.selectedPreconFileNames.set(new Set());
  }
}
