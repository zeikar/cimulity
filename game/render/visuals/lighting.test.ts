import { describe, it, expect } from 'vitest';
import {
  LIGHT_DIR_WORLD,
  AMBIENT,
  DIFFUSE,
  dot,
  cross,
  sub,
  normalize,
  upwardTriangleNormal,
  faceBrightness,
} from './lighting';

describe('LIGHT_DIR_WORLD', () => {
  it('x component is negative (light from the west, screen ~10 o\'clock)', () => {
    expect(LIGHT_DIR_WORLD[0]).toBeLessThan(0);
  });
  it('y component is zero (no N/S bias — screen 10 o\'clock projects to pure-west world)', () => {
    expect(LIGHT_DIR_WORLD[1]).toBe(0);
  });
  it('z component is positive (light from above)', () => {
    expect(LIGHT_DIR_WORLD[2]).toBeGreaterThan(0);
  });
  it('magnitude is 1 within 1e-9', () => {
    const [x, y, z] = LIGHT_DIR_WORLD;
    const mag = Math.sqrt(x * x + y * y + z * z);
    expect(Math.abs(mag - 1)).toBeLessThan(1e-9);
  });
});

describe('AMBIENT + DIFFUSE', () => {
  it('sum equals 1.0 exactly', () => {
    expect(AMBIENT + DIFFUSE).toBe(1.0);
  });
});

describe('dot', () => {
  it('dot([1,2,3], [4,5,6]) === 32', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });
});

describe('cross', () => {
  it('cross([1,0,0], [0,1,0]) === [0,0,1]', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });
});

describe('sub', () => {
  it('sub([3,2,1], [1,1,1]) === [2,1,0]', () => {
    expect(sub([3, 2, 1], [1, 1, 1])).toEqual([2, 1, 0]);
  });
});

describe('normalize', () => {
  it('[3,0,0] normalizes to [1,0,0]', () => {
    expect(normalize([3, 0, 0])).toEqual([1, 0, 0]);
  });
  it('[0,0,0] returns fallback [0,0,1]', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 1]);
  });
  it('[1,2,2] has length 1 within 1e-9', () => {
    const n = normalize([1, 2, 2]);
    const mag = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    expect(Math.abs(mag - 1)).toBeLessThan(1e-9);
  });
});

describe('upwardTriangleNormal', () => {
  it('CCW triangle in XY plane → (0,0,1)', () => {
    // (0,0,0), (1,0,0), (0,1,0) — CCW when viewed from +z
    const n = upwardTriangleNormal([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(n[0]).toBeCloseTo(0, 9);
    expect(n[1]).toBeCloseTo(0, 9);
    expect(n[2]).toBeCloseTo(1, 9);
  });
  it('CW (inverted winding) → (0,0,1) via z-flip branch', () => {
    // (0,0,0), (0,1,0), (1,0,0) — CW when viewed from +z → raw cross gives (0,0,-1), flipped
    const n = upwardTriangleNormal([0, 0, 0], [0, 1, 0], [1, 0, 0]);
    expect(n[0]).toBeCloseTo(0, 9);
    expect(n[1]).toBeCloseTo(0, 9);
    expect(n[2]).toBeCloseTo(1, 9);
  });
  it('tilted (0,0,0),(1,0,1),(0,1,0) → nx<0 and nz>0', () => {
    // b-a=(1,0,1), c-a=(0,1,0); cross=(-1,0,1), normalize → (-1/√2, 0, 1/√2)
    const n = upwardTriangleNormal([0, 0, 0], [1, 0, 1], [0, 1, 0]);
    expect(n[0]).toBeLessThan(0);
    expect(n[2]).toBeGreaterThan(0);
  });
  it('degenerate colinear (0,0,0),(1,1,1),(2,2,2) → fallback (0,0,1)', () => {
    const n = upwardTriangleNormal([0, 0, 0], [1, 1, 1], [2, 2, 2]);
    expect(n[0]).toBeCloseTo(0, 9);
    expect(n[1]).toBeCloseTo(0, 9);
    expect(n[2]).toBeCloseTo(1, 9);
  });
});

describe('faceBrightness', () => {
  it('flat-up [0,0,1] → 1.0 exactly', () => {
    expect(faceBrightness([0, 0, 1])).toBeCloseTo(1.0, 9);
  });
  it('NW-up normalize([-1,-1,1]) → 1.0 (clamped, out-aligns light)', () => {
    expect(faceBrightness(normalize([-1, -1, 1]))).toBeCloseTo(1.0, 9);
  });
  it('SE-up normalize([1,1,1]) → AMBIENT (negative dot, clamped)', () => {
    expect(faceBrightness(normalize([1, 1, 1]))).toBeCloseTo(AMBIENT, 9);
  });
  it('gentle SE-up normalize([0.1,0.1,1]) is strictly between AMBIENT and 1.0', () => {
    const b = faceBrightness(normalize([0.1, 0.1, 1]));
    expect(b).toBeGreaterThan(AMBIENT);
    expect(b).toBeLessThan(1.0);
  });
  it('gentle SE-up normalize([0.1,0.1,1]) ≈ 0.9510', () => {
    expect(faceBrightness(normalize([0.1, 0.1, 1]))).toBeCloseTo(0.9510, 3);
  });
  it('back-facing normalize([1,1,-1]) → AMBIENT', () => {
    expect(faceBrightness(normalize([1, 1, -1]))).toBeCloseTo(AMBIENT, 9);
  });
  it('pure-west > pure-east (west faces light, east faces away)', () => {
    const west = faceBrightness(normalize([-1, 0, 0]));
    const east = faceBrightness(normalize([1, 0, 0]));
    expect(west).toBeGreaterThan(east);
  });
  it('pure-west = 1.0 exact (aligns with light horizontal, clamped at ceiling)', () => {
    expect(faceBrightness(normalize([-1, 0, 0]))).toBe(1.0);
  });
  it('pure-north === pure-south (both perpendicular to light horizontal, both clamp to AMBIENT)', () => {
    // Light vector y=0 means N/S slope normals get equal (zero) dot with light's horizontal component;
    // both clamp to AMBIENT. This is the intentional consequence of the screen-10-o'clock light direction.
    const north = faceBrightness(normalize([0, -1, 0]));
    const south = faceBrightness(normalize([0, 1, 0]));
    expect(north).toBe(south);
    expect(north).toBeCloseTo(AMBIENT, 9);
  });
  it('pure-east → AMBIENT exact', () => {
    expect(faceBrightness(normalize([1, 0, 0]))).toBeCloseTo(AMBIENT, 9);
  });
  it('pure-south → AMBIENT exact', () => {
    expect(faceBrightness(normalize([0, 1, 0]))).toBeCloseTo(AMBIENT, 9);
  });
  it('non-unit [0,0,5] yields same brightness as [0,0,1]', () => {
    expect(faceBrightness([0, 0, 5])).toBeCloseTo(faceBrightness([0, 0, 1]), 9);
  });
  it('degenerate zero normal → same brightness as (0,0,1)', () => {
    expect(faceBrightness([0, 0, 0])).toBeCloseTo(faceBrightness([0, 0, 1]), 9);
  });
});
