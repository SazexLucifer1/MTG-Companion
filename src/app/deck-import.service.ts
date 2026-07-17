import { Injectable, inject, signal } from '@angular/core';
import { DeckService, Deck } from './deck.service';
import { PreconService, PreconSummary } from './precon.service';

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

  private userId = '';
  private onSaved: (() => void) | null = null;

  // --- Deck anlegen / aktualisieren ---

  readonly showImportDialog = signal(false);
  readonly editingDeckId = signal<string | null>(null);
  readonly deckName = signal('');
  readonly deckFormat = signal('');
  readonly deckText = signal('');
  readonly importBusy = signal(false);
  readonly importMessage = signal('');

  openNewDeckDialog(userId: string, onSaved: () => void): void {
    this.userId = userId;
    this.onSaved = onSaved;
    this.editingDeckId.set(null);
    this.deckName.set('');
    this.deckFormat.set('');
    this.deckText.set('');
    this.importMessage.set('');
    this.showImportDialog.set(true);
  }

  async openEditDeckDialog(userId: string, deck: Deck, onSaved: () => void): Promise<void> {
    this.userId = userId;
    this.onSaved = onSaved;
    this.editingDeckId.set(deck.id);
    this.deckName.set(deck.name);
    this.deckFormat.set(deck.format ?? '');
    this.importMessage.set('');
    const cards = await this.deckService.loadDeckCards(deck.id);
    this.deckText.set(cards.map((c) => `${c.quantity} ${c.cardName}`).join('\n'));
    this.showImportDialog.set(true);
  }

  closeImportDialog(): void {
    this.showImportDialog.set(false);
  }

  async saveDeck(): Promise<void> {
    const name = this.deckName().trim();
    if (!name || !this.deckText().trim()) return;

    this.importBusy.set(true);
    this.importMessage.set('');

    const ok = await this.deckService.saveDeck(
      this.userId,
      name,
      this.deckFormat().trim() || null,
      this.deckText(),
      this.editingDeckId()
    );

    this.importBusy.set(false);

    if (ok) {
      this.showImportDialog.set(false);
      this.onSaved?.();
    } else {
      this.importMessage.set(
        'Deck konnte nicht gespeichert werden. Ein Kartenname pro Zeile, z.B. "1 Sol Ring".'
      );
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
        ? `${selected.length} Precon(s) importiert.`
        : `${selected.length - failed} von ${selected.length} importiert, ${failed} fehlgeschlagen.`
    );
    this.selectedPreconFileNames.set(new Set());
  }
}
