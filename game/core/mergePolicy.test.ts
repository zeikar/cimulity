import { describe, it, expect } from 'vitest';
import { canMerge, mergedBuildingShape, MERGE_LEVEL_THRESHOLD } from './mergePolicy';
import type { Building } from './Building';
import type { Frontage } from './buildingFootprint';

function makeBuilding(opts: {
  id: number;
  type?: 'residential' | 'commercial' | 'industrial';
  frontage?: Frontage;
  lot: { x: number; y: number; w: number; h: number };
  structureRect?: { x: number; y: number; w: number; h: number };
  level?: number;
  density?: 0 | 1 | 2;
  age?: number;
}): Building {
  const cells = [];
  for (let y = opts.lot.y; y < opts.lot.y + opts.lot.h; y++) {
    for (let x = opts.lot.x; x < opts.lot.x + opts.lot.w; x++) {
      cells.push({ x, y });
    }
  }
  return {
    id: opts.id,
    type: opts.type ?? 'residential',
    footprint: cells,
    anchor: { x: opts.lot.x, y: opts.lot.y },
    level: opts.level ?? MERGE_LEVEL_THRESHOLD,
    density: opts.density ?? 0,
    age: opts.age ?? 100,
    abandoned: false,
    frontage: opts.frontage ?? 'S',
    structureRect: opts.structureRect ?? { x: opts.lot.x, y: opts.lot.y, w: opts.lot.w, h: opts.lot.h },
  };
}

const HIGH_DEMAND = { residential: 0.7, commercial: 0.7, industrial: 0.7 };
const LOW_DEMAND = { residential: 0.3, commercial: 0.3, industrial: 0.3 };

describe('canMerge', () => {
  it('happy path: two adjacent 1x4 lots with frontage S', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true);
  });

  it('symmetry: canMerge(a, b) === canMerge(b, a)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(canMerge(b, a, HIGH_DEMAND));
  });

  it('reject: same building (a.id === b.id)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, a, HIGH_DEMAND)).toBe(false);
  });

  it('reject: different types', () => {
    const a = makeBuilding({ id: 0, type: 'residential', lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, type: 'commercial', lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: different frontages', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'N', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: A.level below MERGE_LEVEL_THRESHOLD', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 1, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: B.level below MERGE_LEVEL_THRESHOLD', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 1, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: demand below DENSITY_DEMAND_THRESHOLD', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, LOW_DEMAND)).toBe(false);
  });

  it('reject: A.age below cooldown', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 0 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: lots not adjacent (gap of 1 tile)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 2, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: frontage edges not aligned (S frontage, different back row y)', () => {
    // A: y=0..3 (h=4), B: y=2..5 (h=4). S frontage means bottom edge = y+h-1.
    // A bottom = 3, B bottom = 5 — not aligned.
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 2, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: mismatched lot depth (A 1x4, B 1x3, X-adjacent, frontage S)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 1, w: 1, h: 3 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject (CRITICAL): merged lot would exceed 4-wide (2+3=5 on N/S frontage)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 2, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 2, y: 0, w: 3, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject (CRITICAL): merged lot would exceed 4-tall (2+3=5 on W/E frontage)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 4, h: 2 }, frontage: 'W', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 0, y: 2, w: 4, h: 3 }, frontage: 'W', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });
});

describe('mergedBuildingShape', () => {
  it('happy path: merges two 1x4 lots into a 2x4 building', () => {
    const a = makeBuilding({
      id: 0,
      lot: { x: 0, y: 0, w: 1, h: 4 },
      frontage: 'S',
      level: 2,
      age: 100,
      structureRect: { x: 0, y: 0, w: 1, h: 4 },
    });
    const b = makeBuilding({
      id: 1,
      lot: { x: 1, y: 0, w: 1, h: 4 },
      frontage: 'S',
      level: 2,
      age: 100,
      structureRect: { x: 1, y: 0, w: 1, h: 4 },
    });
    const result = mergedBuildingShape(a, b);
    expect(result.type).toBe('residential');
    expect(result.level).toBe(2);
    expect(result.age).toBe(0);
    expect(result.frontage).toBe('S');
    expect(result.anchor).toEqual({ x: 0, y: 0 });
    expect(result.footprint).toHaveLength(8); // 2x4
    expect(result.structureRect).toEqual({ x: 0, y: 0, w: 2, h: 4 });
  });

  it('unequal structures, equal lot depth: merged structureRect uses union of rects', () => {
    // A: 1x4 lot, structureRect = {x:0, y:2, w:1, h:2} (south end, 2 deep)
    // B: 1x4 lot at x=1, structureRect = {x:1, y:1, w:1, h:3} (south end, 3 deep)
    // Union: {x:0, y:1, w:2, h:3}
    const a = makeBuilding({
      id: 0,
      lot: { x: 0, y: 0, w: 1, h: 4 },
      frontage: 'S',
      level: 2,
      age: 100,
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    const b = makeBuilding({
      id: 1,
      lot: { x: 1, y: 0, w: 1, h: 4 },
      frontage: 'S',
      level: 2,
      age: 100,
      structureRect: { x: 1, y: 1, w: 1, h: 3 },
    });
    const result = mergedBuildingShape(a, b);
    expect(result.structureRect).toEqual({ x: 0, y: 1, w: 2, h: 3 });
    expect(result.anchor).toEqual({ x: 0, y: 0 });
    expect(result.footprint).toHaveLength(8); // 2x4 lot
  });

  it('1x1 lots (edge case): merges into 2x1 building', () => {
    const a = makeBuilding({
      id: 0,
      lot: { x: 0, y: 0, w: 1, h: 1 },
      frontage: 'S',
      level: 2,
      age: 100,
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    const b = makeBuilding({
      id: 1,
      lot: { x: 1, y: 0, w: 1, h: 1 },
      frontage: 'S',
      level: 2,
      age: 100,
      structureRect: { x: 1, y: 0, w: 1, h: 1 },
    });
    const result = mergedBuildingShape(a, b);
    expect(result.anchor).toEqual({ x: 0, y: 0 });
    expect(result.footprint).toHaveLength(2); // 2x1
    expect(result.structureRect).toEqual({ x: 0, y: 0, w: 2, h: 1 });
    expect(result.level).toBe(2);
  });
});
