import { describe, it, expect } from 'vitest';
import {
  isNwAnchoredFullRectFootprint,
  rectangularUnionTopPolygon,
  roofCapPolygons,
  setbackTopPolygon,
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
