import { describe, it, expect } from 'vitest';
import { isCanonicalFootprintRect } from './buildingFootprint';

// Helper: build a full W×H rect starting at (ox, oy)
function rect(ox: number, oy: number, w: number, h: number) {
  const cells: { x: number; y: number }[] = [];
  for (let y = oy; y < oy + h; y++) {
    for (let x = ox; x < ox + w; x++) {
      cells.push({ x, y });
    }
  }
  return cells;
}

describe('isCanonicalFootprintRect', () => {
  it('accepts a 1×1 footprint', () => {
    expect(isCanonicalFootprintRect([{ x: 3, y: 4 }], { x: 3, y: 4 })).toBe(true);
  });

  it('accepts a 2×2 full rect with NW anchor', () => {
    expect(isCanonicalFootprintRect(rect(1, 1, 2, 2), { x: 1, y: 1 })).toBe(true);
  });

  it('accepts a 4×4 full rect (max size)', () => {
    expect(isCanonicalFootprintRect(rect(0, 0, 4, 4), { x: 0, y: 0 })).toBe(true);
  });

  it('accepts a 1×4 rect', () => {
    expect(isCanonicalFootprintRect(rect(2, 5, 1, 4), { x: 2, y: 5 })).toBe(true);
  });

  it('accepts a 4×1 rect', () => {
    expect(isCanonicalFootprintRect(rect(0, 3, 4, 1), { x: 0, y: 3 })).toBe(true);
  });

  it('rejects an L-shape (3 cells, one corner missing)', () => {
    // 2×2 minus top-right corner
    const lShape = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
    expect(isCanonicalFootprintRect(lShape, { x: 0, y: 0 })).toBe(false);
  });

  it('rejects a 2×2 rect whose anchor is the SE corner (not NW)', () => {
    expect(isCanonicalFootprintRect(rect(0, 0, 2, 2), { x: 1, y: 1 })).toBe(false);
  });

  it('rejects a 2×2 rect whose anchor is not in the footprint at all', () => {
    expect(isCanonicalFootprintRect(rect(2, 2, 2, 2), { x: 0, y: 0 })).toBe(false);
  });

  it('rejects a 5×1 rect (W=5 > 4)', () => {
    expect(isCanonicalFootprintRect(rect(0, 0, 5, 1), { x: 0, y: 0 })).toBe(false);
  });

  it('rejects a 1×5 rect (H=5 > 4)', () => {
    expect(isCanonicalFootprintRect(rect(0, 0, 1, 5), { x: 0, y: 0 })).toBe(false);
  });

  it('rejects an empty footprint', () => {
    expect(isCanonicalFootprintRect([], { x: 0, y: 0 })).toBe(false);
  });

  it('rejects a footprint with duplicate cells (same count as W*H)', () => {
    // 2×2 bounding box → W*H=4, but two of the four cells are the same
    // so length===4 passes the count check, but duplicates mean a cell is missing
    const dupes = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(isCanonicalFootprintRect(dupes, { x: 0, y: 0 })).toBe(false);
  });

  it('rejects a 3×3 footprint with the center cell missing (hole)', () => {
    const cells = rect(0, 0, 3, 3).filter((c) => !(c.x === 1 && c.y === 1));
    expect(isCanonicalFootprintRect(cells, { x: 0, y: 0 })).toBe(false);
  });

  it('rejects a footprint with disconnected cells', () => {
    // Two cells far apart — bounding rect would be 6×6 but only 2 cells present
    expect(isCanonicalFootprintRect([{ x: 0, y: 0 }, { x: 5, y: 5 }], { x: 0, y: 0 })).toBe(false);
  });
});
