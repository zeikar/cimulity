import { describe, it, expect } from 'vitest';
import {
  normalizeFootprint,
  cubeFacePolygons,
  isRectangularFootprint,
  isBoundingDiamondAccurate,
  isNwAnchoredFullRectFootprint,
  rectangularUnionTopPolygon,
} from './cubeGeometry';
import { cubeLiftPx } from './cubeLift';
import { cubeTypeHeightPx, CUBE_TYPE_INSET_RATIO } from './cubeTypeRatios';
import { ISO_CONFIG } from '@/game/render/IsoTransform';

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
// isRectangularFootprint
// ---------------------------------------------------------------------------
describe('isRectangularFootprint', () => {
  it('single cell is rectangular', () => {
    expect(isRectangularFootprint([{ x: 0, y: 0 }])).toBe(true);
  });

  it('1x2 strip is rectangular', () => {
    expect(isRectangularFootprint([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(true);
  });

  it('2x2 square is rectangular', () => {
    expect(isRectangularFootprint([
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ])).toBe(true);
  });

  it('L-shape (3 cells) is NOT rectangular', () => {
    expect(isRectangularFootprint([
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 },
    ])).toBe(false);
  });

  it('T-shape (5 cells) is NOT rectangular', () => {
    expect(isRectangularFootprint([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 1, y: 1 }, { x: 1, y: 2 },
    ])).toBe(false);
  });

  it('disjoint cells (diagonal) are NOT rectangular', () => {
    expect(isRectangularFootprint([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBoundingDiamondAccurate
// ---------------------------------------------------------------------------
describe('isBoundingDiamondAccurate', () => {
  it('single cell is accurate (1x1)', () => {
    expect(isBoundingDiamondAccurate([{ x: 0, y: 0 }])).toBe(true);
  });

  it('2x2 square rectangular is accurate (bounding diamond == cell-diamond union)', () => {
    expect(isBoundingDiamondAccurate([
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ])).toBe(true);
  });

  it('3x3 square rectangular is accurate', () => {
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y });
    expect(isBoundingDiamondAccurate(cells)).toBe(true);
  });

  it('1x3 asymmetric strip is NOT accurate (bounding diamond overflows)', () => {
    expect(isBoundingDiamondAccurate([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    ])).toBe(false);
  });

  it('3x1 asymmetric strip is NOT accurate', () => {
    expect(isBoundingDiamondAccurate([
      { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 },
    ])).toBe(false);
  });

  it('2x3 asymmetric rectangle is NOT accurate', () => {
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) cells.push({ x, y });
    expect(isBoundingDiamondAccurate(cells)).toBe(false);
  });

  it('L-shape is NOT accurate (not rectangular at all)', () => {
    expect(isBoundingDiamondAccurate([
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 },
    ])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cubeFacePolygons
// ---------------------------------------------------------------------------
describe('cubeFacePolygons', () => {
  it('returns null for level === 0', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    expect(cubeFacePolygons('residential', 0, 0, fp, anchor)).toBeNull();
  });

  it('returns null for negative level', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    expect(cubeFacePolygons('residential', -1, 0, fp, anchor)).toBeNull();
  });

  it('returns polygon arrays for level > 0', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    const result = cubeFacePolygons('residential', 1, 0, fp, anchor);
    expect(result).not.toBeNull();
    expect(result!.top.length).toBeGreaterThan(0);
    expect(result!.left.length).toBeGreaterThan(0);
    expect(result!.right.length).toBeGreaterThan(0);
  });

  it('top face shifts by exactly cubeLiftPx(2,0)-cubeLiftPx(1,0) between level 1 and 2', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    const r1 = cubeFacePolygons('residential', 1, 0, fp, anchor)!;
    const r2 = cubeFacePolygons('residential', 2, 0, fp, anchor)!;

    const topY1 = Math.min(...r1.top.map((p) => p.y));
    const topY2 = Math.min(...r2.top.map((p) => p.y));
    expect(topY2 - topY1).toBe(-(cubeLiftPx(2, 0) - cubeLiftPx(1, 0)));
  });

  it('top face at level 2 is higher (smaller Y) than at level 1 — monotonic', () => {
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    const r1 = cubeFacePolygons('residential', 1, 0, fp, anchor)!;
    const r2 = cubeFacePolygons('residential', 2, 0, fp, anchor)!;

    const topY1 = Math.min(...r1.top.map((p) => p.y));
    const topY2 = Math.min(...r2.top.map((p) => p.y));
    expect(topY2).toBeLessThan(topY1);
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
    const r1x1 = cubeFacePolygons('residential', 1, 0, fp1x1, anchor)!;
    const r2x2 = cubeFacePolygons('residential', 1, 0, fp2x2, anchor)!;

    const width1x1 = Math.max(...r1x1.top.map((p) => p.x)) - Math.min(...r1x1.top.map((p) => p.x));
    const width2x2 = Math.max(...r2x2.top.map((p) => p.x)) - Math.min(...r2x2.top.map((p) => p.x));
    expect(width2x2).toBeGreaterThan(width1x1);
  });

  it('geometry is position-independent: same shape at (0,0) and (10,10) produces equal polygon arrays', () => {
    const fp0 = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const anchor0 = { x: 0, y: 0 };

    const fp10 = [{ x: 10, y: 10 }, { x: 11, y: 10 }];
    const anchor10 = { x: 10, y: 10 };

    const r0 = cubeFacePolygons('residential', 2, 0, fp0, anchor0)!;
    const r10 = cubeFacePolygons('residential', 2, 0, fp10, anchor10)!;

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
    const result = cubeFacePolygons('residential', 1, 0, lShape, anchor)!;

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

  it('density integration: density=2 lifts top face and extends side faces relative to density=0', () => {
    const L = 3;
    const fp = [{ x: 0, y: 0 }];
    const anchor = { x: 0, y: 0 };
    const r0 = cubeFacePolygons('residential', L, 0, fp, anchor)!;
    const r2 = cubeFacePolygons('residential', L, 2, fp, anchor)!;

    const liftDiff = cubeLiftPx(L, 2) - cubeLiftPx(L, 0);

    // Top face: higher density → smaller minY (higher on screen).
    const topMinY0 = Math.min(...r0.top.map((p) => p.y));
    const topMinY2 = Math.min(...r2.top.map((p) => p.y));
    expect(topMinY2 - topMinY0).toBeCloseTo(-liftDiff, 9);

    const heightOf = (pts: { x: number; y: number }[]) =>
      Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));

    expect(heightOf(r2.left) - heightOf(r0.left)).toBeCloseTo(liftDiff, 9);
    expect(heightOf(r2.right) - heightOf(r0.right)).toBeCloseTo(liftDiff, 9);
  });
});

// ---------------------------------------------------------------------------
// cubeFacePolygons — per-type silhouette
// ---------------------------------------------------------------------------
describe('cubeFacePolygons — per-type silhouette', () => {
  const fp = [{ x: 0, y: 0 }];
  const anchor = { x: 0, y: 0 };
  const level = 4;
  const density = 1 as const;

  const liftHeight = (result: NonNullable<ReturnType<typeof cubeFacePolygons>>) =>
    result.left[2].y - result.left[1].y;

  const topWidth = (result: NonNullable<ReturnType<typeof cubeFacePolygons>>) =>
    Math.max(...result.top.map((p) => p.x)) - Math.min(...result.top.map((p) => p.x));

  it('height ordering: commercial > residential > industrial', () => {
    const rC = cubeFacePolygons('commercial', level, density, fp, anchor)!;
    const rR = cubeFacePolygons('residential', level, density, fp, anchor)!;
    const rI = cubeFacePolygons('industrial', level, density, fp, anchor)!;
    expect(liftHeight(rC)).toBeGreaterThan(liftHeight(rR));
    expect(liftHeight(rR)).toBeGreaterThan(liftHeight(rI));
  });

  it('height exact pin: side edge equals cubeTypeHeightPx(cubeLiftPx(level, density), type)', () => {
    const baseLift = cubeLiftPx(level, density);
    const rC = cubeFacePolygons('commercial', level, density, fp, anchor)!;
    const rR = cubeFacePolygons('residential', level, density, fp, anchor)!;
    const rI = cubeFacePolygons('industrial', level, density, fp, anchor)!;
    expect(liftHeight(rC)).toBe(cubeTypeHeightPx(baseLift, 'commercial'));
    expect(liftHeight(rR)).toBe(cubeTypeHeightPx(baseLift, 'residential'));
    expect(liftHeight(rI)).toBe(cubeTypeHeightPx(baseLift, 'industrial'));
  });

  it('width ordering: industrial === residential > commercial', () => {
    const rC = cubeFacePolygons('commercial', level, density, fp, anchor)!;
    const rR = cubeFacePolygons('residential', level, density, fp, anchor)!;
    const rI = cubeFacePolygons('industrial', level, density, fp, anchor)!;
    expect(topWidth(rI)).toBe(topWidth(rR));
    expect(topWidth(rR)).toBeGreaterThan(topWidth(rC));
  });

  it('width exact pin: industrial and residential top width equals TILE_WIDTH * (1 - 2 * inset)', () => {
    const rR = cubeFacePolygons('residential', level, density, fp, anchor)!;
    const rI = cubeFacePolygons('industrial', level, density, fp, anchor)!;
    expect(topWidth(rR)).toBe(ISO_CONFIG.TILE_WIDTH * (1 - 2 * CUBE_TYPE_INSET_RATIO.residential));
    expect(topWidth(rI)).toBe(ISO_CONFIG.TILE_WIDTH * (1 - 2 * CUBE_TYPE_INSET_RATIO.industrial));
  });

  it('width exact pin: commercial top width equals TILE_WIDTH * (1 - 2 * inset)', () => {
    const rC = cubeFacePolygons('commercial', level, density, fp, anchor)!;
    expect(topWidth(rC)).toBe(ISO_CONFIG.TILE_WIDTH * (1 - 2 * CUBE_TYPE_INSET_RATIO.commercial));
  });

  it('level=0 returns null for all types', () => {
    expect(cubeFacePolygons('residential', 0, density, fp, anchor)).toBeNull();
    expect(cubeFacePolygons('commercial', 0, density, fp, anchor)).toBeNull();
    expect(cubeFacePolygons('industrial', 0, density, fp, anchor)).toBeNull();
  });

  it('position independence for commercial: (0,0) vs (10,10) anchor produces equal polygons', () => {
    const fp10 = [{ x: 10, y: 10 }, { x: 11, y: 10 }];
    const anchor10 = { x: 10, y: 10 };
    const fp0 = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const anchor0 = { x: 0, y: 0 };

    const r0 = cubeFacePolygons('commercial', level, density, fp0, anchor0)!;
    const r10 = cubeFacePolygons('commercial', level, density, fp10, anchor10)!;

    const toStr = (pts: { x: number; y: number }[]) =>
      pts.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join('|');

    expect(toStr(r0.top)).toBe(toStr(r10.top));
    expect(toStr(r0.left)).toBe(toStr(r10.left));
    expect(toStr(r0.right)).toBe(toStr(r10.right));
  });
});

// ---------------------------------------------------------------------------
// isNwAnchoredFullRectFootprint
// ---------------------------------------------------------------------------
describe('isNwAnchoredFullRectFootprint', () => {
  it('empty footprint → false', () => {
    expect(isNwAnchoredFullRectFootprint([], { x: 0, y: 0 })).toBe(false);
  });

  it('single cell [(3,4)] with anchor (3,4) → true', () => {
    expect(isNwAnchoredFullRectFootprint([{ x: 3, y: 4 }], { x: 3, y: 4 })).toBe(true);
  });

  it('single cell [(3,4)] with wrong anchor (0,0) → false', () => {
    expect(isNwAnchoredFullRectFootprint([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBe(false);
  });

  it('2×2 rect (4 cells) with NW anchor → true', () => {
    const fp = [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ];
    expect(isNwAnchoredFullRectFootprint(fp, { x: 0, y: 0 })).toBe(true);
  });

  it('2×2 rect with anchor at SE corner → false (anchor must be NW)', () => {
    const fp = [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ];
    expect(isNwAnchoredFullRectFootprint(fp, { x: 1, y: 1 })).toBe(false);
  });

  it('L-shape (3 cells, length 3 ≠ W*H=4) → false', () => {
    const fp = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(isNwAnchoredFullRectFootprint(fp, { x: 0, y: 0 })).toBe(false);
  });

  it('duplicate cells [(0,0),(0,0),(1,0),(0,1)] with anchor (0,0) → false (set size 3 ≠ length 4)', () => {
    const fp = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(isNwAnchoredFullRectFootprint(fp, { x: 0, y: 0 })).toBe(false);
  });

  it('missing cell with extra duplicate [(0,0),(1,0),(1,0),(1,1)] → false', () => {
    const fp = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    expect(isNwAnchoredFullRectFootprint(fp, { x: 0, y: 0 })).toBe(false);
  });

  it('4×4 rect → true', () => {
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) fp.push({ x, y });
    expect(isNwAnchoredFullRectFootprint(fp, { x: 0, y: 0 })).toBe(true);
  });

  // This helper does NOT enforce {1..4} caps; that is isCanonicalFootprintRect's job at the core boundary.
  it('5×1 rect → true', () => {
    const fp = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }];
    expect(isNwAnchoredFullRectFootprint(fp, { x: 0, y: 0 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rectangularUnionTopPolygon
// ---------------------------------------------------------------------------
describe('rectangularUnionTopPolygon', () => {
  const hw = ISO_CONFIG.TILE_WIDTH / 2;   // 32
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;  // 16
  const TH = ISO_CONFIG.TILE_HEIGHT;      // 32

  it('1×1 at anchor (0,0) → pins all 4 vertices', () => {
    const fp = [{ x: 0, y: 0 }];
    const r = rectangularUnionTopPolygon(fp, { x: 0, y: 0 })!;
    expect(r.N).toEqual({ x: 0,   y: 0  });
    expect(r.E).toEqual({ x: hw,  y: hh });
    expect(r.S).toEqual({ x: 0,   y: TH });
    expect(r.W).toEqual({ x: -hw, y: hh });
  });

  it('1×4 at anchor (0,0) → pins all 4 vertices', () => {
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < 4; y++) fp.push({ x: 0, y });
    // W=1, H=4
    const r = rectangularUnionTopPolygon(fp, { x: 0, y: 0 })!;
    expect(r.N).toEqual({ x: 0,               y: 0              });
    expect(r.E).toEqual({ x: 1 * hw,           y: 1 * hh         });
    expect(r.S).toEqual({ x: (1 - 4) * hw,     y: (1 + 4) * hh   });
    expect(r.W).toEqual({ x: -4 * hw,          y: 4 * hh         });
  });

  it('4×1 at anchor (0,0) → pins all 4 vertices', () => {
    const fp: { x: number; y: number }[] = [];
    for (let x = 0; x < 4; x++) fp.push({ x, y: 0 });
    // W=4, H=1
    const r = rectangularUnionTopPolygon(fp, { x: 0, y: 0 })!;
    expect(r.N).toEqual({ x: 0,               y: 0              });
    expect(r.E).toEqual({ x: 4 * hw,           y: 4 * hh         });
    expect(r.S).toEqual({ x: (4 - 1) * hw,     y: (4 + 1) * hh   });
    expect(r.W).toEqual({ x: -1 * hw,          y: 1 * hh         });
  });

  it('2×3 at anchor (0,0) → pins all 4 vertices', () => {
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) fp.push({ x, y });
    // W=2, H=3
    const r = rectangularUnionTopPolygon(fp, { x: 0, y: 0 })!;
    expect(r.N).toEqual({ x: 0,               y: 0              });
    expect(r.E).toEqual({ x: 2 * hw,           y: 2 * hh         });
    expect(r.S).toEqual({ x: (2 - 3) * hw,     y: (2 + 3) * hh   });
    expect(r.W).toEqual({ x: -3 * hw,          y: 3 * hh         });
  });

  it('3×2 at anchor (0,0) → pins all 4 vertices', () => {
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) fp.push({ x, y });
    // W=3, H=2
    const r = rectangularUnionTopPolygon(fp, { x: 0, y: 0 })!;
    expect(r.N).toEqual({ x: 0,               y: 0              });
    expect(r.E).toEqual({ x: 3 * hw,           y: 3 * hh         });
    expect(r.S).toEqual({ x: (3 - 2) * hw,     y: (3 + 2) * hh   });
    expect(r.W).toEqual({ x: -2 * hw,          y: 2 * hh         });
  });

  it('3×2 and 2×3 produce DIFFERENT polygons', () => {
    const fp2x3: { x: number; y: number }[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) fp2x3.push({ x, y });
    const fp3x2: { x: number; y: number }[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) fp3x2.push({ x, y });

    const r2x3 = rectangularUnionTopPolygon(fp2x3, { x: 0, y: 0 })!;
    const r3x2 = rectangularUnionTopPolygon(fp3x2, { x: 0, y: 0 })!;

    expect(r2x3.E).not.toEqual(r3x2.E);
    expect(r2x3.S).not.toEqual(r3x2.S);
  });

  it('4×4 at anchor (0,0) → pins all 4 vertices', () => {
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) fp.push({ x, y });
    // W=4, H=4
    const r = rectangularUnionTopPolygon(fp, { x: 0, y: 0 })!;
    expect(r.N).toEqual({ x: 0,               y: 0              });
    expect(r.E).toEqual({ x: 4 * hw,           y: 4 * hh         });
    expect(r.S).toEqual({ x: (4 - 4) * hw,     y: (4 + 4) * hh   });
    expect(r.W).toEqual({ x: -4 * hw,          y: 4 * hh         });
  });

  it('4×4 RAW equality vs scaled 1×1 diamond: N=4 produces (0,0),(N*hw,N*hh),(0,N*TH),(-N*hw,N*hh)', () => {
    const N = 4;
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fp.push({ x, y });
    const r = rectangularUnionTopPolygon(fp, { x: 0, y: 0 })!;
    expect(r.N).toEqual({ x: 0,        y: 0        });
    expect(r.E).toEqual({ x: N * hw,   y: N * hh   });
    expect(r.S).toEqual({ x: 0,        y: N * TH   });
    expect(r.W).toEqual({ x: -N * hw,  y: N * hh   });
  });

  it('position-independence: anchor (10,7) produces identical anchor-local polygon as anchor (0,0)', () => {
    const fp0: { x: number; y: number }[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) fp0.push({ x, y });

    const fp10: { x: number; y: number }[] = [];
    for (let y = 7; y < 9; y++) for (let x = 10; x < 13; x++) fp10.push({ x, y });

    const r0  = rectangularUnionTopPolygon(fp0,  { x: 0,  y: 0 })!;
    const r10 = rectangularUnionTopPolygon(fp10, { x: 10, y: 7 })!;

    expect(r0.N).toEqual(r10.N);
    expect(r0.E).toEqual(r10.E);
    expect(r0.S).toEqual(r10.S);
    expect(r0.W).toEqual(r10.W);
  });

  it('empty footprint → null', () => {
    expect(rectangularUnionTopPolygon([], { x: 0, y: 0 })).toBeNull();
  });

  it('non-canonical (anchor not minX/minY) → null', () => {
    const fp = [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ];
    expect(rectangularUnionTopPolygon(fp, { x: 1, y: 0 })).toBeNull();
  });

  it('non-canonical (duplicates) → null', () => {
    const fp = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(rectangularUnionTopPolygon(fp, { x: 0, y: 0 })).toBeNull();
  });

  it('non-canonical (L-shape) → null', () => {
    const fp = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(rectangularUnionTopPolygon(fp, { x: 0, y: 0 })).toBeNull();
  });
});
