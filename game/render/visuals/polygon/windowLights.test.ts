import { describe, it, expect } from 'vitest';
import {
  WINDOWS_X,
  WINDOWS_Y,
  windowSeed,
  windowCellLit,
  windowCellQuads,
} from './windowLights';
import { WALL_TILE_PX } from './faceTexture';
import type { Point } from './cubeGeometry';

// Helper: build a flat rectangular face in screen space.
// topLeft at (0,0), top edge goes right by `width`, left edge goes down by `height`.
function makeRectFace(width: number, height: number): [Point, Point, Point, Point] {
  // Order: [topStart, topEnd, bottomEnd, bottomStart]
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

describe('windowSeed', () => {
  it('is deterministic for the same buildingId', () => {
    expect(windowSeed(42)).toBe(windowSeed(42));
    expect(windowSeed(0)).toBe(windowSeed(0));
    expect(windowSeed(9999)).toBe(windowSeed(9999));
  });

  it('always returns a value in [0, 64)', () => {
    for (let id = 0; id < 1000; id++) {
      const s = windowSeed(id);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(64);
      expect(Number.isInteger(s)).toBe(true);
    }
  });

  it('produces different values for different buildingIds across a sweep', () => {
    const seeds = new Set<number>();
    for (let id = 0; id < 200; id++) seeds.add(windowSeed(id));
    // With 200 ids and range [0,64) expect a decent spread — at least 30 distinct values.
    expect(seeds.size).toBeGreaterThan(30);
  });
});

describe('windowCellLit', () => {
  it('is deterministic for the same seed/col/row', () => {
    expect(windowCellLit(7, 0, 0)).toBe(windowCellLit(7, 0, 0));
    expect(windowCellLit(0, 2, 3)).toBe(windowCellLit(0, 2, 3));
  });

  it('varies across (col, row) for a fixed seed', () => {
    const seed = 13;
    const results = new Set<boolean>();
    for (let col = 0; col < WINDOWS_X; col++) {
      for (let row = 0; row < WINDOWS_Y; row++) {
        results.add(windowCellLit(seed, col, row));
      }
    }
    // Must have both true and false among the 12 cells.
    expect(results.size).toBeGreaterThan(1);
  });

  it('lit fraction is roughly 0.4–0.8 over a sweep', () => {
    let lit = 0;
    let total = 0;
    for (let seed = 0; seed < 64; seed++) {
      for (let col = 0; col < WINDOWS_X; col++) {
        for (let row = 0; row < WINDOWS_Y; row++) {
          if (windowCellLit(seed, col, row)) lit++;
          total++;
        }
      }
    }
    const fraction = lit / total;
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.8);
  });
});

describe('windowCellQuads', () => {
  it('FRACTIONAL: partial face (repeatX=0.5) — first column u-extent maps correctly', () => {
    // 48px wide face → repeatX = 48/96 = 0.5
    const faceWidth = WALL_TILE_PX * 0.5; // 48
    const faceHeight = WALL_TILE_PX;
    const face = makeRectFace(faceWidth, faceHeight);
    const repeatX = faceWidth / WALL_TILE_PX; // 0.5
    const repeatY = faceHeight / WALL_TILE_PX; // 1.0

    const quads = windowCellQuads(face, repeatX, repeatY);

    // First column: texU0=0, texU1=1/WINDOWS_X; u1 = (1/WINDOWS_X)/repeatX
    const expectedU1 = (1 / WINDOWS_X) / repeatX;
    const firstColQuads = quads.filter((q) => q.col === 0);
    expect(firstColQuads.length).toBeGreaterThan(0);

    // The right edge of the first column should be at x = expectedU1 * faceWidth
    const expectedX1 = expectedU1 * faceWidth;
    for (const q of firstColQuads) {
      // points[1] = top-right, points[2] = bottom-right
      expect(q.points[1].x).toBeCloseTo(expectedX1, 5);
      expect(q.points[2].x).toBeCloseTo(expectedX1, 5);
    }
  });

  it('FRACTIONAL: trailing (last) column is clipped so x ≤ faceWidth', () => {
    const faceWidth = WALL_TILE_PX * 0.5;
    const faceHeight = WALL_TILE_PX;
    const face = makeRectFace(faceWidth, faceHeight);
    const repeatX = faceWidth / WALL_TILE_PX;
    const repeatY = faceHeight / WALL_TILE_PX;

    const quads = windowCellQuads(face, repeatX, repeatY);
    for (const q of quads) {
      for (const p of q.points) {
        expect(p.x).toBeLessThanOrEqual(faceWidth + 1e-9);
        expect(p.y).toBeLessThanOrEqual(faceHeight + 1e-9);
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('2-tile-wide face (repeatX≈2) yields 2*WINDOWS_X columns', () => {
    const faceWidth = WALL_TILE_PX * 2;
    const faceHeight = WALL_TILE_PX;
    const face = makeRectFace(faceWidth, faceHeight);
    const repeatX = faceWidth / WALL_TILE_PX; // 2.0
    const repeatY = faceHeight / WALL_TILE_PX; // 1.0

    const quads = windowCellQuads(face, repeatX, repeatY);
    const cols = new Set(quads.map((q) => q.col));
    expect(cols.size).toBe(2 * WINDOWS_X);
  });

  it('every quad point stays within the bounding box of the face', () => {
    // Test with a skewed (isometric-ish) face to ensure bilerp stays inside.
    const face: [Point, Point, Point, Point] = [
      { x: 0, y: 20 },
      { x: 100, y: 10 },
      { x: 120, y: 60 },
      { x: 20, y: 70 },
    ];
    const repeatX = 1.5;
    const repeatY = 0.8;
    const quads = windowCellQuads(face, repeatX, repeatY);

    const allX = face.map((p) => p.x);
    const allY = face.map((p) => p.y);
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);

    for (const q of quads) {
      for (const p of q.points) {
        expect(p.x).toBeGreaterThanOrEqual(minX - 1e-6);
        expect(p.x).toBeLessThanOrEqual(maxX + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(minY - 1e-6);
        expect(p.y).toBeLessThanOrEqual(maxY + 1e-6);
      }
    }
  });
});
