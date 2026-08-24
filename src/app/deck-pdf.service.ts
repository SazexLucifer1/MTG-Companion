import { Injectable, computed, inject, signal } from '@angular/core';
import { I18nService } from './i18n.service';

export interface PdfSourceCard {
  cardName: string;
  quantity: number;
  imageUrl: string | null;
  backImageUrl: string | null;
}

export interface PdfCardEntry {
  cardName: string;
  quantity: number;
  imageUrl: string | null;
  backImageUrl: string | null;
  selected: boolean;
}

// Echte Kartengröße (63,5x88,9mm / 2,5"x3,5") statt gerundet, damit sich das PDF 1:1 zum Ausschneiden eignet.
const CARD_WIDTH_MM = 63.5;
const CARD_HEIGHT_MM = 88.9;
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
  readonly i18n = inject(I18nService);

  readonly showDialog = signal(false);
  readonly deckName = signal('');
  readonly entries = signal<PdfCardEntry[]>([]);
  readonly copiesMode = signal<'one' | 'all'>('one');
  readonly busy = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly errorMessage = signal('');

  readonly selectedCount = computed(() => this.entries().filter((e) => e.selected).length);

  /** Reihenfolge kommt unverändert vom Aufrufer (Deck-Gruppierung wie beim Deckbauen) - hier bewusst NICHT alphabetisch sortieren. */
  open(deckName: string, cards: PdfSourceCard[]): void {
    this.deckName.set(deckName);
    this.entries.set(
      cards.map((c) => ({
        cardName: c.cardName,
        quantity: c.quantity,
        imageUrl: c.imageUrl,
        backImageUrl: c.backImageUrl,
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

  /**
   * Zeichnet ein geladenes Bild sofort auf ein Offscreen-Canvas in exakt der im PDF benötigten
   * Pixelgröße (300 DPI bei Kartengröße - entspricht ungefähr Scryfalls nativer "png"-Auflösung,
   * also kein wahrnehmbarer Qualitätsverlust) und kodiert es als komprimiertes JPEG neu. Grund:
   * Scryfalls "png"-Druckvariante ist unkomprimiert mit Alphakanal und dadurch um ein Vielfaches
   * größer als nötig - bei größeren Decks mit Vorder+Rückseiten hat das den Speicher mobiler
   * Browser-Tabs gesprengt und die App zum Abstürzen/Neuladen gebracht. Ein data:-URL als Bildquelle
   * gilt für <canvas> immer als same-origin, es gibt also kein CORS-Problem.
   */
  private async recompressForPrint(dataUrl: string): Promise<string> {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image load failed'));
        el.src = dataUrl;
      });
      const targetW = Math.round((CARD_WIDTH_MM / 25.4) * 300);
      const targetH = Math.round((CARD_HEIGHT_MM / 25.4) * 300);
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return dataUrl;
      // Weißer Hintergrund statt Transparenz - die png-Variante hat abgerundete Ecken mit Alpha,
      // die beim Drucken auf weißem Papier ohnehin weiß erscheinen sollen.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      // Im Zweifel lieber das Original verwenden als das Bild ganz zu verlieren.
      return dataUrl;
    }
  }

  async generatePdf(): Promise<void> {
    const selected = this.entries().filter((e) => e.selected && e.imageUrl);
    if (selected.length === 0) {
      this.errorMessage.set(this.i18n.t('pdfDialog.msg.noCardsSelected'));
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
    // Rückseiten-URLs (doppelseitige Karten) zählen dabei genauso mit wie die Vorderseiten.
    const uniqueUrls = [
      ...new Set(selected.flatMap((e) => [e.imageUrl, e.backImageUrl].filter((u): u is string => !!u))),
    ];
    const imagesByUrl = new Map<string, string | null>();
    this.progress.set({ done: 0, total: uniqueUrls.length });

    for (const url of uniqueUrls) {
      const raw = await this.fetchImageAsDataUrl(url);
      imagesByUrl.set(url, raw ? await this.recompressForPrint(raw) : null);
      this.progress.update((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    const copiesMode = this.copiesMode();
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    let slot = 0;

    // Durchgehende Schnittlinien bis zum Papierrand statt einzelner Rechtecke pro Karte - da die
    // Karten im Raster lückenlos aneinander liegen, lässt sich damit mit einem geraden Schnitt
    // (Lineal/Schneidemaschine) über die komplette Seite schneiden. Wird VOR den Kartenbildern der
    // jeweiligen Seite gezeichnet, damit die Linien nur in den Rand-/Zwischenbereichen sichtbar
    // bleiben und nicht über den Kartenmotiven liegen.
    const drawCutLines = (): void => {
      pdf.setDrawColor(180);
      pdf.setLineWidth(0.1);
      for (let col = 0; col <= COLUMNS; col++) {
        const x = MARGIN_X_MM + col * CARD_WIDTH_MM;
        pdf.line(x, 0, x, PAGE_HEIGHT_MM);
      }
      for (let row = 0; row <= ROWS; row++) {
        const y = MARGIN_Y_MM + row * CARD_HEIGHT_MM;
        pdf.line(0, y, PAGE_WIDTH_MM, y);
      }
    };
    drawCutLines();

    const placeCard = (dataUrl: string): void => {
      if (slot > 0 && slot % (COLUMNS * ROWS) === 0) {
        pdf.addPage();
        drawCutLines();
      }
      const posInPage = slot % (COLUMNS * ROWS);
      const col = posInPage % COLUMNS;
      const row = Math.floor(posInPage / COLUMNS);
      const x = MARGIN_X_MM + col * CARD_WIDTH_MM;
      const y = MARGIN_Y_MM + row * CARD_HEIGHT_MM;

      // png-Druckvariante hat echte Transparenz (abgerundete Ecken), normale/eigene Bilder sind JPEG -
      // das Format muss zum tatsächlichen Inhalt des Daten-URLs passen, sonst stellt jsPDF es falsch dar.
      const format = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(dataUrl, format, x, y, CARD_WIDTH_MM, CARD_HEIGHT_MM);

      slot++;
    };

    for (const entry of selected) {
      const dataUrl = imagesByUrl.get(entry.imageUrl!);
      if (!dataUrl) continue;
      const backDataUrl = entry.backImageUrl ? imagesByUrl.get(entry.backImageUrl) : null;

      const copies = copiesMode === 'all' ? entry.quantity : 1;
      for (let i = 0; i < copies; i++) {
        placeCard(dataUrl);
        if (backDataUrl) placeCard(backDataUrl);
      }
    }

    this.busy.set(false);
    this.progress.set(null);

    if (slot === 0) {
      this.errorMessage.set(this.i18n.t('pdfDialog.msg.noImagesLoaded'));
      return;
    }

    const fileName = `${this.deckName().replace(/[^\w\-() ]+/g, '').trim() || 'deck'}.pdf`;
    pdf.save(fileName);
    this.showDialog.set(false);
  }
}
