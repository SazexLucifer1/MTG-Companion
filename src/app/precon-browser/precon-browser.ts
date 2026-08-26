import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PreconService, PreconSummary } from '../precon.service';
import { DeckService } from '../deck.service';
import { ScryfallCard, ScryfallService } from '../scryfall.service';
import { CardPreviewService } from '../card-preview.service';
import { I18nService } from '../i18n.service';
import { CardImage } from '../card-image/card-image';
import { PartnerCardImage } from '../partner-card-image/partner-card-image';

interface PreconCardEntry {
  card: ScryfallCard;
  quantity: number;
}

/**
 * Precons durchsuchen (Jahr + Name) und rein lesend ansehen - ohne Account nutzbar, eigener
 * Umschalter im Suche-Tab. Nutzt PreconService (MTGJSON) wie bisher schon der Import-Dialog
 * (DeckImportService.openPreconDialog()), hier aber zum Anzeigen statt Importieren. Hält den
 * Zustand komplett lokal statt DeckViewerService zu injizieren - der ist viel zu groß und an
 * Deck-Schreiboperationen gebunden, unpassend für diese anonyme Route (gleiche Entscheidung wie
 * commander-recommendations.ts/public-card-search.ts).
 */
@Component({
  selector: 'app-precon-browser',
  imports: [FormsModule, CardImage, PartnerCardImage],
  templateUrl: './precon-browser.html',
  styleUrl: './precon-browser.scss',
})
export class PreconBrowser {
  private readonly precon = inject(PreconService);
  private readonly deckService = inject(DeckService);
  private readonly scryfall = inject(ScryfallService);
  private readonly cardPreview = inject(CardPreviewService);
  readonly i18n = inject(I18nService);

  readonly year = signal(new Date().getFullYear());
  readonly nameFilter = signal('');
  readonly precons = signal<PreconSummary[]>([]);
  readonly busy = signal(false);

  readonly filteredPrecons = computed(() => {
    const query = this.nameFilter().trim().toLowerCase();
    if (!query) return this.precons();
    return this.precons().filter((p) => p.name.toLowerCase().includes(query));
  });

  readonly selected = signal<PreconSummary | null>(null);
  readonly commanderCards = signal<ScryfallCard[]>([]);
  readonly mainCards = signal<PreconCardEntry[]>([]);
  readonly deckBusy = signal(false);
  readonly deckFailed = signal(false);

  constructor() {
    this.searchPrecons();
  }

  setYear(value: string): void {
    const year = Number(value);
    if (Number.isNaN(year)) return;
    this.year.set(year);
    this.searchPrecons();
  }

  async searchPrecons(): Promise<void> {
    this.busy.set(true);
    this.precons.set(await this.precon.getPreconsForYear(this.year()));
    this.busy.set(false);
  }

  async openPrecon(p: PreconSummary): Promise<void> {
    this.selected.set(p);
    this.commanderCards.set([]);
    this.mainCards.set([]);
    this.deckBusy.set(true);
    this.deckFailed.set(false);

    const text = await this.precon.loadPreconAsText(p.fileName);
    if (!text) {
      this.deckFailed.set(true);
      this.deckBusy.set(false);
      return;
    }

    const parsed = this.deckService.parseDecklistText(text);
    const cardMap = await this.scryfall.findCardsBulk(parsed.map((p) => p.name));

    const commanders: ScryfallCard[] = [];
    const main: PreconCardEntry[] = [];
    for (const entry of parsed) {
      const card = cardMap.get(entry.name.toLowerCase());
      if (!card) continue;
      if (entry.isCommander) commanders.push(card);
      else main.push({ card, quantity: entry.quantity });
    }

    this.commanderCards.set(commanders);
    this.mainCards.set(main);
    this.deckBusy.set(false);
  }

  backToList(): void {
    this.selected.set(null);
    this.commanderCards.set([]);
    this.mainCards.set([]);
  }

  openPreview(card: ScryfallCard): void {
    if (!card.imageUrl) return;
    this.cardPreview.open(card.imageUrl, card.backImageUrl, card.name);
  }
}
