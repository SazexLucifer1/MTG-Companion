import { Component, inject, model } from '@angular/core';
import { I18nService } from '../../i18n.service';
import { ManaSymbol } from '../mana-symbol/mana-symbol';

export type CmcFilterValue = 'all' | number;

/** Höchster einzeln filterbarer Manawert - alles darüber fällt unter "7+". */
const MAX_CMC = 7;

/**
 * Manawert-Filter als Reihe generischer Manakosten-Symbole (die grauen Kreise mit der Zahl) -
 * ersetzt das <select> mit den nackten Ziffern in Kartensuche und Deckbau.
 *
 * Zur Rollenwahl (.segmented statt Chips) und dazu, warum es keine Auswahlliste mehr ist, siehe
 * die Begründung in color-filter.ts - beide Filter stehen in derselben Zeile und sollen sich
 * gleich anfühlen.
 */
@Component({
  selector: 'app-cmc-filter',
  imports: [ManaSymbol],
  host: { class: 'segmented mana-filter' },
  templateUrl: './cmc-filter.html',
  styleUrl: './cmc-filter.scss',
})
export class CmcFilter {
  readonly i18n = inject(I18nService);

  readonly value = model.required<CmcFilterValue>();

  readonly values: readonly number[] = [0, 1, 2, 3, 4, 5, 6, MAX_CMC];

  /** Das oberste Segment sammelt alles ab diesem Wert ein, deshalb "7+" statt "7". */
  isOpenEnd(value: number): boolean {
    return value === MAX_CMC;
  }

  label(value: number): string {
    return this.i18n.t('deckView.cmcValueAria', { value: this.isOpenEnd(value) ? `${value}+` : value });
  }
}
