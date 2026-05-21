import { describe, it, expect } from 'vitest';
import { buildWaterMask } from './waterMask';
import { fbm2d } from './valueNoise';
import { createRng } from './prng';

describe('buildWaterMask', () => {
  it('(a) determinism — same input yields same output', () => {
    const noise = fbm2d(16, 16, createRng(1));
    expect(buildWaterMask(noise)).toEqual(buildWaterMask(noise));
  });

  it('(b) shape — mask dimensions match input grid', () => {
    const noise = fbm2d(10, 8, createRng(2));
    const mask = buildWaterMask(noise);
    expect(mask.length).toBe(8);
    expect(mask[0].length).toBe(10);
  });

  it('(c) exact count — 32x32 grid, waterFraction=0.25 → exactly 256 true cells', () => {
    const noise = fbm2d(32, 32, createRng(3));
    const mask = buildWaterMask(noise, { waterFraction: 0.25 });
    const count = mask.flat().filter(Boolean).length;
    expect(count).toBe(256);
  });

  it('(d) edge bias — constant 0.5 noise: outer ring has more water than interior 8x8', () => {
    const noise = Array.from({ length: 16 }, () => new Array<number>(16).fill(0.5));
    const mask = buildWaterMask(noise, { waterFraction: 0.3 });
    let outer = 0;
    let inner = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (mask[y][x]) {
          if (y >= 4 && y < 12 && x >= 4 && x < 12) inner++;
          else outer++;
        }
      }
    }
    expect(outer).toBeGreaterThan(inner);
  });

  it('(e) endpoint waterFraction=0 → 0 water cells', () => {
    const noise = fbm2d(8, 8, createRng(4));
    const mask = buildWaterMask(noise, { waterFraction: 0 });
    expect(mask.flat().filter(Boolean).length).toBe(0);
  });

  it('(f) endpoint waterFraction=1 → W*H - 1 water cells', () => {
    const noise = fbm2d(8, 8, createRng(5));
    const mask = buildWaterMask(noise, { waterFraction: 1 });
    expect(mask.flat().filter(Boolean).length).toBe(63);
  });

  it('(g) tie-break determinism — constant noise grid pinned snapshot', () => {
    const noise = Array.from({ length: 4 }, () => new Array<number>(4).fill(0.5));
    const mask = buildWaterMask(noise, { waterFraction: 0.25 });
    expect(mask).toEqual([
      [true, true, true, true],
      [false, false, false, false],
      [false, false, false, false],
      [false, false, false, false],
    ]);
  });
});
