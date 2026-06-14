import { describe, it, expect } from 'vitest';
import {
  contourPolygon,
  tileHasContourEdge,
  SAND_MAX_HEIGHT,
  ROCK_MIN_HEIGHT,
} from './heightContour';

const LOW = 0.5; // sand threshold (SAND_MAX_HEIGHT when SEA_LEVEL = 0)
const HIGH = 2.5; // rock threshold (ROCK_MIN_HEIGHT)

describe('thresholds', () => {
  it('SAND_MAX_HEIGHT is half a step above the waterline', () => {
    expect(SAND_MAX_HEIGHT).toBe(0.5);
  });
  it('ROCK_MIN_HEIGHT catches the higher ground', () => {
    expect(ROCK_MIN_HEIGHT).toBe(2.5);
  });
});

// Corner order is (topH, rightH, bottomH, leftH). SEA_LEVEL is 0.
describe('tileHasContourEdge — below (sand / shoreline edge)', () => {
  it('true when the top-right edge is submerged', () => {
    expect(tileHasContourEdge(0, 0, 1, 1, LOW, 'below')).toBe(true);
  });
  it('true when the right-bottom edge is submerged', () => {
    expect(tileHasContourEdge(1, 0, 0, 1, LOW, 'below')).toBe(true);
  });
  it('true when the bottom-left edge is submerged', () => {
    expect(tileHasContourEdge(1, 1, 0, 0, LOW, 'below')).toBe(true);
  });
  it('true when the left-top edge is submerged', () => {
    expect(tileHasContourEdge(0, 1, 1, 0, LOW, 'below')).toBe(true);
  });
  it('false for a single-corner (point-contact) tile', () => {
    expect(tileHasContourEdge(0, 1, 1, 1, LOW, 'below')).toBe(false);
  });
  it('false for a fully inland tile', () => {
    expect(tileHasContourEdge(1, 1, 1, 1, LOW, 'below')).toBe(false);
  });
});

describe('tileHasContourEdge — above (rock / ridge edge)', () => {
  it('true when the top-right edge is a high ridge', () => {
    expect(tileHasContourEdge(3, 3, 1, 1, HIGH, 'above')).toBe(true);
  });
  it('true when the bottom-left edge is a high ridge', () => {
    expect(tileHasContourEdge(1, 1, 3, 3, HIGH, 'above')).toBe(true);
  });
  it('false for a single high corner (point peak)', () => {
    expect(tileHasContourEdge(3, 1, 1, 1, HIGH, 'above')).toBe(false);
  });
  it('false for fully low ground', () => {
    expect(tileHasContourEdge(1, 1, 1, 1, HIGH, 'above')).toBe(false);
  });
});

describe('contourPolygon — below (sand beach)', () => {
  it('returns nothing when every corner is above (all grass)', () => {
    expect(contourPolygon(1, 1, 1, LOW, 'below')).toEqual([]);
  });
  it('returns the whole triangle when every corner is below', () => {
    expect(contourPolygon(0, 0, 0, LOW, 'below')).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'corner', i: 1 },
      { kind: 'corner', i: 2 },
    ]);
  });
  it('clips to a wedge at corner 0 when only corner 0 is below', () => {
    expect(contourPolygon(0, 1, 1, LOW, 'below')).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'edge', a: 0, b: 1, t: 0.5 },
      { kind: 'edge', a: 0, b: 2, t: 0.5 },
    ]);
  });
  it('clips to a wedge at corner 1 when only corner 1 is below', () => {
    expect(contourPolygon(1, 0, 1, LOW, 'below')).toEqual([
      { kind: 'corner', i: 1 },
      { kind: 'edge', a: 1, b: 2, t: 0.5 },
      { kind: 'edge', a: 1, b: 0, t: 0.5 },
    ]);
  });
  it('clips to a wedge at corner 2 when only corner 2 is below', () => {
    expect(contourPolygon(1, 1, 0, LOW, 'below')).toEqual([
      { kind: 'corner', i: 2 },
      { kind: 'edge', a: 2, b: 0, t: 0.5 },
      { kind: 'edge', a: 2, b: 1, t: 0.5 },
    ]);
  });
  it('clips to a quad when corner 0 is the only one above', () => {
    expect(contourPolygon(1, 0, 0, LOW, 'below')).toEqual([
      { kind: 'corner', i: 1 },
      { kind: 'corner', i: 2 },
      { kind: 'edge', a: 2, b: 0, t: 0.5 },
      { kind: 'edge', a: 1, b: 0, t: 0.5 },
    ]);
  });
  it('clips to a quad when corner 1 is the only one above', () => {
    expect(contourPolygon(0, 1, 0, LOW, 'below')).toEqual([
      { kind: 'corner', i: 2 },
      { kind: 'corner', i: 0 },
      { kind: 'edge', a: 0, b: 1, t: 0.5 },
      { kind: 'edge', a: 2, b: 1, t: 0.5 },
    ]);
  });
  it('clips to a quad when corner 2 is the only one above', () => {
    expect(contourPolygon(0, 0, 1, LOW, 'below')).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'corner', i: 1 },
      { kind: 'edge', a: 1, b: 2, t: 0.5 },
      { kind: 'edge', a: 0, b: 2, t: 0.5 },
    ]);
  });
  it('keeps the band continuous at a shared corner (split-case regression)', () => {
    // Coastal tile { top:0, right:0, bottom:1, left:1 }, TB split:
    //   East = (bottom,right,top) = (1,0,0) → band quad; West = (1,1,0) → corner wedge.
    expect(contourPolygon(1, 0, 0, LOW, 'below')).toHaveLength(4);
    const west = contourPolygon(1, 1, 0, LOW, 'below');
    expect(west).toHaveLength(3);
    expect(west[0]).toEqual({ kind: 'corner', i: 2 });
  });
});

describe('contourPolygon — above (highland rock)', () => {
  it('returns nothing when every corner is below the rock line', () => {
    expect(contourPolygon(1, 1, 1, HIGH, 'above')).toEqual([]);
  });
  it('returns the whole triangle when every corner is above', () => {
    expect(contourPolygon(3, 3, 3, HIGH, 'above')).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'corner', i: 1 },
      { kind: 'corner', i: 2 },
    ]);
  });
  it('clips to a wedge at corner 0 when only corner 0 is above, interpolating by height', () => {
    // cross t = (2.5 - 3) / (1 - 3) = 0.25 along each edge leaving the peak corner.
    expect(contourPolygon(3, 1, 1, HIGH, 'above')).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'edge', a: 0, b: 1, t: 0.25 },
      { kind: 'edge', a: 0, b: 2, t: 0.25 },
    ]);
  });
  it('clips to a wedge at corner 1 when only corner 1 is above', () => {
    expect(contourPolygon(1, 3, 1, HIGH, 'above')).toEqual([
      { kind: 'corner', i: 1 },
      { kind: 'edge', a: 1, b: 2, t: 0.25 },
      { kind: 'edge', a: 1, b: 0, t: 0.25 },
    ]);
  });
  it('clips to a wedge at corner 2 when only corner 2 is above', () => {
    expect(contourPolygon(1, 1, 3, HIGH, 'above')).toEqual([
      { kind: 'corner', i: 2 },
      { kind: 'edge', a: 2, b: 0, t: 0.25 },
      { kind: 'edge', a: 2, b: 1, t: 0.25 },
    ]);
  });
  it('clips to a quad when corner 0 is the only one below', () => {
    expect(contourPolygon(1, 3, 3, HIGH, 'above')).toEqual([
      { kind: 'corner', i: 1 },
      { kind: 'corner', i: 2 },
      { kind: 'edge', a: 2, b: 0, t: 0.25 },
      { kind: 'edge', a: 1, b: 0, t: 0.25 },
    ]);
  });
  it('clips to a quad when corner 1 is the only one below', () => {
    expect(contourPolygon(3, 1, 3, HIGH, 'above')).toEqual([
      { kind: 'corner', i: 2 },
      { kind: 'corner', i: 0 },
      { kind: 'edge', a: 0, b: 1, t: 0.25 },
      { kind: 'edge', a: 2, b: 1, t: 0.25 },
    ]);
  });
  it('clips to a quad when corner 2 is the only one below', () => {
    expect(contourPolygon(3, 3, 1, HIGH, 'above')).toEqual([
      { kind: 'corner', i: 0 },
      { kind: 'corner', i: 1 },
      { kind: 'edge', a: 1, b: 2, t: 0.25 },
      { kind: 'edge', a: 0, b: 2, t: 0.25 },
    ]);
  });
});
