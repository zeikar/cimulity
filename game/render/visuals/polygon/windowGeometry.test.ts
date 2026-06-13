import { describe, it, expect } from 'vitest';
import type { Point } from './cubeGeometry';
import {
  PUNCHED_INSET,
  CURTAIN_INSET,
  FRAME_INSET,
  insetQuad,
  windowFrameQuad,
  windowGlassQuad,
} from './windowGeometry';

// Unit square cell — axis-aligned, easy to reason about.
const UNIT_CELL: [Point, Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// A skewed (non-axis-aligned) quad.
const SKEWED_CELL: [Point, Point, Point, Point] = [
  { x: 10, y: 20 },
  { x: 40, y: 15 },
  { x: 45, y: 50 },
  { x: 12, y: 55 },
];

/** Shoelace formula — signed area of a polygon (positive = CCW). */
function shoelaceArea(pts: Point[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/** Centroid (mean of corners). */
function centroid(pts: ReadonlyArray<Point>): Point {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/** Euclidean distance between two points. */
function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Axis-aligned bounding box of a set of points. */
function bbox(pts: Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

describe('insetQuad', () => {
  it('t=0 is identity (output deep-equals input)', () => {
    const out = insetQuad(UNIT_CELL, 0);
    expect(out).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(out[i].x).toBeCloseTo(UNIT_CELL[i].x, 10);
      expect(out[i].y).toBeCloseTo(UNIT_CELL[i].y, 10);
    }
  });

  it('t>0 moves every corner strictly closer to the centroid', () => {
    const c = centroid(UNIT_CELL);
    const out = insetQuad(UNIT_CELL, 0.2);
    for (let i = 0; i < 4; i++) {
      expect(dist(out[i], c)).toBeLessThan(dist(UNIT_CELL[i], c));
    }
  });

  it('output centroid equals input centroid (shape contracts, not translates)', () => {
    const cin = centroid(UNIT_CELL);
    const cout = centroid(insetQuad(UNIT_CELL, 0.3));
    expect(cout.x).toBeCloseTo(cin.x, 10);
    expect(cout.y).toBeCloseTo(cin.y, 10);
  });

  it('works on a skewed (non-axis-aligned) cell', () => {
    const c = centroid(SKEWED_CELL);
    const out = insetQuad(SKEWED_CELL, 0.15);
    for (let i = 0; i < 4; i++) {
      expect(dist(out[i], c)).toBeLessThan(dist(SKEWED_CELL[i], c));
    }
    // Centroid preserved.
    const cout = centroid(out);
    expect(cout.x).toBeCloseTo(c.x, 10);
    expect(cout.y).toBeCloseTo(c.y, 10);
  });
});

describe('windowFrameQuad / windowGlassQuad', () => {
  it('curtain glass area > punched glass area for the same unit cell', () => {
    const curtainGlass = windowGlassQuad(UNIT_CELL, 'curtain');
    const punchedGlass = windowGlassQuad(UNIT_CELL, 'punched');
    expect(shoelaceArea(curtainGlass)).toBeGreaterThan(shoelaceArea(punchedGlass));
  });

  it('glass is strictly inside frame bbox, frame is strictly inside cell bbox', () => {
    for (const mode of ['punched', 'curtain'] as const) {
      const frame = windowFrameQuad(UNIT_CELL, mode);
      const glass = windowGlassQuad(UNIT_CELL, mode);

      const cellBox = bbox(Array.from(UNIT_CELL));
      const frameBox = bbox(frame);
      const glassBox = bbox(glass);

      const eps = 1e-9;

      // Frame strictly inside cell.
      expect(frameBox.minX).toBeGreaterThan(cellBox.minX + eps);
      expect(frameBox.maxX).toBeLessThan(cellBox.maxX - eps);
      expect(frameBox.minY).toBeGreaterThan(cellBox.minY + eps);
      expect(frameBox.maxY).toBeLessThan(cellBox.maxY - eps);

      // Glass strictly inside frame.
      expect(glassBox.minX).toBeGreaterThan(frameBox.minX + eps);
      expect(glassBox.maxX).toBeLessThan(frameBox.maxX - eps);
      expect(glassBox.minY).toBeGreaterThan(frameBox.minY + eps);
      expect(glassBox.maxY).toBeLessThan(frameBox.maxY - eps);
    }
  });

  it('constants are ordered correctly: CURTAIN_INSET < PUNCHED_INSET and FRAME_INSET > 0', () => {
    // Sanity-check the tuning values don't drift past each other.
    expect(CURTAIN_INSET).toBeLessThan(PUNCHED_INSET);
    expect(FRAME_INSET).toBeGreaterThan(0);
    // All insets must keep area positive (< 0.5 so quad doesn't collapse).
    expect(PUNCHED_INSET).toBeLessThan(0.5);
    expect(CURTAIN_INSET + FRAME_INSET).toBeLessThan(0.5);
  });
});
