import { describe, it, expect } from 'vitest';
import { rectDragPath } from './BulldozeTool';
import type { TileCoord } from '../types/coordinates';

const c = (x: number, y: number): TileCoord => ({ x, y });

describe('rectDragPath', () => {
  it('returns a single tile when start equals end', () => {
    expect(rectDragPath(c(3, 3), c(3, 3))).toEqual([c(3, 3)]);
  });

  it('fills the bounding rectangle row-major', () => {
    expect(rectDragPath(c(0, 0), c(2, 1))).toEqual([
      c(0, 0),
      c(1, 0),
      c(2, 0),
      c(0, 1),
      c(1, 1),
      c(2, 1),
    ]);
  });

  it('is direction-independent (corners may be dragged any way)', () => {
    expect(rectDragPath(c(2, 1), c(0, 0))).toEqual(
      rectDragPath(c(0, 0), c(2, 1))
    );
  });

  it('handles a degenerate single-row drag', () => {
    expect(rectDragPath(c(1, 4), c(3, 4))).toEqual([
      c(1, 4),
      c(2, 4),
      c(3, 4),
    ]);
  });
});
