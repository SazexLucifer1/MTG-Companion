import { Component, computed, input } from '@angular/core';

/**
 * Ein einzelnes Manasymbol (W/U/B/R/G und C für farblos) aus der Mana-Schriftart.
 *
 * Ersetzt die farbigen Punkte, die vorher an vier Stellen einzeln nachgebaut waren (Farbfilter im
 * Commander-Vorschlag und im öffentlichen Deck-Browser, Farbkombinationen im Profil, Balken-
 * beschriftungen): ein Kreis in Rot bedeutet nur für den etwas, der die Legende kennt, das echte
 * Symbol ist für jeden Magic-Spieler eindeutig - auch für den, der Rot und Grün nicht
 * unterscheiden kann.
 *
 * Die Schrift kommt aus dem Paket mana-font (Andrew Gioia, MIT); die Einbindung steht in
 * src/styles/_mana.scss.
 */
@Component({
  selector: 'app-mana-symbol',
  template: `<i [class]="symbolClass()" aria-hidden="true"></i>`,
  styleUrl: './mana-symbol.scss',
})
export class ManaSymbol {
  /** Farbbuchstabe: W, U, B, R oder G - alles andere (z.B. 'C' oder '') gilt als farblos. */
  readonly symbol = input.required<string>();

  /**
   * Rein dekorativ, deshalb aria-hidden: jede Einsatzstelle schreibt den Farbnamen daneben aus.
   * Ein Symbol OHNE danebenstehenden Namen bräuchte stattdessen role="img" und ein aria-label.
   *
   * .ms-cost legt den runden Symbolgrund in der jeweiligen Manafarbe darunter, .ms-shadow den
   * dünnen dunklen Rand, den die Symbole auch auf den Karten haben - ohne den verschwimmt das
   * fast weiße W-Symbol auf hellen Hintergrundbildern.
   */
  readonly symbolClass = computed(() => {
    const letter = this.symbol().toUpperCase();
    const known = 'WUBRG'.includes(letter) ? letter.toLowerCase() : 'c';
    return `ms ms-${known} ms-cost ms-shadow`;
  });
}
