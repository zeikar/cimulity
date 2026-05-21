import { describe, it, expect } from 'vitest';
import { fbm2d } from './valueNoise';
import { createRng } from './prng';

describe('fbm2d', () => {
  it('(a) determinism — fbm2d(8,8,createRng(1)) twice deep-equal', () => {
    expect(fbm2d(8, 8, createRng(1))).toEqual(fbm2d(8, 8, createRng(1)));
  });

  it('(b) range — 16x16 grid every cell >= 0 && <= 1', () => {
    const grid = fbm2d(16, 16, createRng(7));
    for (const row of grid) {
      for (const v of row) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('(c) non-trivial — 32x32 grid variance > 0.01', () => {
    const grid = fbm2d(32, 32, createRng(99));
    const vals = grid.flat();
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    expect(variance).toBeGreaterThan(0.01);
  });

  it('(d) smoothness — 16x16 grid mean |v[y][x] - v[y][x+1]| < 0.15', () => {
    const grid = fbm2d(16, 16, createRng(5));
    let sum = 0;
    let count = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 15; x++) {
        sum += Math.abs(grid[y][x] - grid[y][x + 1]);
        count++;
      }
    }
    expect(sum / count).toBeLessThan(0.15);
  });

  it('(e) pinned snapshot — fbm2d(4,4,createRng(1))', () => {
    expect(fbm2d(4, 4, createRng(1))).toEqual([
      [0.7684726684199025, 0.5227268197961773, 0.319380715675652, 0.3250248578299458],
      [0.6101256615404661, 0.6184838888264494, 0.42415053977165373, 0.329537114482567],
      [0.6462267908888558, 0.574755290701675, 0.46388324634172023, 0.4200913376407698],
      [0.6749800222693011, 0.679608099842638, 0.6013817422635233, 0.6199920858440843],
    ]);
  });
});
