import { Component, effect, inject } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeckViewerService } from '../deck-viewer.service';
import { DeckService, DeckCard, DeckOwner } from '../deck.service';
import { DeckImportService } from '../deck-import.service';
import { DeckPdfService } from '../deck-pdf.service';
import { EdhrecCardlist } from '../edhrec.service';
import { CardImage } from '../card-image/card-image';
import { BarChart } from '../ui/bar-chart/bar-chart';

@Component({
  selector: 'app-deck-detail-view',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, PercentPipe, FormsModule, CardImage, BarChart],
  templateUrl: './deck-detail-view.html',
  styleUrl: './deck-detail-view.scss',
})
export class DeckDetailView {
  readonly viewer = inject(DeckViewerService);
  private readonly deckService = inject(DeckService);
  private readonly importService = inject(DeckImportService);
  private readonly pdfService = inject(DeckPdfService);

  /**
   * Öffnet den bestehenden Import-Dialog wieder (Copy-Paste einer kompletten Liste inkl.
   * Diff-Erkennung) - jetzt als Zusatzaktion direkt aus der Detailansicht statt über einen
   * eigenen Bearbeiten-Button in der Deckliste. Lädt das Deck nach dem Speichern frisch aus der DB
   * nach, da der Dialog dabei auch Name/Tag mitändern kann.
   */
  async reimportDecklist(): Promise<void> {
    const deck = this.viewer.viewingDeck();
    if (!deck || !this.viewer.canEditViewingDeck()) return;
    const owner: DeckOwner = deck.playerId
      ? { kind: 'player', playerId: deck.playerId }
      : { kind: 'user', userId: deck.userId! };
    await this.importService.openEditDeckDialog(owner, deck, async () => {
      const decks = await this.deckService.loadDecksForOwner(owner);
      const fresh = decks.find((d) => d.id === deck.id) ?? deck;
      await this.viewer.open(fresh);
    });
  }

  async openPdfExport(): Promise<void> {
    const deck = this.viewer.viewingDeck();
    if (!deck) return;
    // Ohne dieses Warten könnten die Scryfall-Zusatzdaten (u.a. Rückseiten-Bilder) noch nicht
    // geladen sein, wenn direkt nach dem Öffnen eines Decks exportiert wird - Rückseiten würden
    // dann im PDF fehlen, obwohl die Karte im Deck korrekt doppelseitig ist.
    await this.viewer.ensureCardDetailsLoaded();
    const orderedCards = this.viewer
      .groupedDeckCards()
      .filter((section) => section.label !== 'Maybeboard')
      .flatMap((section) => section.cards);
    this.pdfService.open(
      deck.name,
      orderedCards.map((c) => ({
        cardName: c.cardName,
        quantity: c.quantity,
        imageUrl: this.viewer.resolvedCardPrintImage(c),
        backImageUrl: this.viewer.resolvedCardBackPrintImage(c),
      }))
    );
  }

  async onCustomArtworkSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.viewer.uploadCustomArtwork(file);
  }

  /** Summe der Kartenanzahl (nicht Anzahl unterschiedlicher Kartennamen) für den Zähler in der Abschnitts-Überschrift, z.B. "Land (12)" bei 7 Forest + 5 Island statt fälschlich nur 2 (Zeilenanzahl). */
  sectionCardCount(cards: DeckCard[]): number {
    return cards.reduce((sum, c) => sum + c.quantity, 0);
  }




  private readonly expandedEdhrecCategories = new Set<string>();

  constructor() {
    // Sobald sich die EDHREC-Vorschlagsliste ändert (Tag gewechselt, Commander gewechselt, erneutes
    // Bearbeiten nach dem Speichern, ...), für bereits aufgeklappte Kategorien die Bilder direkt neu
    // nachladen - sonst zeigen sie weiterhin nur die (jetzt zu den neuen Karten nicht mehr
    // passenden) alten Bilder oder gar keine, bis man von Hand ein-/wieder ausklappt.
    // loadEdhrecCategoryImages() lädt intern ohnehin nur Karten nach, die noch nicht im Cache sind.
    effect(() => {
      const lists = this.viewer.edhrecLists();
      if (!lists) return;
      for (const list of lists) {
        if (this.expandedEdhrecCategories.has(list.tag)) {
          this.viewer.loadEdhrecCategoryImages(
            list.tag,
            list.cards.map((c) => c.name)
          );
        }
      }
    });
  }

  isEdhrecCategoryExpanded(tag: string): boolean {
    return this.expandedEdhrecCategories.has(tag);
  }

  toggleEdhrecCategory(list: EdhrecCardlist): void {
    if (this.expandedEdhrecCategories.has(list.tag)) {
      this.expandedEdhrecCategories.delete(list.tag);
    } else {
      this.expandedEdhrecCategories.add(list.tag);
      this.viewer.loadEdhrecCategoryImages(
        list.tag,
        list.cards.map((c) => c.name)
      );
    }
  }
}
