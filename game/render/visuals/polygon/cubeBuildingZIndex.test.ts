import { describe, it, expect } from 'vitest';
import { computeZIndex } from './cubeBuildingZIndex';

describe('computeZIndex', () => {
  it('returns 0 for an empty footprint', () => {
    expect(computeZIndex([])).toBe(0);
  });

  it('returns the correct value for a single cell', () => {
    // depth = 2+3 = 5, tiebreakY = 3 → 5*1000 + 3 = 5003
    expect(computeZIndex([{ x: 2, y: 3 }])).toBe(5003);
  });

  it('returns the SE-corner value for a 4×2 NW-anchored footprint', () => {
    // Footprint: x in [0..3], y in [0..1]. SE corner = {x:3, y:1}.
    // depth = 3+1 = 4, tiebreakY = 1 → 4*1000 + 1 = 4001
    const footprint = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
    ];
    expect(computeZIndex(footprint)).toBe(4001);
  });
});
