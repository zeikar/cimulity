import { describe, it, expect } from 'vitest';
import { sandBelowContour, tileHasShorelineEdge, SAND_MAX_HEIGHT } from './sandContour';

const T = 0.5; // threshold used in most cases (SAND_MAX_HEIGHT when SEA_LEVEL = 0)

// Corner order is (topH, rightH, bottomH, leftH). SEA_LEVEL is 0.
describe('tileHasShorelineEdge', () => {
  it('is true when the top-right edge is submerged', () => {
    expect(tileHasShorelineEdge(0, 0, 1, 1)).toBe(true);
  });
  it('is true when the right-bottom edge is submerged', () => {
    expect(tileHasShorelineEdge(1, 0, 0, 1)).toBe(true);
  });
  it('is true when the bottom-left edge is submerged', () => {
    expect(tileHasShorelineEdge(1, 1, 0, 0)).toBe(true);
  });
  it('is true when the left-top edge is submerged', () => {
    expect(tileHasShorelineEdge(0, 1, 1, 0)).toBe(true);
  });
  it('is false for a single-corner (point-contact) tile — no submerged edge', () => {
    expect(tileHasShorelineEdge(0, 1, 1, 1)).toBe(false);
  });
  it('is false for a fully inland tile', () => {
    expect(tileHasShorelineEdge(1, 1, 1, 1)).toBe(false);
  });
});

describe('SAND_MAX_HEIGHT', () => {
  it('is half a step above the waterline', () => {
    expect(SAND_MAX_HEIGHT).toBe(0.5);
  });
});

describe('sandBelowContour', () => {
  it('returns nothing when every corner is above the threshold (all grass)', () => {
    expect(sandBelowContour(1, 1, 1, T)).toEqual([]);
  });

  it('returns the whole triangle when every corner is below (all sand)', () => {
    expect(sandBelowContour(0, 0, 0, T)).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'corner', i: 1 },
      { kind: 'corner', i: 2 },
    ]);
  });

  // One corner below → small triangle at that corner; the contour crosses the two
  // edges leaving it. Covers each of the three corner positions.
  it('clips to a triangle at corner 0 when only corner 0 is below', () => {
    expect(sandBelowContour(0, 1, 1, T)).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'edge', a: 0, b: 1, t: 0.5 },
      { kind: 'edge', a: 0, b: 2, t: 0.5 },
    ]);
  });

  it('clips to a triangle at corner 1 when only corner 1 is below', () => {
    expect(sandBelowContour(1, 0, 1, T)).toEqual([
      { kind: 'corner', i: 1 },
      { kind: 'edge', a: 1, b: 2, t: 0.5 },
      { kind: 'edge', a: 1, b: 0, t: 0.5 },
    ]);
  });

  it('clips to a triangle at corner 2 when only corner 2 is below', () => {
    expect(sandBelowContour(1, 1, 0, T)).toEqual([
      { kind: 'corner', i: 2 },
      { kind: 'edge', a: 2, b: 0, t: 0.5 },
      { kind: 'edge', a: 2, b: 1, t: 0.5 },
    ]);
  });

  // Two corners below → quad: the two below corners + crossings on the two edges
  // leaving the single above corner. Covers each above-corner position.
  it('clips to a quad when corner 0 is the only one above', () => {
    expect(sandBelowContour(1, 0, 0, T)).toEqual([
      { kind: 'corner', i: 1 },
      { kind: 'corner', i: 2 },
      { kind: 'edge', a: 2, b: 0, t: 0.5 },
      { kind: 'edge', a: 1, b: 0, t: 0.5 },
    ]);
  });

  it('clips to a quad when corner 1 is the only one above', () => {
    expect(sandBelowContour(0, 1, 0, T)).toEqual([
      { kind: 'corner', i: 2 },
      { kind: 'corner', i: 0 },
      { kind: 'edge', a: 0, b: 1, t: 0.5 },
      { kind: 'edge', a: 2, b: 1, t: 0.5 },
    ]);
  });

  it('clips to a quad when corner 2 is the only one above', () => {
    expect(sandBelowContour(0, 0, 1, T)).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'corner', i: 1 },
      { kind: 'edge', a: 1, b: 2, t: 0.5 },
      { kind: 'edge', a: 0, b: 2, t: 0.5 },
    ]);
  });

  it('keeps the beach continuous at a shared waterline corner (split-case regression)', () => {
    // Classic coastal tile { top:0, right:0, bottom:1, left:1 } under the TB split:
    //   East = (bottom,right,top) = (1,0,0) → full band quad (two sea corners)
    //   West = (bottom,left,top)  = (1,1,0) → small wedge at the SHARED top corner
    // Both non-empty, so the sand wraps the corner with no grass notch. The
    // height-contour model intentionally sands the one-sea-corner half here —
    // this is the opposite of the retired per-triangle "exactly two sea corners"
    // contract, and is what makes the coastline read as a smooth beach.
    expect(sandBelowContour(1, 0, 0, T)).toHaveLength(4); // East: band quad
    const west = sandBelowContour(1, 1, 0, T);            // West: wedge at top corner
    expect(west).toHaveLength(3);
    expect(west[0]).toEqual({ kind: 'corner', i: 2 });    // the shared waterline (top) corner
  });

  it('interpolates the crossing parameter by height, not at the midpoint, for uneven corners', () => {
    // corner 0 below at height 0, corners 1 & 2 above at height 3 → crossing at
    // t = (0.5 - 0) / (3 - 0) = 1/6 along each edge leaving corner 0.
    const poly = sandBelowContour(0, 3, 3, T);
    expect(poly).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'edge', a: 0, b: 1, t: 0.5 / 3 },
      { kind: 'edge', a: 0, b: 2, t: 0.5 / 3 },
    ]);
  });
});
