import { describe, it, expect } from 'vitest';
import { buildingCapacity, DENSITY_CAPACITY_UNITS } from './buildingCapacity';
import { POPULATION_PER_LEVEL, POPULATION_PER_TILE_LEVEL } from './growthConstants';
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

  it('density tiers are real multipliers: modal (1x2 sr) level-5 reads 50 / 70 / 100', () => {
    const d0 = buildingCapacity(makeBuilding({ level: 5, density: 0, structureRect: { w: 1, h: 2 } }));
    const d1 = buildingCapacity(makeBuilding({ level: 5, density: 1, structureRect: { w: 1, h: 2 } }));
    const d2 = buildingCapacity(makeBuilding({ level: 5, density: 2, structureRect: { w: 1, h: 2 } }));
    expect(d0).toBe(50); // 1*2*5*5
    expect(d1).toBe(70); // 1*2*5*7
    expect(d2).toBe(100); // 1*2*5*10
  });

  it('density tiers are real multipliers: ribbon (1x1 sr) level-5 reads 25 / 35 / 50', () => {
    const d0 = buildingCapacity(makeBuilding({ level: 5, density: 0, structureRect: { w: 1, h: 1 } }));
    const d1 = buildingCapacity(makeBuilding({ level: 5, density: 1, structureRect: { w: 1, h: 1 } }));
    const d2 = buildingCapacity(makeBuilding({ level: 5, density: 2, structureRect: { w: 1, h: 1 } }));
    expect(d0).toBe(25); // 1*1*5*5
    expect(d1).toBe(35); // 1*1*5*7
    expect(d2).toBe(50); // 1*1*5*10
  });

  it('tier 0 and tier 2 relate to the population-unit basis constants', () => {
    expect(DENSITY_CAPACITY_UNITS[0]).toBe(POPULATION_PER_TILE_LEVEL);
    expect(DENSITY_CAPACITY_UNITS[2]).toBe(POPULATION_PER_LEVEL);
  });
});
