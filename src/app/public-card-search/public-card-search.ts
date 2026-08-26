// NEU
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScryfallCard, ScryfallService } from '../scryfall.service';
import { CardPreviewService } from '../card-preview.service';
import { PublicCardSearchService } from '../public-card-search.service';
import { I18nService } from '../i18n.service';
import { CardImage } from '../card-image/card-image';

/**
 * Öffentliche Kartensuche - ohne Account nutzbar (Fan-Content-Policy). Nutzt bewusst
 * autocompleteAnyCard() statt der Commander-only autocomplete()/searchCards(), da hier jede
 * Karte gefunden werden soll, nicht nur Commander-legale.
 */
@Component({
  selector: 'app-public-card-search',
  imports: [FormsModule, CardImage],
  templateUrl: './public-card-search.html',
  styleUrl: './public-card-search.scss',
})
export class PublicCardSearch {
  private readonly scryfall = inject(ScryfallService);
  private readonly cardPreview = inject(CardPreviewService);
  readonly service = inject(PublicCardSearchService);
  readonly i18n = inject(I18nService);

  readonly query = signal('');
  readonly suggestions = signal<string[]>([]);
  readonly result = signal<ScryfallCard | null>(null);
  readonly searched = signal(false);
  readonly loading = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  onQueryInput(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(async () => {
      this.suggestions.set(await this.scryfall.autocompleteAnyCard(value));
    }, 250);
  }

  async selectCard(name: string): Promise<void> {
    this.suggestions.set([]);
    this.query.set(name);
    this.loading.set(true);
    this.searched.set(true);
    this.result.set(await this.scryfall.findCard(name));
    this.loading.set(false);
  }

  async submit(): Promise<void> {
    if (!this.query().trim()) return;
    await this.selectCard(this.query());
  }

  openPreview(card: ScryfallCard): void {
    if (!card.imageUrl) return;
    this.cardPreview.open(card.imageUrl, card.backImageUrl, card.name);
  }

  close(): void {
    this.service.close();
  }
}
