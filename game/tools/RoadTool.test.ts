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

  it('snaps to a perfect 45° diagonal in the ambiguous zone (Y-first staircase)', () => {
    // adx=3, ady=2: neither axis dominates → 45° diagonal snapped to len=3.
    // Staircase: Y-first intermediate between each diagonal step.
    expect(snapRoadDragPath(c(0, 0), c(3, 2))).toEqual([
      c(0, 0), c(0, 1),
      c(1, 1), c(1, 2),
      c(2, 2), c(2, 3),
      c(3, 3),
    ]);
  });

  it('treats an exact 2:1 ratio as diagonal, not horizontal (boundary is strict >)', () => {
    // adx=2, ady=1: 2 > 1*2 is false → falls through to 45°, len=2.
    expect(snapRoadDragPath(c(0, 0), c(2, 1))).toEqual([
      c(0, 0), c(0, 1),
      c(1, 1), c(1, 2),
      c(2, 2),
    ]);
  });

  it('handles negative directions on a diagonal drag (Y-first staircase)', () => {
    // stepX=-1, stepY=-1, len=4 → 2*4+1 = 9 tiles
    expect(snapRoadDragPath(c(5, 5), c(1, 1))).toEqual([
      c(5, 5), c(5, 4),
      c(4, 4), c(4, 3),
      c(3, 3), c(3, 2),
      c(2, 2), c(2, 1),
      c(1, 1),
    ]);
  });

  it('diagonal path has 2*len+1 tiles with correct first and last tile', () => {
    // (1,1)->(3,3): len=2, expect 2*2+1=5 tiles
    const path = snapRoadDragPath(c(1, 1), c(3, 3));
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual(c(1, 1));
    expect(path[path.length - 1]).toEqual(c(3, 3));
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
