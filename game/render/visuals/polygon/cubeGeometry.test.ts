import { describe, it, expect } from 'vitest';
import {
  normalizeFootprint,
  cubeFacePolygons,
  isNwAnchoredFullRectFootprint,
  rectangularUnionTopPolygon,
  roofCapPolygons,
  setbackTopPolygon,
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
// cubeFacePolygons — multi-cell rectangular footprints (union polygon path)
// ---------------------------------------------------------------------------
describe('cubeFacePolygons — multi-cell rectangular footprints', () => {
  // Helper: build expected top polygon from rectangularUnionTopPolygon + inset + lift.
  function expectedTop(
    footprint: ReadonlyArray<{ x: number; y: number }>,
    anchor: { x: number; y: number },
    inset: number,
    lift: number,
  ) {
    const raw = rectangularUnionTopPolygon(footprint, anchor)!;
    const cx = (raw.N.x + raw.E.x + raw.S.x + raw.W.x) / 4;
    const cy = (raw.N.y + raw.E.y + raw.S.y + raw.W.y) / 4;
    const scale = 1 - 2 * inset;
    const ai = (v: { x: number; y: number }) => ({
      x: cx + (v.x - cx) * scale,
      y: cy + (v.y - cy) * scale,
    });
    const N = ai(raw.N);
    const E = ai(raw.E);
    const S = ai(raw.S);
    const W = ai(raw.W);
    return [
      { x: N.x, y: N.y - lift },
      { x: E.x, y: E.y - lift },
      { x: S.x, y: S.y - lift },
      { x: W.x, y: W.y - lift },
    ];
  }

  const toStr = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).join('|');

  const SHAPES: Array<{ label: string; W: number; H: number }> = [
    { label: '1×4', W: 1, H: 4 },
    { label: '4×1', W: 4, H: 1 },
    { label: '2×3', W: 2, H: 3 },
    { label: '3×2', W: 3, H: 2 },
    { label: '4×2', W: 4, H: 2 },
    { label: '4×4', W: 4, H: 4 },
  ];

  const level = 3;
  const density = 1 as const;
  const type = 'residential' as const;

  for (const { label, W, H } of SHAPES) {
    it(`${label} residential level=3 density=1: returns non-null and top equals union+inset+lift`, () => {
      const fp: { x: number; y: number }[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fp.push({ x, y });
      const anchor = { x: 0, y: 0 };

      const result = cubeFacePolygons(type, level, density, fp, anchor);
      expect(result).not.toBeNull();

      const baseLift = cubeLiftPx(level, density);
      const lift = cubeTypeHeightPx(baseLift, type);
      const inset = CUBE_TYPE_INSET_RATIO[type];
      const expTop = expectedTop(fp, anchor, inset, lift);

      expect(toStr(result!.top)).toBe(toStr(expTop));
    });
  }

  it('4×2 commercial level=5 density=2: pins all four top-face vertices numerically', () => {
    const W = 4, H = 2;
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fp.push({ x, y });
    const anchor = { x: 0, y: 0 };

    const baseLift = cubeLiftPx(5, 2);
    const lift = cubeTypeHeightPx(baseLift, 'commercial');
    const inset = CUBE_TYPE_INSET_RATIO['commercial'];
    const expTop = expectedTop(fp, anchor, inset, lift);

    const result = cubeFacePolygons('commercial', 5, 2, fp, anchor)!;
    expect(result).not.toBeNull();
    expect(toStr(result.top)).toBe(toStr(expTop));
  });

  it('4×2 and 2×4 produce DIFFERENT top polygons', () => {
    const fp4x2: { x: number; y: number }[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) fp4x2.push({ x, y });
    const fp2x4: { x: number; y: number }[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) fp2x4.push({ x, y });
    const anchor = { x: 0, y: 0 };

    const r4x2 = cubeFacePolygons('residential', 3, 1, fp4x2, anchor)!;
    const r2x4 = cubeFacePolygons('residential', 3, 1, fp2x4, anchor)!;

    expect(toStr(r4x2.top)).not.toBe(toStr(r2x4.top));
  });

  it('side faces share the top[2] (S) vertex — regression for iso-cube convention', () => {
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) fp.push({ x, y });
    const anchor = { x: 0, y: 0 };

    const result = cubeFacePolygons('residential', 3, 1, fp, anchor)!;
    const topS = result.top[2];
    // left[0] and right[1] must equal top[2].
    expect(result.left[0]).toEqual(topS);
    expect(result.right[1]).toEqual(topS);
  });

  it('position independence: 4×2 at anchor (0,0) vs (10,7) produce identical anchor-local polygons', () => {
    const W = 4, H = 2;
    const fp0: { x: number; y: number }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fp0.push({ x, y });
    const fp10: { x: number; y: number }[] = [];
    for (let y = 7; y < 7 + H; y++) for (let x = 10; x < 10 + W; x++) fp10.push({ x, y });

    const r0 = cubeFacePolygons('residential', 3, 1, fp0, { x: 0, y: 0 })!;
    const r10 = cubeFacePolygons('residential', 3, 1, fp10, { x: 10, y: 7 })!;

    expect(toStr(r0.top)).toBe(toStr(r10.top));
    expect(toStr(r0.left)).toBe(toStr(r10.left));
    expect(toStr(r0.right)).toBe(toStr(r10.right));
  });

  it('empty footprint returns null', () => {
    expect(cubeFacePolygons('residential', 3, 1, [], { x: 0, y: 0 })).toBeNull();
  });

  it('level=0 returns null for 4×2 footprint', () => {
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) fp.push({ x, y });
    expect(cubeFacePolygons('residential', 0, 1, fp, { x: 0, y: 0 })).toBeNull();
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

// ---------------------------------------------------------------------------
// roofCapPolygons
// ---------------------------------------------------------------------------

// Known top diamond: span 32 in each direction, centred at origin.
// Vertices: N={x:0,y:-32}, E={x:32,y:0}, S={x:0,y:32}, W={x:-32,y:0}.
const TOP_DIAMOND = [
  { x: 0, y: -32 },
  { x: 32, y: 0 },
  { x: 0, y: 32 },
  { x: -32, y: 0 },
];

describe('roofCapPolygons — null guards', () => {
  it('returns null for roof === "flat"', () => {
    expect(roofCapPolygons(TOP_DIAMOND, 'flat', 'ns', 32)).toBeNull();
  });

  it('returns null for baseLiftPx <= 0', () => {
    expect(roofCapPolygons(TOP_DIAMOND, 'gabled', 'ns', 0)).toBeNull();
    expect(roofCapPolygons(TOP_DIAMOND, 'gabled', 'ns', -1)).toBeNull();
  });

  it('returns null for degenerate top array (length !== 4)', () => {
    expect(roofCapPolygons([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }], 'gabled', 'ns', 32)).toBeNull();
    expect(roofCapPolygons([], 'gabled', 'ns', 32)).toBeNull();
  });
});

describe('roofCapPolygons — gabled NS ridge', () => {
  // baseLiftPx=32 → gableRisePx = max(2, round(32*0.18)) = max(2, 6) = 6
  // ridgeN_un = {x:0, y:-16}, ridgeN = {x:0, y:-22}
  // ridgeS_un = {x:0, y:16},  ridgeS = {x:0, y:10}
  const result = roofCapPolygons(TOP_DIAMOND, 'gabled', 'ns', 32)!;

  it('returns exactly 2 faces with correct shadings', () => {
    expect(result).not.toBeNull();
    expect(result.faces.length).toBe(2);
    expect(result.faces[0].shading).toBe('right'); // east plane
    expect(result.faces[1].shading).toBe('left');  // west plane
  });

  it('each face polygon has 5 vertices', () => {
    expect(result.faces[0].poly.length).toBe(5);
    expect(result.faces[1].poly.length).toBe(5);
  });

  it('ridge invariant NS: ridgeN coordinates match expected values', () => {
    const gableRisePx = Math.max(2, Math.round(32 * 0.18));
    // ridgeN_un = midpoint(midNE, midNW) = {x:0, y:-16}
    const ridgeN = result.faces[0].poly[0];
    expect(ridgeN.x).toBeCloseTo(0, 10);
    expect(ridgeN.y).toBeCloseTo(-16 - gableRisePx, 10);
  });

  it('ridge invariant NS: ridgeS coordinates match expected values', () => {
    const gableRisePx = Math.max(2, Math.round(32 * 0.18));
    // ridgeS_un = midpoint(midSE, midSW) = {x:0, y:16}
    const ridgeS = result.faces[0].poly[4];
    expect(ridgeS.x).toBeCloseTo(0, 10);
    expect(ridgeS.y).toBeCloseTo(16 - gableRisePx, 10);
  });

  it('both gabled-NS planes share ridgeN and ridgeS endpoints (deep-equal coords)', () => {
    // east poly[0] and west poly[0] are both ridgeN
    expect(result.faces[0].poly[0]).toEqual(result.faces[1].poly[0]);
    // east poly[4] is ridgeS; west poly[1] is ridgeS
    expect(result.faces[0].poly[4]).toEqual(result.faces[1].poly[1]);
  });
});

describe('roofCapPolygons — gabled EW ridge', () => {
  // ridgeE_un = midpoint(midNE, midSE) = {x:16, y:0}
  // ridgeW_un = midpoint(midNW, midSW) = {x:-16, y:0}
  // gableRisePx=6 → ridgeE = {x:16, y:-6}, ridgeW = {x:-16, y:-6}
  const result = roofCapPolygons(TOP_DIAMOND, 'gabled', 'ew', 32)!;

  it('ridgeE.x > ridgeW.x', () => {
    // north poly = [ridgeW, W, N, E, ridgeE]
    const ridgeW = result.faces[0].poly[0];
    const ridgeE = result.faces[0].poly[4];
    expect(ridgeE.x).toBeGreaterThan(ridgeW.x);
  });

  it('ridgeE.y === ridgeW.y (ridge is horizontal in screen space)', () => {
    const ridgeW = result.faces[0].poly[0];
    const ridgeE = result.faces[0].poly[4];
    expect(ridgeE.y).toBeCloseTo(ridgeW.y, 10);
  });
});

describe('roofCapPolygons — stepped inner diamond span', () => {
  it('inner cap x-span equals 0.65 of input x-span', () => {
    const result = roofCapPolygons(TOP_DIAMOND, 'stepped', 'ns', 32)!;
    expect(result).not.toBeNull();
    // innerTop is the 3rd face (index 2), poly = [Ni, Ei, Si, Wi]
    const innerTop = result.faces[2].poly;
    const innerXSpan = innerTop[1].x - innerTop[3].x; // Ei.x - Wi.x
    const inputXSpan = TOP_DIAMOND[1].x - TOP_DIAMOND[3].x; // 64
    expect(Math.abs(innerXSpan - 0.65 * inputXSpan)).toBeLessThan(0.001);
  });

  it('inner cap y-span equals 0.65 of input y-span', () => {
    const result = roofCapPolygons(TOP_DIAMOND, 'stepped', 'ns', 32)!;
    const innerTop = result.faces[2].poly;
    const innerYSpan = innerTop[2].y - innerTop[0].y; // Si.y - Ni.y
    const inputYSpan = TOP_DIAMOND[2].y - TOP_DIAMOND[0].y; // 64
    expect(Math.abs(innerYSpan - 0.65 * inputYSpan)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// setbackTopPolygon
// ---------------------------------------------------------------------------
describe('setbackTopPolygon', () => {
  it('returns null for steps === 0', () => {
    expect(setbackTopPolygon(TOP_DIAMOND, 0, 32)).toBeNull();
  });

  it('1-step: top diamond has smaller span than input', () => {
    const result = setbackTopPolygon(TOP_DIAMOND, 1, 32)!;
    expect(result).not.toBeNull();
    const outXSpan = result.top[1].x - result.top[3].x;
    const inXSpan = TOP_DIAMOND[1].x - TOP_DIAMOND[3].x;
    expect(outXSpan).toBeLessThan(inXSpan);
    const outYSpan = result.top[2].y - result.top[0].y;
    const inYSpan = TOP_DIAMOND[2].y - TOP_DIAMOND[0].y;
    expect(outYSpan).toBeLessThan(inYSpan);
  });

  it('2-step: top diamond has smaller span than 1-step', () => {
    const result1 = setbackTopPolygon(TOP_DIAMOND, 1, 32)!;
    const result2 = setbackTopPolygon(TOP_DIAMOND, 2, 32)!;
    expect(result2).not.toBeNull();
    const span1X = result1.top[1].x - result1.top[3].x;
    const span2X = result2.top[1].x - result2.top[3].x;
    expect(span2X).toBeLessThan(span1X);
    const span1Y = result1.top[2].y - result1.top[0].y;
    const span2Y = result2.top[2].y - result2.top[0].y;
    expect(span2Y).toBeLessThan(span1Y);
  });
});

// ---------------------------------------------------------------------------
// cubeFacePolygons — liftScale parameter
// ---------------------------------------------------------------------------
describe('cubeFacePolygons — liftScale parameter', () => {
  const fp = [{ x: 0, y: 0 }];
  const anchor = { x: 0, y: 0 };

  it('liftScale=1 produces byte-identical output to the no-argument call (regression guard)', () => {
    const r_default = cubeFacePolygons('commercial', 3, 1, fp, anchor);
    const r_one = cubeFacePolygons('commercial', 3, 1, fp, anchor, 1);
    expect(r_one).toEqual(r_default);
  });

  it('liftScale=0.5 produces a top face whose y-lift is ~half the unscaled lift (within ±1px)', () => {
    const baseLift = cubeLiftPx(3, 1);
    const liftFull = cubeTypeHeightPx(baseLift, 'commercial');
    const liftHalf = Math.max(1, Math.round(liftFull * 0.5));
    const r1 = cubeFacePolygons('commercial', 3, 1, fp, anchor, 1)!;
    const r0_5 = cubeFacePolygons('commercial', 3, 1, fp, anchor, 0.5)!;
    // The top is shifted down by (liftFull - liftHalf) relative to the full-lift result.
    const yShift = r0_5.top[0].y - r1.top[0].y;
    expect(Math.abs(yShift - (liftFull - liftHalf))).toBeLessThanOrEqual(1);
  });

  it('liftScale=0 clamps the lift to 1 (silhouette preservation)', () => {
    const r0 = cubeFacePolygons('commercial', 3, 1, fp, anchor, 0)!;
    // left[2].y - top[3].y (= left[1].y) equals the clamped lift = 1
    expect(r0.left[2].y - r0.top[3].y).toBe(1);
  });
});
