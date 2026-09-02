import { COLORLESS, matchesColorSelection, toggleColorSelection } from './color-filter-match';

describe('color-filter-match', () => {
  it('sortiert die Auswahl in WUBRG-Reihenfolge', () => {
    expect(toggleColorSelection(toggleColorSelection([], 'G'), 'W')).toEqual(['W', 'G']);
  });

  it('schaltet eine gewählte Farbe wieder aus', () => {
    expect(toggleColorSelection(['W', 'U'], 'W')).toEqual(['U']);
  });

  it('schließt farblos und Farben gegenseitig aus', () => {
    expect(toggleColorSelection(['W', 'U'], COLORLESS)).toEqual([COLORLESS]);
    expect(toggleColorSelection([COLORLESS], 'U')).toEqual(['U']);
    expect(toggleColorSelection([COLORLESS], COLORLESS)).toEqual([]);
  });

  it('lässt ohne Auswahl alles durch', () => {
    expect(matchesColorSelection([], [])).toBe(true);
    expect(matchesColorSelection(['W', 'U'], [])).toBe(true);
  });

  it('verknüpft mehrere Farben mit UND', () => {
    expect(matchesColorSelection(['W', 'U'], ['W', 'U'])).toBe(true);
    expect(matchesColorSelection(['W', 'U', 'B'], ['W', 'U'])).toBe(true);
    expect(matchesColorSelection(['W'], ['W', 'U'])).toBe(false);
  });

  it('findet mit einer Farbe weiterhin auch mehrfarbige Karten', () => {
    expect(matchesColorSelection(['W', 'U'], ['W'])).toBe(true);
  });

  it('findet mit farblos nur Karten ohne Farbidentität', () => {
    expect(matchesColorSelection([], [COLORLESS])).toBe(true);
    expect(matchesColorSelection(['W'], [COLORLESS])).toBe(false);
  });
});
