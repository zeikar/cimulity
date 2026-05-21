import { describe, it, expect } from 'vitest';
import { shouldDrawFace, wallSteps } from './tileSideWalls';

describe('shouldDrawFace', () => {
  // (a) N and W faces are never drawn regardless of heights
  it('(a) never draws N face', () => {
    expect(shouldDrawFace('n', 3, 0)).toBe(false);
    expect(shouldDrawFace('n', 3, undefined)).toBe(false);
  });

  it('(a) never draws W face', () => {
    expect(shouldDrawFace('w', 3, 0)).toBe(false);
    expect(shouldDrawFace('w', 3, undefined)).toBe(false);
  });

  // (b) S/E drawn when selfRH > neighbor
  it('(b) draws S when selfRH > neighborRH', () => {
    expect(shouldDrawFace('s', 3, 1)).toBe(true);
  });

  it('(b) draws E when selfRH > neighborRH', () => {
    expect(shouldDrawFace('e', 4, 2)).toBe(true);
  });

  // (c) S/E NOT drawn when selfRH === neighbor
  it('(c) does not draw S when selfRH === neighborRH', () => {
    expect(shouldDrawFace('s', 2, 2)).toBe(false);
  });

  it('(c) does not draw E when selfRH === neighborRH', () => {
    expect(shouldDrawFace('e', 3, 3)).toBe(false);
  });

  // (d) S/E NOT drawn when selfRH < neighbor
  it('(d) does not draw S when selfRH < neighborRH', () => {
    expect(shouldDrawFace('s', 1, 3)).toBe(false);
  });

  // (e) OOB neighbor (undefined) with selfRH=1: effectiveNeighborRH=max(0,0)=0, so selfRH>0 → draw
  it('(e) draws S when neighbor is OOB (undefined) and selfRH=1', () => {
    expect(shouldDrawFace('s', 1, undefined)).toBe(true);
  });

  // (f) OOB neighbor (undefined) with selfRH=0: effectiveNeighborRH=max(0,-1)=0, so 0>0 is false → no draw
  it('(f) does not draw S when neighbor is OOB and selfRH=0', () => {
    expect(shouldDrawFace('s', 0, undefined)).toBe(false);
  });

  // (g) OOB neighbor with selfRH=3: effectiveNeighborRH=2, so 3>2 → draw; wallSteps=1
  it('(g) draws S with 1-step wall when neighbor is OOB and selfRH=3', () => {
    expect(shouldDrawFace('s', 3, undefined)).toBe(true);
    expect(wallSteps(3, undefined)).toBe(1);
  });
});

describe('wallSteps', () => {
  it('returns difference when neighbor is defined', () => {
    expect(wallSteps(4, 2)).toBe(2);
  });

  it('returns 0 when self equals neighbor', () => {
    expect(wallSteps(3, 3)).toBe(0);
  });

  it('returns 0 when self is below neighbor', () => {
    expect(wallSteps(1, 3)).toBe(0);
  });

  it('returns 1 when neighbor is OOB (undefined) and selfRH=3 — D1 clamp', () => {
    // effectiveNeighborRH = max(0, 3-1) = 2, so wallSteps = 3-2 = 1
    expect(wallSteps(3, undefined)).toBe(1);
  });

  it('returns 0 when neighbor is OOB and selfRH=0 — clamp prevents negative', () => {
    expect(wallSteps(0, undefined)).toBe(0);
  });
});
