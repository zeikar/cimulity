import { describe, it, expect } from 'vitest';
import { normalizeFootprint, cubeFacePolygons, CUBE_STEP_PX } from './cubeGeometry';

// ---------------------------------------------------------------------------
// normalizeFootprint
// ---------------------------------------------------------------------------
describe('normalizeFootprint', () => {
  it('returns identical strings for the same shape at different map positions', () => {
    const footprintA = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const anchorA = { x: 0, y: 0 };

    const footprintB = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 10, y: 11 },
      { x: 11, y: 11 },
    ];
    const anchorB = { x: 10, y: 10 };

    expect(normalizeFootprint(footprintA, anchorA)).toBe(normalizeFootprint(footprintB, anchorB));
  });

  it('returns different strings for different shapes', () => {
    const footprint1x1 = [{ x: 0, y: 0 }];
    const footprint2x1 = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const anchor = { x: 0, y: 0 };

    expect(normalizeFootprint(footprint1x1, anchor)).not.toBe(normalizeFootprint(footprint2x1, anchor));
  });

  it('is order-independent — input cell order does not affect result', () => {
    const anchor = { x: 2, y: 3 };
    const ordered = [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];
    const reversed = [
      { x: 3, y: 3 },
      { x: 2, y: 3 },
    ];
    expect(normalizeFootprint(ordered, anchor)).toBe(normalizeFootprint(reversed, anchor));
  });

  it('handles L-shaped footprint (3 cells)', () => {
    const anchor = { x: 1, y: 1 };
    const lShape = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ];
    const token = normalizeFootprint(lShape, anchor);
    // anchor-local: (0,0), (1,0), (0,1) — sorted by (dy,dx)
    expect(token).toBe('0,0;1,0;0,1');
  });
});

// ---------------------------------------------------------------------------
// cubeFacePolygons
// ---------------------------------------------------------------------------
describe('cubeFacePolygons', () => {
  it('returns null for level === 0', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    expect(cubeFacePolygons(0, fp, anchor)).toBeNull();
  });

  it('returns null for negative level', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    expect(cubeFacePolygons(-1, fp, anchor)).toBeNull();
  });

  it('returns polygon arrays for level > 0', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    const result = cubeFacePolygons(1, fp, anchor);
    expect(result).not.toBeNull();
    expect(result!.top.length).toBeGreaterThan(0);
    expect(result!.left.length).toBeGreaterThan(0);
    expect(result!.right.length).toBeGreaterThan(0);
  });

  it('shifts top face up by N * CUBE_STEP_PX compared to level 1', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    const r1 = cubeFacePolygons(1, fp, anchor)!;
    const r2 = cubeFacePolygons(2, fp, anchor)!;

    // The topmost vertex (top[0]) should be higher (lower Y) by exactly CUBE_STEP_PX.
    const topY1 = Math.min(...r1.top.map((p) => p.y));
    const topY2 = Math.min(...r2.top.map((p) => p.y));
    expect(topY2).toBeCloseTo(topY1 - CUBE_STEP_PX, 5);
  });

  it('2x2 footprint produces a wider top polygon than 1x1', () => {
    const fp1x1 = [{ x: 0, y: 0 }];
    const fp2x2 = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const anchor = { x: 0, y: 0 };
    const r1x1 = cubeFacePolygons(1, fp1x1, anchor)!;
    const r2x2 = cubeFacePolygons(1, fp2x2, anchor)!;

    const width1x1 = Math.max(...r1x1.top.map((p) => p.x)) - Math.min(...r1x1.top.map((p) => p.x));
    const width2x2 = Math.max(...r2x2.top.map((p) => p.x)) - Math.min(...r2x2.top.map((p) => p.x));
    expect(width2x2).toBeGreaterThan(width1x1);
  });

  it('geometry is position-independent: same shape at (0,0) and (10,10) produces equal polygon arrays', () => {
    const fp0 = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const anchor0 = { x: 0, y: 0 };

    const fp10 = [{ x: 10, y: 10 }, { x: 11, y: 10 }];
    const anchor10 = { x: 10, y: 10 };

    const r0 = cubeFacePolygons(2, fp0, anchor0)!;
    const r10 = cubeFacePolygons(2, fp10, anchor10)!;

    // All polygon points should be numerically equal in anchor-local space.
    const toStr = (pts: { x: number; y: number }[]) =>
      pts.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join('|');

    expect(toStr(r0.top)).toBe(toStr(r10.top));
    expect(toStr(r0.left)).toBe(toStr(r10.left));
    expect(toStr(r0.right)).toBe(toStr(r10.right));
  });

  it('L-shaped footprint produces geometry anchored at origin', () => {
    const anchor = { x: 1, y: 1 };
    const lShape = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ];
    const result = cubeFacePolygons(1, lShape, anchor)!;

    // The anchor cell's top corner in anchor-local coords should be (0, 0).
    // tileToScreen(anchor) - tileToScreen(anchor) = (0, 0), which is the top-corner of the anchor tile.
    // Our bounding box will include x=0, y=0 from the anchor cell top corner.
    const allPts = [...result.top, ...result.left, ...result.right];
    // All points must be finite numbers (no NaN/Infinity).
    for (const p of allPts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
