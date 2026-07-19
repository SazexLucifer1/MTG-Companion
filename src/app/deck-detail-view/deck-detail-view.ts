import { Component, inject } from '@angular/core';
import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeckViewerService } from '../deck-viewer.service';
import { DeckService } from '../deck.service';
import { DeckImportService } from '../deck-import.service';
import { EdhrecCardlist } from '../edhrec.service';

@Component({
  selector: 'app-deck-detail-view',
  imports: [DatePipe, DecimalPipe, PercentPipe, FormsModule],
  templateUrl: './deck-detail-view.html',
  styleUrl: './deck-detail-view.scss',
})
export class DeckDetailView {
  readonly viewer = inject(DeckViewerService);
  private readonly deckService = inject(DeckService);
  private readonly importService = inject(DeckImportService);

  /**
   * Öffnet den bestehenden Import-Dialog wieder (Copy-Paste einer kompletten Liste inkl.
   * Diff-Erkennung) - jetzt als Zusatzaktion direkt aus der Detailansicht statt über einen
   * eigenen Bearbeiten-Button in der Deckliste. Lädt das Deck nach dem Speichern frisch aus der DB
   * nach, da der Dialog dabei auch Name/Tag mitändern kann.
   */
  async reimportDecklist(): Promise<void> {
    const deck = this.viewer.viewingDeck();
    if (!deck || !this.viewer.canEditViewingDeck()) return;
    await this.importService.openEditDeckDialog(deck.userId, deck, async () => {
      const decks = await this.deckService.loadDecksForUser(deck.userId);
      const fresh = decks.find((d) => d.id === deck.id) ?? deck;
      await this.viewer.open(fresh);
    });
  }

  curveBarHeight(count: number): number {
    const max = Math.max(1, ...this.viewer.manaCurve().map((b) => b.count));
    return count === 0 ? 0 : Math.max(6, (count / max) * 100);
  }

  pipBarWidth(count: number): number {
    const max = Math.max(1, ...this.viewer.pipDistribution().map((p) => p.count));
    return count === 0 ? 0 : Math.max(6, (count / max) * 100);
  }

  private readonly expandedEdhrecCategories = new Set<string>();

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
