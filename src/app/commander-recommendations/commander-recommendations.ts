// NEU
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PercentPipe } from '@angular/common';
import { ScryfallCard, ScryfallService } from '../scryfall.service';
import { EdhrecCardlist, EdhrecService, EdhrecTag } from '../edhrec.service';
import { CardPreviewService } from '../card-preview.service';
import { I18nService } from '../i18n.service';
import { CardImage } from '../card-image/card-image';

/**
 * Commander-Empfehlungen (EDHREC) - ohne Account/Deck nutzbar, eigener Umschalter im Suche-Tab.
 * Rein lesend (kein "zum Deck hinzufügen"), dafür mit Zoom über CardPreviewService. Spiegelt das
 * bestehende Muster aus deck-viewer.service.ts/deck-detail-view.html (dort an ein konkretes Deck
 * gebunden), hält den Zustand aber komplett lokal statt DeckViewerService zu injizieren - der ist
 * viel zu groß und an Deck-Schreiboperationen gebunden, unpassend für diese anonyme Route.
 *
 * Zusätzlich zur direkten Namenseingabe gibt es einen Entdecken-Modus: Farb- und Archetyp-Filter
 * sind zwei unabhängige, frei kombinierbare Filter (edhrec.service.ts's getTopCommandersForColors()/
 * getTopCommandersForTag()/getAllTags()) - ein Klick auf einen der vorgeschlagenen Commander springt
 * direkt in dessen Detailansicht.
 */
@Component({
  selector: 'app-commander-recommendations',
  imports: [FormsModule, CardImage, PercentPipe],
  templateUrl: './commander-recommendations.html',
  styleUrl: './commander-recommendations.scss',
})
export class CommanderRecommendations {
  private readonly scryfall = inject(ScryfallService);
  private readonly edhrec = inject(EdhrecService);
  private readonly cardPreview = inject(CardPreviewService);
  readonly i18n = inject(I18nService);

  readonly query = signal('');
  readonly suggestions = signal<string[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly commanderName = signal<string | null>(null);
  readonly commanderCard = signal<ScryfallCard | null>(null);
  readonly tags = signal<EdhrecTag[]>([]);
  readonly selectedTag = signal<string | null>(null);
  readonly lists = signal<EdhrecCardlist[] | null>(null);
  readonly busy = signal(false);
  readonly failed = signal(false);

  readonly expandedCategories = signal<Set<string>>(new Set());
  readonly cardDetails = signal<Map<string, ScryfallCard>>(new Map());
  readonly categoryImagesBusy = signal<Set<string>>(new Set());

  // --- Entdecken: Farb-/Archetyp-Filter statt direkter Namenseingabe ---

  readonly colorOptions = ['W', 'U', 'B', 'R', 'G'];
  readonly browseColors = signal<Set<string>>(new Set());
  readonly browseTheme = signal<string | null>(null);
  readonly browseLists = signal<EdhrecCardlist[] | null>(null);
  readonly browseBusy = signal(false);
  readonly browseFailed = signal(false);

  /**
   * EDHRECs vollständige, farbunabhängige Archetyp-Liste (getAllTags(), edhrec.com/tags/themes) -
   * einmalig beim Öffnen geladen, NICHT von der Farbauswahl abhängig, damit sich Farbe und Archetyp
   * frei und unabhängig voneinander kombinieren lassen (explizit vom Nutzer gewünscht: Archetyp-
   * Suche soll auch ohne vorherige Farbeinschränkung funktionieren). Null solange noch nicht
   * geladen/fehlgeschlagen.
   */
  readonly themeOptions = signal<EdhrecTag[] | null>(null);

  constructor() {
    this.edhrec.getAllTags().then((tags) => this.themeOptions.set(tags ?? []));
  }

  toggleBrowseColor(color: string): void {
    const next = new Set(this.browseColors());
    if (next.has(color)) next.delete(color);
    else next.add(color);
    this.browseColors.set(next);
  }

  setBrowseTheme(value: string): void {
    this.browseTheme.set(value === 'all' ? null : value);
  }

  canBrowse(): boolean {
    return this.browseColors().size > 0 || this.browseTheme() !== null;
  }

  async browse(): Promise<void> {
    if (!this.canBrowse()) return;
    this.browseBusy.set(true);
    this.browseFailed.set(false);
    this.browseLists.set(null);

    const colors = [...this.browseColors()];
    const theme = this.browseTheme();
    const result = theme
      ? await this.edhrec.getTopCommandersForTag(theme, colors)
      : await this.edhrec.getTopCommandersForColors(colors);

    this.browseLists.set(result);
    this.browseFailed.set(result === null);
    this.browseBusy.set(false);
  }

  resetBrowse(): void {
    this.browseColors.set(new Set());
    this.browseTheme.set(null);
    this.browseLists.set(null);
    this.browseFailed.set(false);
  }

  // --- Direkte Namenssuche ---

  onQueryInput(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(async () => {
      this.suggestions.set(await this.scryfall.autocomplete(value));
    }, 250);
  }

  async selectCommander(name: string): Promise<void> {
    this.suggestions.set([]);
    this.query.set(name);
    this.commanderName.set(name);
    this.commanderCard.set(null);
    this.selectedTag.set(null);
    this.expandedCategories.set(new Set());
    this.cardDetails.set(new Map());
    this.tags.set([]);
    await Promise.all([this.loadRecommendations(), this.loadCommanderCard(name)]);
    this.tags.set((await this.edhrec.getCommanderTags([name])) ?? []);
  }

  backToBrowse(): void {
    this.commanderName.set(null);
    this.commanderCard.set(null);
    this.lists.set(null);
    this.query.set('');
  }

  private async loadCommanderCard(name: string): Promise<void> {
    this.commanderCard.set(await this.scryfall.findCard(name));
  }

  setTag(tagSlug: string | null): void {
    if (tagSlug === this.selectedTag()) return;
    this.selectedTag.set(tagSlug);
    this.expandedCategories.set(new Set());
    this.cardDetails.set(new Map());
    this.loadRecommendations();
  }

  private async loadRecommendations(): Promise<void> {
    const name = this.commanderName();
    if (!name) return;
    this.busy.set(true);
    this.failed.set(false);
    const result = await this.edhrec.getCommanderRecommendations([name], this.selectedTag());
    this.lists.set(result);
    this.failed.set(result === null);
    this.busy.set(false);
  }

  isExpanded(tag: string): boolean {
    return this.expandedCategories().has(tag);
  }

  async toggleCategory(list: EdhrecCardlist): Promise<void> {
    const expanded = new Set(this.expandedCategories());
    if (expanded.has(list.tag)) {
      expanded.delete(list.tag);
      this.expandedCategories.set(expanded);
      return;
    }
    expanded.add(list.tag);
    this.expandedCategories.set(expanded);

    const known = this.cardDetails();
    const missing = list.cards.map((c) => c.name).filter((n) => !known.has(n.toLowerCase()));
    if (missing.length === 0) return;

    this.categoryImagesBusy.update((set) => new Set(set).add(list.tag));
    const found = await this.scryfall.findCardsBulk(missing);
    this.cardDetails.update((current) => new Map([...current, ...found]));
    this.categoryImagesBusy.update((set) => {
      const next = new Set(set);
      next.delete(list.tag);
      return next;
    });
  }

  isCategoryImagesBusy(tag: string): boolean {
    return this.categoryImagesBusy().has(tag);
  }

  cardImage(cardName: string): string | null {
    return this.cardDetails().get(cardName.toLowerCase())?.imageUrl ?? null;
  }

  cardBackImage(cardName: string): string | null {
    return this.cardDetails().get(cardName.toLowerCase())?.backImageUrl ?? null;
  }

  openPreview(cardName: string): void {
    const card = this.cardDetails().get(cardName.toLowerCase());
    if (!card?.imageUrl) return;
    this.cardPreview.open(card.imageUrl, card.backImageUrl, card.name);
  }

  openCommanderPreview(): void {
    const card = this.commanderCard();
    if (!card?.imageUrl) return;
    this.cardPreview.open(card.imageUrl, card.backImageUrl, card.name);
  }
}
