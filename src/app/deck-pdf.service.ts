import { Injectable, computed, signal } from '@angular/core';
import { DeckCard } from './deck.service';

export interface PdfCardEntry {
  cardName: string;
  quantity: number;
  imageUrl: string | null;
  selected: boolean;
}

// Echte Kartengröße (63x88mm) statt verkleinert, damit sich das PDF 1:1 zum Ausschneiden eignet.
const CARD_WIDTH_MM = 63;
const CARD_HEIGHT_MM = 88;
const COLUMNS = 3;
const ROWS = 3;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_X_MM = (PAGE_WIDTH_MM - COLUMNS * CARD_WIDTH_MM) / 2;
const MARGIN_Y_MM = (PAGE_HEIGHT_MM - ROWS * CARD_HEIGHT_MM) / 2;

/**
 * Erzeugt ein druckfertiges PDF (echte Kartengröße, Schnittlinien, 3x3 pro A4-Seite) aus einer
 * Deck-Kartenliste - hält den Auswahl-Dialog-Zustand global, damit er als eigene, root-level
 * gerenderte Komponente existieren kann (analog DeckImportService).
 */
@Injectable({ providedIn: 'root' })
export class DeckPdfService {
  readonly showDialog = signal(false);
  readonly deckName = signal('');
  readonly entries = signal<PdfCardEntry[]>([]);
  readonly copiesMode = signal<'one' | 'all'>('one');
  readonly busy = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly errorMessage = signal('');

  readonly selectedCount = computed(() => this.entries().filter((e) => e.selected).length);

  open(deckName: string, cards: DeckCard[]): void {
    this.deckName.set(deckName);
    this.entries.set(
      [...cards]
        .sort((a, b) => a.cardName.localeCompare(b.cardName))
        .map((c) => ({
          cardName: c.cardName,
          quantity: c.quantity,
          imageUrl: c.imageUrl,
          selected: true,
        }))
    );
    this.copiesMode.set('one');
    this.busy.set(false);
    this.progress.set(null);
    this.errorMessage.set('');
    this.showDialog.set(true);
  }

  close(): void {
    this.showDialog.set(false);
  }

  toggleCard(cardName: string): void {
    this.entries.update((list) =>
      list.map((e) => (e.cardName === cardName ? { ...e, selected: !e.selected } : e))
    );
  }

  setAllSelected(selected: boolean): void {
    this.entries.update((list) => list.map((e) => ({ ...e, selected })));
  }

  setCopiesMode(mode: 'one' | 'all'): void {
    this.copiesMode.set(mode);
  }

  private async fetchImageAsDataUrl(url: string): Promise<string | null> {
    try {
      // Der Proxy lässt aus Sicherheitsgründen nur cards.scryfall.io durch (siehe
      // functions/api/proxy-image.ts) - eigene, selbst hochgeladene Artworks liegen im
      // "deck-art"-Supabase-Bucket und müssen DIREKT geladen werden, sonst kommt vom Proxy ein 403
      // und die Karte fehlt einfach im PDF, ohne dass irgendwo ein Fehler auftaucht.
      const isScryfallImage = new URL(url, window.location.href).hostname === 'cards.scryfall.io';
      const fetchUrl = isScryfallImage ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
      const res = await fetch(fetchUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  async generatePdf(): Promise<void> {
    const selected = this.entries().filter((e) => e.selected && e.imageUrl);
    if (selected.length === 0) {
      this.errorMessage.set('Keine Karten mit Bild ausgewählt.');
      return;
    }

    this.busy.set(true);
    this.errorMessage.set('');

    // jsPDF erst hier per dynamischem Import nachladen statt fest im Hauptbundle - die Bibliothek
    // ist recht groß und wurde sonst von JEDEM Nutzer beim App-Start mitgeladen, obwohl kaum jemand
    // regelmäßig ein PDF exportiert (hat außerdem den Angular-Bundle-Budget-Grenzwert gesprengt und
    // den Produktions-Build fehlschlagen lassen).
    const { jsPDF } = await import('jspdf');

    // Jedes Bild nur einmal laden, auch wenn "jede Kopie einzeln" mehrfach dieselbe Karte braucht.
    const uniqueUrls = [...new Set(selected.map((e) => e.imageUrl!))];
    const imagesByUrl = new Map<string, string | null>();
    this.progress.set({ done: 0, total: uniqueUrls.length });

    for (const url of uniqueUrls) {
      imagesByUrl.set(url, await this.fetchImageAsDataUrl(url));
      this.progress.update((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    const copiesMode = this.copiesMode();
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    let slot = 0;

    for (const entry of selected) {
      const dataUrl = imagesByUrl.get(entry.imageUrl!);
      if (!dataUrl) continue;

      const copies = copiesMode === 'all' ? entry.quantity : 1;
      for (let i = 0; i < copies; i++) {
        if (slot > 0 && slot % (COLUMNS * ROWS) === 0) pdf.addPage();
        const posInPage = slot % (COLUMNS * ROWS);
        const col = posInPage % COLUMNS;
        const row = Math.floor(posInPage / COLUMNS);
        const x = MARGIN_X_MM + col * CARD_WIDTH_MM;
        const y = MARGIN_Y_MM + row * CARD_HEIGHT_MM;

        pdf.addImage(dataUrl, 'JPEG', x, y, CARD_WIDTH_MM, CARD_HEIGHT_MM);
        pdf.setDrawColor(180);
        pdf.setLineWidth(0.1);
        pdf.rect(x, y, CARD_WIDTH_MM, CARD_HEIGHT_MM);

        slot++;
      }
    }

    this.busy.set(false);
    this.progress.set(null);

    if (slot === 0) {
      this.errorMessage.set('Keine Kartenbilder konnten geladen werden.');
      return;
    }

    const fileName = `${this.deckName().replace(/[^\w\-() ]+/g, '').trim() || 'deck'}.pdf`;
    pdf.save(fileName);
    this.showDialog.set(false);
  }
}
