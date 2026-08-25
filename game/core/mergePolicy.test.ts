import { describe, it, expect } from 'vitest';
import { canMerge, mergedBuildingShape } from './mergePolicy';
import type { Building } from './Building';
import type { Frontage, Rect } from './buildingFootprint';
import { isStructureRectInLot, lotBboxOf } from './buildingFootprint';
import { buildingCapacity } from './buildingCapacity';
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
    // Both srs are 1x2 — equal dimensions, south-pinned, at the depth cap of 2 and so
    // unextendable — and both lots are 1 wide at density 1. Frontage edges line up at y=4 and the
    // lots are X-adjacent, so lot depth (4 vs 3) is the only thing left to reject on. The
    // default full-lot structureRects would instead trip the equal-sr-dimensions gate first.
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
    // Equal widths on both sides, so every built-out and equal-dimension gate passes and the
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
    // Both srs move together: an sr-depth-2 vs sr-depth-1 pair would trip the equal-dimensions
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

  it('reject: mixed-width pair (width-1 beside width-2, each built out at its own cap)', () => {
    // Premise: the two sides sit at DIFFERENT density caps (1 for a 1-wide lot, 2 for a 2-wide
    // one), so each is built out on its own terms.
    const narrow = makeBuilding({ id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S', density: 1 });
    const wide = makeBuilding({ id: 1, lot: { x: 1, y: 0, w: 2, h: 4 }, frontage: 'S', density: 2 });

    // Each side merges happily with its own width...
    const narrowTwin = makeBuilding({ id: 2, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S', density: 1 });
    const wideTwin = makeBuilding({ id: 3, lot: { x: 3, y: 0, w: 2, h: 4 }, frontage: 'S', density: 2 });
    expect(canMerge(narrow, narrowTwin, HIGH_DEMAND)).toBe(true);
    expect(canMerge(wide, wideTwin, HIGH_DEMAND)).toBe(true);

    // ...but not with each other: their structureRects differ on the width axis (1 vs 2). That
    // rejection is what lets the per-side density cap stand in for an equal-density gate — a
    // pair that clears it always shares a lot width, hence a cap, hence a density tier.
    expect(canMerge(narrow, wide, HIGH_DEMAND)).toBe(false);
  });

  it('reject: unequal structureRect depth (1x2 vs 1x3 on equal 1x4 lots, both frontage-pinned)', () => {
    // Both srs are south-pinned (sr.y + sr.h === lot.y + lot.h) and full-width — states
    // isStructureRectInLot accepts — and both sit at or past the depth cap of 2, so neither can
    // extend. That leaves the dimension-equality gate as the only one able to reject.
    const a = makeBuilding({
      id: 0, lot: { x: 0, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    const b = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S',
      structureRect: { x: 1, y: 2, w: 1, h: 2 },
    });
    expect(canMerge(a, b, HIGH_DEMAND)).toBe(true); // baseline: equal sr dims accepts

    const bUnequalSrDepth = makeBuilding({
      id: 1, lot: { x: 1, y: 0, w: 1, h: 4 }, frontage: 'S',
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
    // unequal-sr pair (the equal-dimensions gate), so this input cannot arise through the merge
    // branch — the union rule still has to be right for the equal-sr pairs that do.
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
  // between a and b (the only way to satisfy the equal-sr-dimensions gate, since
  // isStructureRectInLot forces sr's width-axis span to equal the lot's), and lots sit
  // side-by-side along the width axis with matching frontage edges — states the pre-existing
  // geometry gates already require. Level and density are no longer matrix axes: the built-out
  // gate accepts exactly one level (ZONE_MAX_LEVEL, makeBuilding's default) and exactly one
  // density per lot width, supplied below as a literal table rather than read back from
  // maxDensityForLot — the function gate 8 checks against must not also define the fixture.
  const LOT_DEPTH = 4;

  function buildPair(
    frontage: Frontage,
    width: 1 | 2,
    density: 1 | 2,
    srDepth: 2 | 4,
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

    const a = makeBuilding({ id: idBase, lot: lotA, frontage, density, structureRect: srFor(lotA) });
    const b = makeBuilding({ id: idBase + 1, lot: lotB, frontage, density, structureRect: srFor(lotB) });
    return { a, b };
  }

  it('conserves capacity across every accepted pair in the matrix', () => {
    const frontages: Frontage[] = ['N', 'S', 'W', 'E'];
    // Each lot width paired with the built-out density tier it allows, written out literally.
    const widths: Array<{ width: 1 | 2; density: 1 | 2 }> = [
      { width: 1, density: 1 },
      { width: 2, density: 2 },
    ];
    const srDepths: Array<2 | 4> = [2, 4];

    let entryCount = 0;
    let idBase = 0;
    for (const frontage of frontages) {
      for (const { width, density } of widths) {
        for (const srDepth of srDepths) {
          const label = `frontage=${frontage} width=${width} density=${density} srDepth=${srDepth}`;
          const { a, b } = buildPair(frontage, width, density, srDepth, idBase);
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
