import { axisPoint, polygonPoints, ringPoints } from './radar-geometry';

/**
 * Die Geometrie entscheidet, ob das Netz überhaupt als Sechseck erkennbar ist: eine falsche
 * Startachse kippt die Figur, ein Vorzeichenfehler spiegelt sie. Beides fällt im Browser erst auf,
 * wenn man es sieht - hier fällt es sofort auf.
 */
describe('radar-geometry', () => {
  it('legt die erste Achse genau nach oben', () => {
    expect(axisPoint(0, 6, 40)).toEqual({ x: 50, y: 10 });
  });

  it('läuft im Uhrzeigersinn weiter', () => {
    // Bei sechs Achsen sitzt die zweite 60° weiter, also rechts oben, die vierte genau unten.
    const second = axisPoint(1, 6, 40);
    expect(second.x).toBeGreaterThan(50);
    expect(second.y).toBeLessThan(50);
    expect(axisPoint(3, 6, 40)).toEqual({ x: 50, y: 90 });
  });

  it('hält alle Achsen auf demselben Abstand zum Mittelpunkt', () => {
    for (let i = 0; i < 6; i++) {
      const { x, y } = axisPoint(i, 6, 40);
      expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(40, 3);
    }
  });

  it('zieht einen Radius von 0 auf den Mittelpunkt zusammen', () => {
    expect(axisPoint(2, 6, 0)).toEqual({ x: 50, y: 50 });
  });

  it('erzeugt je Radius einen Eckpunkt', () => {
    expect(polygonPoints([10, 20, 30, 40, 50, 60]).split(' ')).toHaveLength(6);
    expect(polygonPoints([])).toBe('');
  });

  it('baut den Gitterring als gleichmäßiges Vieleck', () => {
    const ring = ringPoints(6, 40);
    expect(ring.split(' ')).toHaveLength(6);
    expect(ring.startsWith('50,10')).toBe(true);
  });
});
