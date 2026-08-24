import { describe, it, expect } from 'vitest';
import { buildingCapacity, DENSITY_CAPACITY_UNITS } from './buildingCapacity';
import { POPULATION_PER_LEVEL } from './growthConstants';
import type { Building } from './Building';

function makeBuilding(opts: {
  level: number;
  density?: 0 | 1 | 2;
  structureRect: { w: number; h: number };
  abandoned?: boolean;
}): Building {
  return {
    id: 0,
    type: 'residential',
    footprint: [{ x: 0, y: 0 }],
    anchor: { x: 0, y: 0 },
    level: opts.level,
    density: opts.density ?? 0,
    age: 0,
    abandoned: opts.abandoned ?? false,
    frontage: 'S',
    structureRect: { x: 0, y: 0, w: opts.structureRect.w, h: opts.structureRect.h },
  };
}

describe('buildingCapacity', () => {
  it('modal building (1x2 sr, density 0) matches level * POPULATION_PER_LEVEL at every level', () => {
    for (let level = 1; level <= 5; level++) {
      const b = makeBuilding({ level, structureRect: { w: 1, h: 2 } });
      expect(buildingCapacity(b)).toBe(level * POPULATION_PER_LEVEL);
    }
  });

  it('scales with structure area: 2x2 sr, level 3 -> 60', () => {
    const b = makeBuilding({ level: 3, structureRect: { w: 2, h: 2 } });
    expect(buildingCapacity(b)).toBe(60);
  });

  it('scales with structure area: 4x4 sr, level 5 -> 400', () => {
    const b = makeBuilding({ level: 5, structureRect: { w: 4, h: 4 } });
    expect(buildingCapacity(b)).toBe(400);
  });

  it('ignores abandoned: an abandoned building reads the same capacity as its occupied twin', () => {
    const occupied = makeBuilding({ level: 4, structureRect: { w: 2, h: 2 }, abandoned: false });
    const abandoned = makeBuilding({ level: 4, structureRect: { w: 2, h: 2 }, abandoned: true });
    expect(buildingCapacity(abandoned)).toBe(buildingCapacity(occupied));
  });

  it('density tiers are currently neutral: density 0/1/2 read identically at fixed area/level', () => {
    const d0 = buildingCapacity(makeBuilding({ level: 5, density: 0, structureRect: { w: 1, h: 2 } }));
    const d1 = buildingCapacity(makeBuilding({ level: 5, density: 1, structureRect: { w: 1, h: 2 } }));
    const d2 = buildingCapacity(makeBuilding({ level: 5, density: 2, structureRect: { w: 1, h: 2 } }));
    expect(d0).toBe(d1);
    expect(d1).toBe(d2);
    expect(DENSITY_CAPACITY_UNITS).toEqual([POPULATION_PER_LEVEL / 2, POPULATION_PER_LEVEL / 2, POPULATION_PER_LEVEL / 2]);
  });
});
