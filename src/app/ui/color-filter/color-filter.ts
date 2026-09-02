import { Component, inject, model } from '@angular/core';
import { I18nService } from '../../i18n.service';
import { ManaSymbol } from '../mana-symbol/mana-symbol';

export type ColorFilterValue = 'all' | 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

/**
 * Farbfilter als Reihe echter Manasymbole - ersetzt das <select> mit den ausgeschriebenen
 * Farbnamen, das an fünf Stellen (Kartensuche, Deckbau, Deck-Kartenliste, Precon-Browser,
 * Deck-Browser) wortgleich stand.
 *
 * Ein natives <option> kann keine Symbole tragen: der Browser zeichnet die Auswahlliste selbst und
 * nimmt nur reinen Text. Deshalb Knöpfe statt Auswahlliste.
 *
 * .segmented und nicht .glass-chip, obwohl es ein Filter ist: es gilt immer genau eine Auswahl,
 * und genau dafür steht der zusammenhängende Block (siehe Rollenübersicht in styles.scss). Die
 * Farbfilter im Commander-Vorschlag und im Deck-Browser bleiben Chips, weil man dort mehrere
 * Farben gleichzeitig anhaken kann.
 */
@Component({
  selector: 'app-color-filter',
  imports: [ManaSymbol],
  host: { class: 'segmented mana-filter' },
  templateUrl: './color-filter.html',
})
export class ColorFilter {
  readonly i18n = inject(I18nService);

  readonly value = model.required<ColorFilterValue>();

  readonly colors: readonly ColorFilterValue[] = ['W', 'U', 'B', 'R', 'G', 'C'];

  label(color: ColorFilterValue): string {
    return color === 'C' ? this.i18n.t('deckView.colorless') : this.i18n.t(`pip.${color}`);
  }
}
