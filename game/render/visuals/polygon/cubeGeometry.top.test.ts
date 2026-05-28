import { describe, it, expect } from 'vitest';
import {
  isNwAnchoredFullRectFootprint,
  rectangularUnionTopPolygon,
} from './cubeGeometry';
import { ISO_CONFIG } from '@/game/render/IsoTransform';

// ---------------------------------------------------------------------------
// normalizeFootprint
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
