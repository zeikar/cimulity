import { describe, it, expect } from 'vitest';
import { shapeHeightmap } from './heightShaping';
import { fbm2d } from './valueNoise';
import { createRng } from './prng';
import { MAX_ELEVATION } from './Terrain';

const DEFAULT_NEWCITY_SEED = 0xC15A1E11;

describe('shapeHeightmap', () => {
  it('(a) determinism — same input yields same output', () => {
    const noise = fbm2d(8, 8, createRng(1));
    expect(shapeHeightmap(noise, 8)).toEqual(shapeHeightmap(noise, 8));
  });

  it('(b) integer range — all outputs in [0, maxElevation]', () => {
    const noise = fbm2d(16, 16, createRng(2));
    const result = shapeHeightmap(noise, MAX_ELEVATION);
    for (const row of result) {
      for (const v of row) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(MAX_ELEVATION);
      }
    }
  });

  it('(c) distribution — driven with fbm2d(64,64,createRng(DEFAULT_NEWCITY_SEED))', () => {
    const noise = fbm2d(64, 64, createRng(DEFAULT_NEWCITY_SEED));
    const result = shapeHeightmap(noise, MAX_ELEVATION);
    const flat = result.flat();
    const total = flat.length;
    const le2 = flat.filter(v => v <= 2).length / total;
    const ge5 = flat.filter(v => v >= 5).length / total;
    const atMax = flat.filter(v => v === MAX_ELEVATION).length / total;
    expect(le2).toBeGreaterThanOrEqual(0.60);
    expect(ge5).toBeLessThanOrEqual(0.15);
    expect(atMax).toBeLessThanOrEqual(0.02);
  });

  it('(d) lower-median collapses spikes', () => {
    const input = [[0, 0, 0], [0, 1, 0], [0, 0, 0]];
    const result = shapeHeightmap(input, 8, { gamma: 1 });
    expect(result[1][1]).toBe(0);
  });

  it('(e) edge-cell window pinned exact array', () => {
    const input = [[1, 0, 1]];
    const result = shapeHeightmap(input, 8, { gamma: 1 });
    expect(result).toEqual([[0, 8, 0]]);
  });
});
