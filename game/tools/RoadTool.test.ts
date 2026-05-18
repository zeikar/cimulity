import { describe, it, expect } from 'vitest';
import { snapRoadDragPath } from './RoadTool';
import type { TileCoord } from '../types/coordinates';

const c = (x: number, y: number): TileCoord => ({ x, y });

describe('snapRoadDragPath', () => {
  it('returns a single tile when start equals end', () => {
    expect(snapRoadDragPath(c(3, 3), c(3, 3))).toEqual([c(3, 3)]);
  });

  it('snaps to a horizontal line when horizontal dominates (adx > ady*2)', () => {
    expect(snapRoadDragPath(c(0, 0), c(5, 1))).toEqual([
      c(0, 0),
      c(1, 0),
      c(2, 0),
      c(3, 0),
      c(4, 0),
      c(5, 0),
    ]);
  });

  it('snaps to a vertical line when vertical dominates (ady > adx*2)', () => {
    expect(snapRoadDragPath(c(0, 0), c(1, 4))).toEqual([
      c(0, 0),
      c(0, 1),
      c(0, 2),
      c(0, 3),
      c(0, 4),
    ]);
  });

  it('snaps to a perfect 45° diagonal in the ambiguous zone', () => {
    // adx=3, ady=2: neither axis dominates → diagonal, no staircase
    expect(snapRoadDragPath(c(0, 0), c(3, 2))).toEqual([
      c(0, 0),
      c(1, 1),
      c(2, 2),
      c(3, 3),
    ]);
  });

  it('treats an exact 2:1 ratio as diagonal, not horizontal (boundary is strict >)', () => {
    // adx=2, ady=1: 2 > 1*2 is false → falls through to 45°
    expect(snapRoadDragPath(c(0, 0), c(2, 1))).toEqual([
      c(0, 0),
      c(1, 1),
      c(2, 2),
    ]);
  });

  it('handles negative directions on a diagonal drag', () => {
    expect(snapRoadDragPath(c(5, 5), c(1, 1))).toEqual([
      c(5, 5),
      c(4, 4),
      c(3, 3),
      c(2, 2),
      c(1, 1),
    ]);
  });

  it('handles a leftward horizontal drag', () => {
    expect(snapRoadDragPath(c(4, 2), c(0, 3))).toEqual([
      c(4, 2),
      c(3, 2),
      c(2, 2),
      c(1, 2),
      c(0, 2),
    ]);
  });
});
