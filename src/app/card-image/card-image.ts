import { Component, inject, input, signal } from '@angular/core';
import { I18nService } from '../i18n.service';

/**
 * Wiederverwendbares Kartenbild mit Umdreh-Button für Doppelkarten (Transform/Modal-DFC) - Ersatz
 * für ein bloßes <img>, überall dort einsetzbar, wo eine Karte mit bekanntem backImageUrl gezeigt
 * wird (siehe ScryfallCard.backImageUrl). Erwartet, dass der Aufrufer bereits selbst geprüft hat,
 * ob überhaupt ein Bild vorliegt (siehe bestehendes @if (img; as img) … @else { Platzhalter }-Muster
 * an allen Einsatzorten) - "kein Bild" bleibt bewusst Sache des Aufrufers, da der Platzhaltertext
 * sich von Ort zu Ort unterscheidet (Kartenname, Deckname, Commander-Name, …).
 */
@Component({
  selector: 'app-card-image',
  templateUrl: './card-image.html',
  styleUrl: './card-image.scss',
  host: {
    '[class.compact]': 'compact()',
  },
})
export class CardImage {
  readonly i18n = inject(I18nService);

  readonly imageUrl = input.required<string>();
  /** Rückseite bei echten Transform/Modal-DFC-Karten - fehlt/null bei einseitigen Karten, dann wird gar kein Umdreh-Button gezeigt. */
  readonly backImageUrl = input<string | null | undefined>(null);
  readonly alt = input<string | null | undefined>('');
  /** Kleinere Variante des Umdreh-Buttons für sehr schmale Vorschaubilder (z.B. 40px im Match-Tab-Deck-Picker, 48px in Profil-/Stats-Listen). */
  readonly compact = input(false);

  /**
   * Rein lokaler Anzeige-Zustand - jede @for-Schleifen-Instanz bekommt automatisch ihre eigene
   * Komponenteninstanz und damit ihren eigenen Flip-Zustand, ganz ohne Set<string>/frontFaceKey-
   * Buchhaltung im Aufrufer (im Unterschied zum älteren, in deck-viewer.service.ts kopierten Muster).
   */
  readonly showingBack = signal(false);

  toggleFlip(event: Event): void {
    // Verhindert, dass ein Klick auf den Umdreh-Button eine umschließende klickbare Zeile/Karte
    // (Zeilen-Aufklappen, Favoriten-Dialog, …) mit-auslöst - jeder Aufrufer muss sich darum anders
    // als beim alten kopierten Muster nicht mehr selbst kümmern.
    event.stopPropagation();
    this.showingBack.update((v) => !v);
  }
}
