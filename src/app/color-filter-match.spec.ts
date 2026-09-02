import {
  COLORLESS,
  ColorSelection,
  EMPTY_COLOR_SELECTION,
  colorModeApplies,
  matchesColorSelection,
  toggleColorSelection,
} from './color-filter-match';

const exact = (...colors: string[]): ColorSelection => ({ colors, mode: 'exact' });
const atLeast = (...colors: string[]): ColorSelection => ({ colors, mode: 'atLeast' });

describe('color-filter-match', () => {
  it('sortiert die Auswahl in WUBRG-Reihenfolge', () => {
    const selection = toggleColorSelection(toggleColorSelection(EMPTY_COLOR_SELECTION, 'G'), 'W');
    expect(selection.colors).toEqual(['W', 'G']);
  });

  it('schaltet eine gewählte Farbe wieder aus', () => {
    expect(toggleColorSelection(exact('W', 'U'), 'W').colors).toEqual(['U']);
  });

  it('schließt farblos und Farben gegenseitig aus', () => {
    expect(toggleColorSelection(exact('W', 'U'), COLORLESS).colors).toEqual([COLORLESS]);
    expect(toggleColorSelection(exact(COLORLESS), 'U').colors).toEqual(['U']);
    expect(toggleColorSelection(exact(COLORLESS), COLORLESS).colors).toEqual([]);
  });

  it('behält die Lesart beim Umschalten einer Farbe', () => {
    expect(toggleColorSelection(atLeast('W'), 'U').mode).toBe('atLeast');
  });

  it('lässt ohne Auswahl alles durch', () => {
    expect(matchesColorSelection([], EMPTY_COLOR_SELECTION)).toBe(true);
    expect(matchesColorSelection(['W', 'U'], EMPTY_COLOR_SELECTION)).toBe(true);
  });

  it('findet mit "genau" nur die Karten dieser Farbkombination', () => {
    expect(matchesColorSelection(['U'], exact('U'))).toBe(true);
    expect(matchesColorSelection(['U', 'G'], exact('U'))).toBe(false);
    expect(matchesColorSelection(['U', 'G'], exact('U', 'G'))).toBe(true);
    expect(matchesColorSelection(['U', 'G', 'R'], exact('U', 'G'))).toBe(false);
  });

  it('lässt mit "enthält" auch weitere Farben zu', () => {
    expect(matchesColorSelection(['U', 'G'], atLeast('U'))).toBe(true);
    expect(matchesColorSelection(['U', 'G', 'R'], atLeast('U', 'G'))).toBe(true);
    expect(matchesColorSelection(['U', 'R'], atLeast('U', 'G'))).toBe(false);
  });

  it('findet mit farblos in beiden Lesarten nur Karten ohne Farbidentität', () => {
    expect(matchesColorSelection([], exact(COLORLESS))).toBe(true);
    expect(matchesColorSelection([], atLeast(COLORLESS))).toBe(true);
    expect(matchesColorSelection(['W'], atLeast(COLORLESS))).toBe(false);
  });

  it('bietet die Lesart nur an, wo sie einen Unterschied macht', () => {
    expect(colorModeApplies(EMPTY_COLOR_SELECTION)).toBe(false);
    expect(colorModeApplies(exact(COLORLESS))).toBe(false);
    expect(colorModeApplies(exact('U'))).toBe(true);
  });
});
