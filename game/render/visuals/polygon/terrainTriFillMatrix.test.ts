import { describe, it, expect } from 'vitest';
import { terrainTriFillMatrix } from './terrainTriFillMatrix';

// A non-axis-aligned, non-parallelogram triangle (slope-deformed) with distinct
// UVs — would fail if the solve only handled parallelograms.
const screenA = { x: 10, y: 20 };
const screenB = { x: 70, y: 35 };
const screenC = { x: 40, y: 90 };
const uvA = { u: 0, v: 0 };
const uvB = { u: 256, v: 0 };
const uvC = { u: 128, v: 256 };

describe('terrainTriFillMatrix', () => {
  it('maps each UV corner onto its screen corner', () => {
    const m = terrainTriFillMatrix(screenA, screenB, screenC, uvA, uvB, uvC);
    const pA = m.apply({ x: uvA.u, y: uvA.v });
    const pB = m.apply({ x: uvB.u, y: uvB.v });
    const pC = m.apply({ x: uvC.u, y: uvC.v });
    expect(pA.x).toBeCloseTo(screenA.x, 6);
    expect(pA.y).toBeCloseTo(screenA.y, 6);
    expect(pB.x).toBeCloseTo(screenB.x, 6);
    expect(pB.y).toBeCloseTo(screenB.y, 6);
    expect(pC.x).toBeCloseTo(screenC.x, 6);
    expect(pC.y).toBeCloseTo(screenC.y, 6);
  });

  it('maps the UV centroid onto the screen centroid (interior affine check)', () => {
    const m = terrainTriFillMatrix(screenA, screenB, screenC, uvA, uvB, uvC);
    const uc = (uvA.u + uvB.u + uvC.u) / 3;
    const vc = (uvA.v + uvB.v + uvC.v) / 3;
    const p = m.apply({ x: uc, y: vc });
    expect(p.x).toBeCloseTo((screenA.x + screenB.x + screenC.x) / 3, 6);
    expect(p.y).toBeCloseTo((screenA.y + screenB.y + screenC.y) / 3, 6);
  });

  it('is deterministic for identical inputs', () => {
    const m1 = terrainTriFillMatrix(screenA, screenB, screenC, uvA, uvB, uvC);
    const m2 = terrainTriFillMatrix(screenA, screenB, screenC, uvA, uvB, uvC);
    expect([m1.a, m1.b, m1.c, m1.d, m1.tx, m1.ty]).toEqual([m2.a, m2.b, m2.c, m2.d, m2.tx, m2.ty]);
  });
});
