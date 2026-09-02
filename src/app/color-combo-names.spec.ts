import { colorComboName, sortColors } from './color-combo-names';

/**
 * Die Namenstabelle ist von Hand gepflegt und liegt in WUBRG-Reihenfolge - hereinkommen können die
 * Farben aber in jeder Reihenfolge (die Farbidentität eines Decks kommt so aus der Datenbank, wie
 * sie dort steht). Diese Tests halten beides fest: die Sortierung und ein paar Namen aus jeder
 * Gruppe, bei denen ein Zahlendreher in der Tabelle sonst unbemerkt bliebe.
 */
describe('color-combo-names', () => {
  it('sortiert Farben in die WUBRG-Reihenfolge', () => {
    expect(sortColors(['G', 'W', 'U'])).toEqual(['W', 'U', 'G']);
    expect(sortColors(['R', 'B'])).toEqual(['B', 'R']);
  });

  it('findet Gildennamen unabhängig von der Eingabereihenfolge', () => {
    expect(colorComboName(['W', 'U'])).toBe('Azorius');
    expect(colorComboName(['U', 'W'])).toBe('Azorius');
    expect(colorComboName(['R', 'W'])).toBe('Boros');
    expect(colorComboName(['G', 'B'])).toBe('Golgari');
  });

  it('kennt Schattenreiche und Keile', () => {
    expect(colorComboName(['U', 'B', 'R'])).toBe('Grixis');
    expect(colorComboName(['G', 'W', 'U'])).toBe('Bant');
    expect(colorComboName(['R', 'W', 'B'])).toBe('Mardu');
    expect(colorComboName(['G', 'U', 'R'])).toBe('Temur');
  });

  it('kennt die Vierfarben-Namen', () => {
    expect(colorComboName(['W', 'U', 'B', 'R'])).toBe('Yore-Tiller');
    expect(colorComboName(['G', 'W', 'U', 'B'])).toBe('Witch-Maw');
  });

  it('hat keinen Eigennamen für eine Farbe, keine Farbe und alle fünf', () => {
    expect(colorComboName([])).toBeNull();
    expect(colorComboName(['W'])).toBeNull();
    expect(colorComboName(['W', 'U', 'B', 'R', 'G'])).toBeNull();
  });
});
