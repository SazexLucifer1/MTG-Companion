import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeckService, Deck } from '../deck.service';
import { DeckViewerService } from '../deck-viewer.service';
import { DeckImportService } from '../deck-import.service';

@Component({
  selector: 'app-deck-list',
  imports: [DatePipe],
  templateUrl: './deck-list.html',
  styleUrl: './deck-list.scss',
})
export class DeckList {
  readonly userId = input.required<string>();
  /** Wenn true, sind Import/Bearbeiten/Löschen ausgeblendet - reine Ansicht fremder Decks. */
  readonly readonlyMode = input(false);

  private readonly deckService = inject(DeckService);
  readonly viewer = inject(DeckViewerService);
  readonly importService = inject(DeckImportService);

  readonly decks = signal<Deck[]>([]);
  readonly loading = signal(true);

  constructor() {
    effect(() => {
      const uid = this.userId();
      this.loading.set(true);
      this.deckService.loadDecksForUser(uid).then((decks) => {
        this.decks.set(decks);
        this.loading.set(false);
      });
    });
  }

  private async refreshDecks(): Promise<void> {
    this.decks.set(await this.deckService.loadDecksForUser(this.userId()));
  }

  openNewDeckDialog(): void {
    this.importService.openNewDeckDialog(this.userId(), () => this.refreshDecks());
  }

  openEditDeckDialog(deck: Deck): void {
    this.importService.openEditDeckDialog(this.userId(), deck, () => this.refreshDecks());
  }

  openPreconDialog(): void {
    this.importService.openPreconDialog(this.userId(), () => this.refreshDecks());
  }

  async deleteDeck(deck: Deck): Promise<void> {
    if (!confirm(`Deck „${deck.name}" wirklich löschen?`)) return;
    await this.deckService.deleteDeck(deck.id);
    if (this.viewer.viewingDeck()?.id === deck.id) this.viewer.close();
    await this.refreshDecks();
  }

  openDeckDetail(deck: Deck): void {
    this.viewer.open(deck);
  }
}
