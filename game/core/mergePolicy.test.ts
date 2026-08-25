import { describe, it, expect } from 'vitest';
import { canMerge, mergedBuildingShape, MERGE_LEVEL_THRESHOLD } from './mergePolicy';
import type { Building } from './Building';
import type { Frontage, Rect } from './buildingFootprint';
import { isStructureRectInLot, lotBboxOf } from './buildingFootprint';
import { buildingCapacity } from './buildingCapacity';
import { maxDensityForLot } from './zoneGrowth';

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

  // Each of the next three cases starts from an accepted baseline pair and mutates only the
  // property the new gate checks, asserting the baseline itself still accepts alongside the
  // mutated reject — so the rejection is attributable to the new gate and not some other one.

  it('reject: unequal level (2 vs 3)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true); // baseline: equal level accepts

    const bUnequalLevel = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 3, age: 100 });
    expect(canMerge(a, bUnequalLevel, HIGH_DEMAND)).toBe(false);
  });

  it('reject: unequal density (0 vs 1)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, density: 0, age: 100 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, density: 0, age: 100 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true); // baseline: equal density accepts

    const bUnequalDensity = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, density: 1, age: 100 });
    expect(canMerge(a, bUnequalDensity, HIGH_DEMAND)).toBe(false);
  });

  it('reject: unequal structureRect depth (1x2 vs 1x3 on equal 1x4 lots, both frontage-pinned)', () => {
    // Both srs are south-pinned (sr.y + sr.h === lot.y + lot.h) and full-width — states
    // isStructureRectInLot accepts — so this exercises the new dimension-equality gate alone,
    // not an unreachable structureRect.
    const a = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100,
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    const b = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100,
      structureRect: { x: 1, y: 2, w: 1, h: 2 },
    });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true); // baseline: equal sr dims accepts

    const bUnequalSrDepth = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: 2, age: 100,
      structureRect: { x: 1, y: 1, w: 1, h: 3 },
    });
    expect(canMerge(a, bUnequalSrDepth, HIGH_DEMAND)).toBe(false);
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
    // Pins mergedBuildingShape's union geometry in isolation. canMerge no longer admits an
    // unequal-sr pair (gate 9), so this input cannot arise through the merge branch — the
    // union rule still has to be right for the equal-sr pairs that do.
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

describe('canMerge — merge conservation invariant', () => {
  // Builds an accepted pair for one matrix entry. Lot depth is fixed at 4 (large enough to
  // host either sr depth) so the sr-depth variable is genuinely independent of lot depth,
  // not a restatement of the pre-existing equal-lot-depth geometry gate. Widths are equal
  // between a and b (the only way to satisfy the new equal-sr-dimensions gate, since
  // isStructureRectInLot forces sr's width-axis span to equal the lot's), and lots sit
  // side-by-side along the width axis with matching frontage edges — states the pre-existing
  // geometry gates already require.
  const LOT_DEPTH = 4;

  function buildPair(
    frontage: Frontage,
    width: 1 | 2,
    srDepth: 2 | 4,
    level: number,
    density: 0 | 1 | 2,
    idBase: number,
  ): { a: Building; b: Building } {
    const isNS = frontage === 'N' || frontage === 'S';

    // Lot A at the origin, lot B immediately adjacent along the width axis.
    const lotA: Rect = isNS
      ? { x: 0, y: 0, w: width, h: LOT_DEPTH }
      : { x: 0, y: 0, w: LOT_DEPTH, h: width };
    const lotB: Rect = isNS
      ? { x: width, y: 0, w: width, h: LOT_DEPTH }
      : { x: 0, y: width, w: LOT_DEPTH, h: width };

    // structureRect pinned to the frontage edge, spanning the lot's full width axis, at the
    // requested depth on the depth axis.
    function srFor(lot: Rect): Rect {
      switch (frontage) {
        case 'N': return { x: lot.x, y: lot.y, w: lot.w, h: srDepth };
        case 'S': return { x: lot.x, y: lot.y + lot.h - srDepth, w: lot.w, h: srDepth };
        case 'W': return { x: lot.x, y: lot.y, w: srDepth, h: lot.h };
        case 'E': return { x: lot.x + lot.w - srDepth, y: lot.y, w: srDepth, h: lot.h };
      }
    }

    const a = makeBuilding({
      id: idBase, lot: lotA, frontage, level, density, age: 100, structureRect: srFor(lotA),
    });
    const b = makeBuilding({
      id: idBase + 1, lot: lotB, frontage, level, density, age: 100, structureRect: srFor(lotB),
    });
    return { a, b };
  }

  it('conserves capacity across every accepted pair in the matrix', () => {
    const frontages: Frontage[] = ['N', 'S', 'W', 'E'];
    const widths: Array<1 | 2> = [1, 2];
    const srDepths: Array<2 | 4> = [2, 4];
    const levels = [2, 3, 4, 5];
    const densities: Array<0 | 1 | 2> = [0, 1, 2];

    let entryCount = 0;
    let idBase = 0;
    for (const frontage of frontages) {
      for (const width of widths) {
        for (const srDepth of srDepths) {
          for (const level of levels) {
            for (const density of densities) {
              const label = `frontage=${frontage} width=${width} srDepth=${srDepth} level=${level} density=${density}`;
              const { a, b } = buildPair(frontage, width, srDepth, level, density, idBase);
              idBase += 2;
              entryCount += 1;

              // The matrix must only contain states isStructureRectInLot actually accepts —
              // otherwise a rejection here could masquerade as passing the invariant below.
              expect(isStructureRectInLot(a.structureRect, lotBboxOf(a.footprint), a.frontage), label).toBe(true);
              expect(isStructureRectInLot(b.structureRect, lotBboxOf(b.footprint), b.frontage), label).toBe(true);

              // Acceptance first: an entry rejected by an unrelated gate must fail loudly here
              // rather than skip the arithmetic assertion and pass vacuously.
              expect(canMerge(a, b, HIGH_DEMAND), label).toBe(true);

              const merged: Building = { ...mergedBuildingShape(a, b), id: idBase };
              idBase += 1;
              expect(buildingCapacity(merged), label).toBe(buildingCapacity(a) + buildingCapacity(b));

              // The merged lot is strictly wider than either input along the frontage axis, so its
              // density cap never falls below the pair's shared tier — even a grandfathered
              // width-1 + width-1 density-2 pair lands inside the 2-wide cap.
              expect(merged.density, label).toBeLessThanOrEqual(
                maxDensityForLot(lotBboxOf(merged.footprint), frontage),
              );
            }
          }
        }
      }
    }

    // 4 frontages * 2 widths * 2 sr depths * 4 levels * 3 densities.
    expect(entryCount).toBe(4 * 2 * 2 * 4 * 3);
  });
});
