import { describe, it, expect } from 'vitest';
import { baseColor, shadeColor, lerpToWhite, densityShade, ROOF_ACCENT_BRIGHTEN } from './cubePalette';

// Helpers for assertions
const isFiniteInt = (n: number) => Number.isFinite(n) && Number.isInteger(n);
const inColorRange = (n: number) => n >= 0 && n <= 0xffffff;

describe('cubePalette', () => {
  // ------------------------------------------------------------------
  // baseColor
  // ------------------------------------------------------------------
  describe('baseColor', () => {
    it('residential returns a color in [0, 0xffffff]', () => {
      const c = baseColor('residential');
      expect(isFiniteInt(c)).toBe(true);
      expect(inColorRange(c)).toBe(true);
    });

    it('commercial returns a color in [0, 0xffffff]', () => {
      const c = baseColor('commercial');
      expect(isFiniteInt(c)).toBe(true);
      expect(inColorRange(c)).toBe(true);
    });

    it('industrial returns a color in [0, 0xffffff]', () => {
      const c = baseColor('industrial');
      expect(isFiniteInt(c)).toBe(true);
      expect(inColorRange(c)).toBe(true);
    });

    // Snapshot one value per type so regression is obvious.
    it('residential snapshot: 0xc2e8a0', () => {
      expect(baseColor('residential')).toBe(0xc2e8a0);
    });

    it('commercial snapshot: 0xa8c6f0', () => {
      expect(baseColor('commercial')).toBe(0xa8c6f0);
    });

    it('industrial snapshot: 0xf0c890', () => {
      expect(baseColor('industrial')).toBe(0xf0c890);
    });
  });

  // ------------------------------------------------------------------
  // densityShade — 3 density tiers
  // ------------------------------------------------------------------
  describe('densityShade', () => {
    it('density 0 returns 1.0', () => {
      expect(densityShade(0)).toBe(1.0);
    });

    it('density 1 returns 0.92', () => {
      expect(densityShade(1)).toBe(0.92);
    });

    it('density 2 returns 0.82', () => {
      expect(densityShade(2)).toBe(0.82);
    });
  });

  // ------------------------------------------------------------------
  // shadeColor — all 3 types × 3 densities produce valid integers
  // ------------------------------------------------------------------
  describe('shadeColor with densityShade across type×density', () => {
    const types = ['residential', 'commercial', 'industrial'] as const;
    const densities = [0, 1, 2] as const;

    for (const type of types) {
      for (const density of densities) {
        it(`${type} density=${density}: shadeColor result is a finite integer in [0, 0xffffff]`, () => {
          const shaded = shadeColor(baseColor(type), densityShade(density));
          expect(isFiniteInt(shaded)).toBe(true);
          expect(inColorRange(shaded)).toBe(true);
        });
      }
    }

    // Snapshot one (type, density) triple per type.
    it('residential density=1 shaded snapshot', () => {
      // 0xc2e8a0 × 0.92 channel-wise
      const r = Math.round(0xc2 * 0.92); // 178
      const g = Math.round(0xe8 * 0.92); // 214
      const b = Math.round(0xa0 * 0.92); // 147
      const expected = (r << 16) | (g << 8) | b;
      expect(shadeColor(baseColor('residential'), densityShade(1))).toBe(expected);
    });

    it('commercial density=2 shaded snapshot', () => {
      const r = Math.round(0xa8 * 0.82);
      const g = Math.round(0xc6 * 0.82);
      const b = Math.round(0xf0 * 0.82);
      const expected = (r << 16) | (g << 8) | b;
      expect(shadeColor(baseColor('commercial'), densityShade(2))).toBe(expected);
    });

    it('industrial density=0 shaded snapshot equals baseColor (factor 1.0)', () => {
      expect(shadeColor(baseColor('industrial'), densityShade(0))).toBe(baseColor('industrial'));
    });
  });

  // ------------------------------------------------------------------
  // lerpToWhite
  // ------------------------------------------------------------------
  describe('lerpToWhite', () => {
    it('t=0 returns the original color', () => {
      const c = baseColor('residential');
      expect(lerpToWhite(c, 0)).toBe(c);
    });

    it('t=1 returns 0xffffff', () => {
      expect(lerpToWhite(baseColor('commercial'), 1)).toBe(0xffffff);
    });

    it('result is a finite integer in [0, 0xffffff] for all types at ROOF_ACCENT_BRIGHTEN', () => {
      for (const type of ['residential', 'commercial', 'industrial'] as const) {
        const result = lerpToWhite(baseColor(type), ROOF_ACCENT_BRIGHTEN);
        expect(isFiniteInt(result)).toBe(true);
        expect(inColorRange(result)).toBe(true);
      }
    });
  });

  // ------------------------------------------------------------------
  // ROOF_ACCENT_BRIGHTEN
  // ------------------------------------------------------------------
  it('ROOF_ACCENT_BRIGHTEN is 0.12', () => {
    expect(ROOF_ACCENT_BRIGHTEN).toBe(0.12);
  });
});
