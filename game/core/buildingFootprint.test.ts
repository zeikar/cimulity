import { describe, it, expect } from 'vitest';
import { isCanonicalFootprintRect, isCanonicalRect, isStructureRectInLot } from './buildingFootprint';
import type { Rect } from './buildingFootprint';

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

describe('isCanonicalRect', () => {
  it('accepts a valid rect with positive integer x,y,w,h', () => {
    expect(isCanonicalRect({ x: 0, y: 0, w: 2, h: 3 })).toBe(true);
  });

  it('accepts a 1×1 rect at non-zero origin', () => {
    expect(isCanonicalRect({ x: 5, y: 7, w: 1, h: 1 })).toBe(true);
  });

  it('rejects negative x', () => {
    expect(isCanonicalRect({ x: -1, y: 0, w: 1, h: 1 })).toBe(false);
  });

  it('rejects h=0', () => {
    expect(isCanonicalRect({ x: 0, y: 0, w: 1, h: 0 })).toBe(false);
  });

  it('rejects fractional w', () => {
    expect(isCanonicalRect({ x: 0, y: 0, w: 1.5, h: 1 })).toBe(false);
  });
});

describe('isStructureRectInLot', () => {
  const lot: Rect = { x: 2, y: 3, w: 4, h: 4 };

  it('N frontage: structureRect pinned to north edge, full width → true', () => {
    // sr.y === lot.y, sr.x === lot.x, sr.w === lot.w
    expect(isStructureRectInLot({ x: 2, y: 3, w: 4, h: 1 }, lot, 'N')).toBe(true);
  });

  it('S frontage: structureRect pinned to south edge, full width → true', () => {
    // sr.y + sr.h === lot.y + lot.h
    expect(isStructureRectInLot({ x: 2, y: 6, w: 4, h: 1 }, lot, 'S')).toBe(true);
  });

  it('W frontage: structureRect pinned to west edge, full height → true', () => {
    expect(isStructureRectInLot({ x: 2, y: 3, w: 1, h: 4 }, lot, 'W')).toBe(true);
  });

  it('E frontage: structureRect pinned to east edge, full height → true', () => {
    // sr.x + sr.w === lot.x + lot.w
    expect(isStructureRectInLot({ x: 5, y: 3, w: 1, h: 4 }, lot, 'E')).toBe(true);
  });

  it('S frontage: w !== lot.w → false (width-axis full span required)', () => {
    expect(isStructureRectInLot({ x: 2, y: 6, w: 3, h: 1 }, lot, 'S')).toBe(false);
  });

  it('out-of-lot: structureRect extends past east border → false', () => {
    expect(isStructureRectInLot({ x: 2, y: 3, w: 5, h: 1 }, lot, 'N')).toBe(false);
  });

  it('non-canonical: h=0 → false', () => {
    expect(isStructureRectInLot({ x: 2, y: 3, w: 4, h: 0 }, lot, 'N')).toBe(false);
  });

  it('non-canonical: negative x → false', () => {
    expect(isStructureRectInLot({ x: -1, y: 3, w: 4, h: 1 }, lot, 'N')).toBe(false);
  });

  it('wrong-edge pin: sr pinned to S edge when frontage=N → false', () => {
    // sr.y + sr.h === lot.y + lot.h but frontage=N requires sr.y === lot.y
    expect(isStructureRectInLot({ x: 2, y: 6, w: 4, h: 1 }, lot, 'N')).toBe(false);
  });
});
