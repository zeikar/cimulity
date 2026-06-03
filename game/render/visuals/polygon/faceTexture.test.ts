import { describe, it, expect } from 'vitest';
import { wallVariant, WALL_VARIANTS } from './faceTexture';

describe('wallVariant', () => {
  it('is deterministic for a given buildingId', () => {
    expect(wallVariant(5)).toBe(wallVariant(5));
    expect(wallVariant(1234)).toBe(wallVariant(1234));
    expect(wallVariant(0)).toBe(wallVariant(0));
  });

  it('always returns an integer index within [0, WALL_VARIANTS)', () => {
    for (let id = 0; id < 500; id++) {
      const v = wallVariant(id);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(WALL_VARIANTS);
    }
  });

  it('uses every variant across sequential ids (mixes facades, not constant)', () => {
    const seen = new Set<number>();
    for (let id = 0; id < 100; id++) {
      seen.add(wallVariant(id));
    }
    expect(seen.size).toBe(WALL_VARIANTS);
  });
});
