import { describe, it, expect } from 'vitest';
import { canMerge, mergedBuildingShape } from './mergePolicy';
import type { Building } from './Building';
import type { Frontage, Rect } from './buildingFootprint';
import { isStructureRectInLot, lotBboxOf } from './buildingFootprint';
import { buildingCapacity, DENSITY_CAPACITY_UNITS } from './buildingCapacity';
import { MIGRATION_PRESSURE, WORKPLACE_PRESSURE } from './Demand';
import { ZONE_MAX_LEVEL } from './growthConstants';
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
    // Defaults describe a BUILT-OUT parcel — max level, at the lot's own density cap, and a
    // structure filling the lot (so it can never extend) — because that is canMerge's
    // precondition. Each test then mutates only the property its gate checks. The density
    // default is the LITERAL cap of a 1-wide lot, the shape most fixtures use; wider fixtures
    // pass their own literal (2). Deriving it from maxDensityForLot would make every acceptance
    // here structurally incapable of failing the very gate that calls that function.
    level: opts.level ?? ZONE_MAX_LEVEL,
    density: opts.density ?? 1,
    age: opts.age ?? 100,
    abandoned: false,
    frontage: opts.frontage ?? 'S',
    structureRect: opts.structureRect ?? { x: opts.lot.x, y: opts.lot.y, w: opts.lot.w, h: opts.lot.h },
  };
}

const HIGH_DEMAND = { residential: 0.7, commercial: 0.7, industrial: 0.7 };
const ZERO_DEMAND = { residential: 0, commercial: 0, industrial: 0 };
// What a balanced city reads from external pressure alone — the lowest non-zero demand the
// model produces.
const FLOOR_DEMAND = {
  residential: MIGRATION_PRESSURE,
  commercial: WORKPLACE_PRESSURE,
  industrial: WORKPLACE_PRESSURE,
};

describe('canMerge', () => {
  it('happy path: two adjacent 1x4 lots with frontage S', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true);
  });

  it('symmetry: canMerge(a, b) === canMerge(b, a)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(canMerge(b, a, HIGH_DEMAND));
  });

  it('reject: same building (a.id === b.id)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, a, HIGH_DEMAND)).toBe(false);
  });

  it('reject: different types', () => {
    const a = makeBuilding({ id: 0, type: 'residential', lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, type: 'commercial', lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: different frontages', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'N' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: either side below ZONE_MAX_LEVEL', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true); // baseline: both built out at max level

    const aBelowMax = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', level: ZONE_MAX_LEVEL - 1,
    });
    expect(canMerge(aBelowMax, b, HIGH_DEMAND)).toBe(false);

    const bBelowMax = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', level: ZONE_MAX_LEVEL - 1,
    });
    expect(canMerge(a, bBelowMax, HIGH_DEMAND)).toBe(false);
  });

  it('reject: zero demand', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, ZERO_DEMAND)).toBe(false);
  });

  it('accepts a built-out pair on the external demand floor alone', () => {
    // The design point of the built-out gate: parcels that have exhausted level-up, density
    // and structure growth consolidate on migration/workplace pressure alone, without waiting
    // for a demand spike that a balanced city never shows.
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, FLOOR_DEMAND)).toBe(true);
  });

  it('reject: A.age below cooldown', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', age: 0 });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: lots not adjacent (gap of 1 tile)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 2, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: frontage edges not aligned (S frontage, different back row y)', () => {
    // A: y=0..3 (h=4), B: y=2..5 (h=4). S frontage means bottom edge = y+h-1.
    // A bottom = 3, B bottom = 5 — not aligned.
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 2, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject: mismatched lot depth (A 1x4, B 1x3, X-adjacent, frontage S)', () => {
    // Both srs are 1x2 — equal depth, south-pinned, at the depth cap of 2 and so
    // unextendable — and both lots are 1 wide at density 1. Frontage edges line up at y=4 and the
    // lots are X-adjacent, so lot depth (4 vs 3) is the only thing left to reject on. The
    // default full-lot structureRects would instead trip the equal-sr-depth gate first, since a
    // full-lot sr on a 4-deep lot is 4 deep and on a 3-deep lot only 3.
    const a = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    const baselineB = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 1, y: 2, w: 1, h: 2 },
    });
    expect(canMerge(a, baselineB, HIGH_DEMAND)).toBe(true); // baseline: equal lot depth accepts

    const shallowB = makeBuilding({
      id: 1, lot: { x: 1, y: 1, w: 1, h: 3 }, frontage: 'S',
      structureRect: { x: 1, y: 2, w: 1, h: 2 },
    });
    expect(canMerge(a, shallowB, HIGH_DEMAND)).toBe(false);
  });

  it('reject (CRITICAL): merged lot would exceed 4-wide (3+3=6 on N/S frontage)', () => {
    // Equal widths on both sides, so every built-out and equal-sr-depth gate passes and the
    // merged-size cap is the only one left — pinned by the 2+2 pair that lands exactly on 4.
    const okA = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 2, h: 4 }, frontage: 'S', density: 2 });
    const okB = makeBuilding({ id: 1, lot: { x: 2, y: 0, w: 2, h: 4 }, frontage: 'S', density: 2 });
    expect(canMerge(okA, okB, HIGH_DEMAND)).toBe(true); // baseline: 2+2 = 4, at the cap

    const a = makeBuilding({ id: 2, lot: { x: 0, y: 0, w: 3, h: 4 }, frontage: 'S', density: 2 });
    const b = makeBuilding({ id: 3, lot: { x: 3, y: 0, w: 3, h: 4 }, frontage: 'S', density: 2 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  it('reject (CRITICAL): merged lot would exceed 4-tall (3+3=6 on W/E frontage)', () => {
    const okA = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 4, h: 2 }, frontage: 'W', density: 2 });
    const okB = makeBuilding({ id: 1, lot: { x: 0, y: 2, w: 4, h: 2 }, frontage: 'W', density: 2 });
    expect(canMerge(okA, okB, HIGH_DEMAND)).toBe(true); // baseline: 2+2 = 4, at the cap

    const a = makeBuilding({ id: 2, lot: { x: 0, y: 0, w: 4, h: 3 }, frontage: 'W', density: 2 });
    const b = makeBuilding({ id: 3, lot: { x: 0, y: 3, w: 4, h: 3 }, frontage: 'W', density: 2 });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(false);
  });

  // Each of the next four cases starts from an accepted baseline pair and mutates only the
  // property the gate under test checks, asserting the baseline itself still accepts alongside
  // the mutated reject — so the rejection is attributable to that gate and not some other one.

  it('reject: a side below its own lot-width density cap (tier 0 on a width-1 lot, cap 1)', () => {
    const a = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S' });
    const b = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S' });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true); // baseline: both at maxDensityForLot = 1

    const bBelowCap = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', density: 0,
    });
    expect(canMerge(a, bBelowCap, HIGH_DEMAND)).toBe(false);
  });

  it('reject: a structure that can still extend (sr depth 1 on a 1x4 lot, depth cap 2)', () => {
    // Both srs move together: an sr-depth-2 vs sr-depth-1 pair would trip the equal-sr-depth
    // gate first, so only a matched shrink isolates the extendability gate.
    const a = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    const b = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 1, y: 2, w: 1, h: 2 },
    });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true); // baseline: depth 2 == cap, cannot extend

    const aShallow = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 0, y: 3, w: 1, h: 1 },
    });
    const bShallow = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 1, y: 3, w: 1, h: 1 },
    });
    expect(canMerge(aShallow, bShallow, HIGH_DEMAND)).toBe(false);
  });

  it('accepts a mixed-width pair (width-1 beside width-2, each built out at its own cap)', () => {
    // The width axis is free: the two sides sit at DIFFERENT density caps (1 for a 1-wide lot,
    // 2 for a 2-wide one), each built out on its own terms, and their srs differ on the width
    // axis (1 vs 2) but share a depth of 4. Under the old equal-dimensions gate this pair was
    // rejected, which is what made width 3 unreachable and stranded odd runs of narrow lots.
    const narrow = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', density: 1 });
    const wide = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 2, h: 4 }, frontage: 'S', density: 2 });

    // Each side still merges happily with its own width...
    const narrowTwin = makeBuilding({ id: 2, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', density: 1 });
    const wideTwin = makeBuilding({ id: 3, lot: { x: 3, y: 0, w: 2, h: 4 }, frontage: 'S', density: 2 });
    expect(canMerge(narrow, narrowTwin, HIGH_DEMAND)).toBe(true);
    expect(canMerge(wide, wideTwin, HIGH_DEMAND)).toBe(true);

    // ...and now with each other, assembling the width-3 lot the doubling-only gate could
    // never produce.
    expect(canMerge(narrow, wide, HIGH_DEMAND)).toBe(true);

    const merged: Building = { ...mergedBuildingShape(narrow, wide), id: 4 };
    expect(lotBboxOf(merged.footprint)).toEqual({ x: 0, y: 0, w: 3, h: 4 });
    expect(merged.structureRect).toEqual({ x: 0, y: 0, w: 3, h: 4 });
    expect(merged.anchor).toEqual({ x: 0, y: 0 }); // union NW
    expect(merged.level).toBe(ZONE_MAX_LEVEL);
    expect(merged.density).toBe(2); // narrow side upgraded to the assembled lot's tier

    // Capacity: the narrow side's 4 structure tiles are revalued from tier 1 to tier 2, so the
    // merge GAINS. 1*4*5*7 = 140 and 2*4*5*10 = 400 in; 3*4*5*10 = 600 out.
    expect(buildingCapacity(narrow)).toBe(1 * 4 * ZONE_MAX_LEVEL * DENSITY_CAPACITY_UNITS[1]); // 140
    expect(buildingCapacity(wide)).toBe(2 * 4 * ZONE_MAX_LEVEL * DENSITY_CAPACITY_UNITS[2]); // 400
    expect(buildingCapacity(merged)).toBe(3 * 4 * ZONE_MAX_LEVEL * DENSITY_CAPACITY_UNITS[2]); // 600
    expect(buildingCapacity(merged) - (buildingCapacity(narrow) + buildingCapacity(wide)))
      .toBe(1 * 4 * ZONE_MAX_LEVEL * (DENSITY_CAPACITY_UNITS[2] - DENSITY_CAPACITY_UNITS[1])); // 60
  });

  it('reject: unequal structureRect depth (1x2 vs 1x3 on equal 1x4 lots, both frontage-pinned)', () => {
    // Both srs are south-pinned (sr.y + sr.h === lot.y + lot.h) and full-width — states
    // isStructureRectInLot accepts — and both sit at or past the depth cap of 2, so neither can
    // extend. That leaves the equal-sr-depth gate as the only one able to reject.
    const a = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    const b = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 1, y: 2, w: 1, h: 2 },
    });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true); // baseline: equal sr depth accepts

    const bUnequalSrDepth = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 3 },
    });
    expect(canMerge(a, bUnequalSrDepth, HIGH_DEMAND)).toBe(false);
  });

  it('reject: unequal sr depth on a MIXED-width pair (widths 1 + 2, sr depths 2 vs 4)', () => {
    // Freeing the width axis must not free the depth axis with it. Baseline: a 1-wide and a
    // 2-wide lot, both 4 deep, both srs 2 deep — the shared depth cap of a 1- and a 2-wide lot
    // (max(MIN_STRUCTURE_DEPTH_CAP = 2, lot width)) — so neither side can extend.
    const narrow = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', density: 1,
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    const wide = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 2, h: 4 }, frontage: 'S', density: 2,
      structureRect: { x: 1, y: 2, w: 2, h: 2 },
    });
    expect(canMerge(narrow, wide, HIGH_DEMAND)).toBe(true); // baseline: sr depth 2 on both

    // Only the wide side's sr depth moves, to 4: still south-pinned and spanning the lot's full
    // width, and now filling the lot's depth, so it still cannot extend.
    const wideDeep = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 2, h: 4 }, frontage: 'S', density: 2,
      structureRect: { x: 1, y: 0, w: 2, h: 4 },
    });
    expect(isStructureRectInLot(wideDeep.structureRect, lotBboxOf(wideDeep.footprint), 'S')).toBe(true);
    expect(canMerge(narrow, wideDeep, HIGH_DEMAND)).toBe(false);
  });

  it('reject: mixed widths summing past the 4-wide lot cap (2 + 3 = 5)', () => {
    // An over-cap pair the freed width axis newly makes reachable, smallest by wider side (1 + 4
    // also sums to 5, with a 4-wide side already at the lot cap). Baseline 1 + 3
    // lands exactly on the cap: 2-deep lots whose default srs fill them, so no side can extend
    // and every gate but the cap is open.
    const narrow = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 2 }, frontage: 'S', density: 1 });
    const wide = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 3, h: 2 }, frontage: 'S', density: 2 });
    expect(canMerge(narrow, wide, HIGH_DEMAND)).toBe(true); // baseline: mergedW = 4, at the cap

    // Widen the narrow side to 2 (the wide lot slides one tile east to stay edge-adjacent —
    // identical depth, alignment and adjacency). Its density literal moves to 2 with the width
    // because gate 8 keys the tier on lot width; the merged width is the only thing under test.
    const twoWide = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 2, h: 2 }, frontage: 'S', density: 2 });
    const wideShifted = makeBuilding({ id: 1, lot: { x: 2, y: 0, w: 3, h: 2 }, frontage: 'S', density: 2 });
    expect(canMerge(twoWide, wideShifted, HIGH_DEMAND)).toBe(false); // mergedW = 5
  });

  it('reject (documented gap): naturally-grown cap depths differ across widths (2 vs 3)', () => {
    // A 1-wide lot's structure stops growing at depth MIN_STRUCTURE_DEPTH_CAP = 2; a 3-wide
    // lot's stops at 3 (max(2, lot width)). On lots deeper than 2, those two GROWN states have
    // different sr depths, so the depth gate rejects the pair even though the widths would fit
    // (1 + 3 = 4). That is a real gap in what the freed width axis can assemble, not a defect of
    // the gate: the gate accepts deep unequal-width pairs whose depths do match — see the
    // (1, 3) lot-depth-4 entries in the unequal-width matrix below.
    //
    // The baseline's 3-deep narrow sr is hand-built past the 1-wide lot's growth cap (still a
    // state isStructureRectInLot and canExtendStructure accept) purely to isolate the gate.
    const narrowDeep = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', density: 1,
      structureRect: { x: 0, y: 1, w: 1, h: 3 },
    });
    const wideGrown = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 3, h: 4 }, frontage: 'S', density: 2,
      structureRect: { x: 1, y: 1, w: 3, h: 3 },
    });
    expect(canMerge(narrowDeep, wideGrown, HIGH_DEMAND)).toBe(true); // baseline: sr depth 3 on both

    const narrowAtItsCap = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', density: 1,
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    expect(isStructureRectInLot(narrowAtItsCap.structureRect, lotBboxOf(narrowAtItsCap.footprint), 'S')).toBe(true);
    expect(canMerge(narrowAtItsCap, wideGrown, HIGH_DEMAND)).toBe(false);
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
    // Pins mergedBuildingShape's union geometry in isolation. canMerge still cannot admit an
    // unequal-DEPTH pair (the equal-sr-depth gate), so this input cannot arise through the merge
    // branch — the union rule still has to be right for the equal-depth pairs that do.
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

// Built-out density tier per lot width along the frontage axis, as a literal table rather than
// read back from maxDensityForLot — the function gate 8 checks against must not also define the
// fixture it checks.
const BUILT_OUT_DENSITY: Readonly<Record<1 | 2 | 3, 1 | 2>> = { 1: 1, 2: 2, 3: 2 };

/**
 * One accepted matrix pair, shared by both conservation matrices below so the frontage-pinning
 * geometry every gate reads lives in exactly one place. Two lots side-by-side along the width
 * axis with matching frontage edges, each at ZONE_MAX_LEVEL, at its own width's built-out tier,
 * with a frontage-edge-pinned structureRect spanning its lot's full width axis. The two widths
 * may differ (the shape gate compares DEPTH only); lot depth and sr depth are necessarily shared,
 * the first by the equal-lot-depth geometry gate and the second by the shape gate itself.
 */
function buildPair(opts: {
  frontage: Frontage;
  widthA: 1 | 2 | 3;
  widthB: 1 | 2 | 3;
  lotDepth: 2 | 4;
  srDepth: 2 | 4;
  idBase: number;
}): { a: Building; b: Building } {
  const { frontage, widthA, widthB, lotDepth, srDepth, idBase } = opts;
  const isNS = frontage === 'N' || frontage === 'S';

  // Lot A at the origin, lot B immediately adjacent along the width axis.
  const lotA: Rect = isNS
    ? { x: 0, y: 0, w: widthA, h: lotDepth }
    : { x: 0, y: 0, w: lotDepth, h: widthA };
  const lotB: Rect = isNS
    ? { x: widthA, y: 0, w: widthB, h: lotDepth }
    : { x: 0, y: widthA, w: lotDepth, h: widthB };

  // structureRect pinned to the frontage edge, spanning the lot's full width axis, at the
  // requested depth on the depth axis (h for N/S, w for W/E).
  function srFor(lot: Rect): Rect {
    switch (frontage) {
      case 'N': return { x: lot.x, y: lot.y, w: lot.w, h: srDepth };
      case 'S': return { x: lot.x, y: lot.y + lot.h - srDepth, w: lot.w, h: srDepth };
      case 'W': return { x: lot.x, y: lot.y, w: srDepth, h: lot.h };
      case 'E': return { x: lot.x + lot.w - srDepth, y: lot.y, w: srDepth, h: lot.h };
    }
  }

  const a = makeBuilding({
    id: idBase, lot: lotA, frontage, density: BUILT_OUT_DENSITY[widthA], structureRect: srFor(lotA),
  });
  const b = makeBuilding({
    id: idBase + 1, lot: lotB, frontage, density: BUILT_OUT_DENSITY[widthB], structureRect: srFor(lotB),
  });
  return { a, b };
}

describe('canMerge — merge conservation invariant', () => {
  // Lot depth is fixed at 4 (large enough to host either sr depth) so the sr-depth variable is
  // genuinely independent of lot depth, not a restatement of the pre-existing equal-lot-depth
  // geometry gate. Widths are equal between a and b — no longer forced by the shape gate, which
  // now only compares sr DEPTH, so these 16 entries pin the equal-density corollary of that
  // case: EXACT conservation. The unequal-width case, where the merge revalues the narrow side
  // at the wider lot's tier, is covered by the block below. Level and density are not matrix
  // axes: the built-out gate accepts exactly one level (ZONE_MAX_LEVEL, makeBuilding's default)
  // and exactly one density per lot width (buildPair's BUILT_OUT_DENSITY table).
  const LOT_DEPTH = 4;

  it('conserves capacity across every accepted pair in the matrix', () => {
    const frontages: Frontage[] = ['N', 'S', 'W', 'E'];
    const widths: Array<1 | 2> = [1, 2];
    const srDepths: Array<2 | 4> = [2, 4];

    let entryCount = 0;
    let idBase = 0;
    for (const frontage of frontages) {
      for (const width of widths) {
        for (const srDepth of srDepths) {
          const label =
            `frontage=${frontage} width=${width} density=${BUILT_OUT_DENSITY[width]} srDepth=${srDepth}`;
          const { a, b } = buildPair({
            frontage, widthA: width, widthB: width, lotDepth: LOT_DEPTH, srDepth, idBase,
          });
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
          // density cap never falls below the pair's shared tier.
          expect(merged.density, label).toBeLessThanOrEqual(
            maxDensityForLot(lotBboxOf(merged.footprint), frontage),
          );
        }
      }
    }

    // 4 frontages * 2 widths * 2 sr depths.
    expect(entryCount).toBe(4 * 2 * 2);
  });
});

describe('canMerge — unequal-width merge capacity', () => {
  // Same builder as the equal-width matrix, with the two sides' frontage-axis WIDTHS now
  // differing — the shape gate compares sr depth only. Side A is the narrow (1-wide, tier-1)
  // side in every entry, side B the wider tier-2 one, so `srArea(a)` below is the narrow side's
  // area. Lot depth and sr depth stay shared, as the two gates that read them require.
  //
  // Every srDepth-4 entry is hand-built on BOTH sides: 4 exceeds the growth cap of a 1-, 2- and
  // 3-wide lot alike (max(MIN_STRUCTURE_DEPTH_CAP = 2, lot width)), so those structures fill
  // their 4-deep lot without growth ever putting them there. They are still states
  // isStructureRectInLot and save load accept, and canExtendStructure still refuses to extend
  // them — the same hand-built class the equal-width matrix's own srDepth-4 entries use. The
  // growth-reachable rows are srDepth 2 on the 4-deep (1, 2) pair and the 2-deep (1, 3) pair.
  // Kept deliberately: this table is the GATE-level counterpart to World.merge.test.ts's
  // deep-lot test, which drives the one growth-REACHABLE deep case (1 + 2 -> 3-wide, then 3×3)
  // through the real World.tick — the simulation covers what growth can build, these entries
  // cover what the gate accepts at any lot depth, which is the claim docs/architecture.md makes.
  const ENTRIES: ReadonlyArray<{
    widthA: 1;
    widthB: 2 | 3;
    lotDepth: 2 | 4;
    srDepth: 2 | 4;
  }> = [
    // Width pair (1, 2) on 4-deep lots, at both non-extendable sr depths: 2 is the shared depth
    // cap of a 1- and a 2-wide lot, 4 fills the lot.
    { widthA: 1, widthB: 2, lotDepth: 4, srDepth: 2 },
    { widthA: 1, widthB: 2, lotDepth: 4, srDepth: 4 },
    // Width pair (1, 3) — the width-4 assembly the old doubling-only gate could never produce.
    // Shallow, naturally-grown case: 2-deep lots whose structures fill them.
    { widthA: 1, widthB: 3, lotDepth: 2, srDepth: 2 },
    // Same pair on 4-deep lots, pinning that the gate accepts equal depth at ANY lot depth.
    { widthA: 1, widthB: 3, lotDepth: 4, srDepth: 4 },
  ];

  const srArea = (b: Building) => b.structureRect.w * b.structureRect.h;
  const cellKeys = (cells: ReadonlyArray<{ x: number; y: number }>) =>
    cells.map((c) => `${c.x},${c.y}`).sort();

  it('gains exactly the narrow side revalued at tier 2, across every accepted unequal-width pair', () => {
    const frontages: Frontage[] = ['N', 'S', 'W', 'E'];

    let entryCount = 0;
    let idBase = 0;
    for (const frontage of frontages) {
      for (const entry of ENTRIES) {
        const label =
          `frontage=${frontage} widths=${entry.widthA}+${entry.widthB} ` +
          `lotDepth=${entry.lotDepth} srDepth=${entry.srDepth}`;
        const { a, b } = buildPair({ frontage, ...entry, idBase });
        idBase += 2;
        entryCount += 1;

        // Only states isStructureRectInLot accepts, or addBuilding semantics do not apply and
        // the entry pins nothing.
        expect(isStructureRectInLot(a.structureRect, lotBboxOf(a.footprint), frontage), label).toBe(true);
        expect(isStructureRectInLot(b.structureRect, lotBboxOf(b.footprint), frontage), label).toBe(true);

        // Acceptance first: an entry rejected by an unrelated gate must fail loudly here rather
        // than skip the arithmetic below and pass vacuously.
        expect(canMerge(a, b, HIGH_DEMAND), label).toBe(true);

        const merged: Building = { ...mergedBuildingShape(a, b), id: idBase };
        idBase += 1;

        // The merged structure is the exact union of the two inputs, valued at tier 2 throughout.
        expect(buildingCapacity(merged), label).toBe(
          (srArea(a) + srArea(b)) * ZONE_MAX_LEVEL * DENSITY_CAPACITY_UNITS[2],
        );
        // So the gain over the inputs is precisely side A's area moved from tier 1 to tier 2.
        expect(buildingCapacity(merged) - (buildingCapacity(a) + buildingCapacity(b)), label).toBe(
          srArea(a) * ZONE_MAX_LEVEL * (DENSITY_CAPACITY_UNITS[2] - DENSITY_CAPACITY_UNITS[1]),
        );
        // Restates the exact equality above as the sign the mechanic is judged on. What keeps
        // it from being vacuous is the ENTRIES table pairing a 1-wide side with a wider one, so
        // BUILT_OUT_DENSITY hands every entry two different tiers.
        expect(buildingCapacity(merged), label).toBeGreaterThan(
          buildingCapacity(a) + buildingCapacity(b),
        );

        // No holes anywhere in the result of the gate walk: the merged lot is the exact cell
        // union of the two inputs (not one cell more), ...
        expect(cellKeys(merged.footprint), label).toEqual(cellKeys([...a.footprint, ...b.footprint]));
        // ...the merged structure is a legal structureRect for that lot, ...
        const mergedLot = lotBboxOf(merged.footprint);
        expect(isStructureRectInLot(merged.structureRect, mergedLot, frontage), label).toBe(true);
        // ...and its tier is within the assembled lot's own cap.
        expect(merged.density, label).toBeLessThanOrEqual(maxDensityForLot(mergedLot, frontage));
      }
    }

    // 4 frontages * 4 width/depth entries.
    expect(entryCount).toBe(4 * 4);
  });
});
