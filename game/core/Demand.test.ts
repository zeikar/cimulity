import { describe, it, expect } from 'vitest';
import {
  Demand,
  DENSITY_DEMAND_THRESHOLD,
  DENSITY_DEMAND_BAR,
  GROWTH_DEMAND_THRESHOLD,
  MIN_MARKET,
  MIGRATION_PRESSURE,
  MIGRATION_UNEMPLOYMENT_CUTOFF,
  WORKPLACE_PRESSURE,
  DEADBAND_RATE,
  SATURATION_RATE,
  COMMERCIAL_JOB_SHARE,
  EMPTY_CITY_DEMAND,
} from './Demand';
import type { DemandVector } from './Demand';
import { POPULATION_PER_LEVEL, POPULATION_PER_TILE_LEVEL } from './growthConstants';
import { BuildingMap } from './Building';
import type { Building } from './Building';

function makeBuildingMap(): BuildingMap {
  return new BuildingMap(20, 20);
}

/**
 * `x` is doubled internally and the building given a modal 2-wide 1-deep footprint/sr
 * (buildingCapacity = 2*level*5 = level*POPULATION_PER_LEVEL, matching every level-keyed
 * expectation in this file exactly). Doubling every caller's `x` uniformly preserves
 * whatever distinctness the original 1-wide `x` values already had, so no caller needs
 * per-call collision bookkeeping.
 */
function addBuilding(
  map: BuildingMap,
  id: number,
  x: number,
  y: number,
  type: Building['type'],
  level: number,
): void {
  const bx = x * 2;
  map.addExistingBuilding({
    id,
    type,
    footprint: [{ x: bx, y }, { x: bx + 1, y }],
    anchor: { x: bx, y },
    level,
    density: 0,
    age: 0,
    abandoned: false,
    frontage: 'S',
    structureRect: { x: bx, y, w: 2, h: 1 },
  });
}

/** Add `count` level-`level` buildings of `type`, laid out one per cell along successive rows. */
function addRun(
  map: BuildingMap,
  startId: number,
  row: number,
  type: Building['type'],
  count: number,
  level: number,
): void {
  for (let i = 0; i < count; i++) addBuilding(map, startId + i, i, row, type, level);
}

type LaborBag = Readonly<{
  employed: number;
  unemployed: number;
  reachableUnfilledJobs: number;
  jobsCapacity: number;
}>;

function levelSums(map: BuildingMap): { r: number; c: number; i: number } {
  let r = 0;
  let c = 0;
  let i = 0;
  for (const b of map.iterBuildings()) {
    if (b.abandoned) continue;
    if (b.type === 'residential') r += b.level;
    else if (b.type === 'commercial') c += b.level;
    else i += b.level;
  }
  return { r, c, i };
}

/**
 * Every labor bag must describe a state the simulation can actually produce — a bag that
 * contradicts its own building map proves nothing about the formula. Called from every case that
 * supplies a bag (via `demandFor`), so the fixture table cannot drift back into unreachable states.
 */
function expectProducibleBag(map: BuildingMap, bag: LaborBag): void {
  const { r, c, i } = levelSums(map);
  expect(bag.employed + bag.unemployed).toBe(r * POPULATION_PER_LEVEL);
  expect(bag.jobsCapacity).toBe((c + i) * POPULATION_PER_LEVEL);
  expect(bag.employed + bag.reachableUnfilledJobs).toBeLessThanOrEqual(bag.jobsCapacity);
  for (const scalar of [bag.employed, bag.unemployed, bag.reachableUnfilledJobs, bag.jobsCapacity]) {
    expect(scalar % POPULATION_PER_LEVEL).toBe(0);
  }
  // reachableUnfilledJobs is summed over job nodes reached by a residential BFS.
  if (r === 0) expect(bag.reachableUnfilledJobs).toBe(0);
}

function demandFor(map: BuildingMap, bag: LaborBag): DemandVector {
  expectProducibleBag(map, bag);
  const demand = new Demand();
  demand.recompute(map, bag);
  return demand.get();
}

function makePRNG(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

const EMPTY_BAG: LaborBag = { employed: 0, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 0 };

describe('Demand — constants', () => {
  it('DENSITY_DEMAND_THRESHOLD is 0.375 — the 20%-unemployment point of a jobs bar', () => {
    expect(DENSITY_DEMAND_THRESHOLD).toBe(0.375);
    // 0.5 × severity(0.20) = 0.5 × 0.75; a jobs bar caps at COMMERCIAL_JOB_SHARE, so it is reachable.
    expect(DENSITY_DEMAND_THRESHOLD).toBeLessThan(COMMERCIAL_JOB_SHARE);

    // Residential's severity arm reaches 1.0, so its bar is the flat threshold, unchanged.
    expect(DENSITY_DEMAND_BAR.residential).toBe(DENSITY_DEMAND_THRESHOLD);
    // C and I split the flat threshold by COMMERCIAL_JOB_SHARE — the derivation, not a restatement.
    expect(DENSITY_DEMAND_BAR.commercial).toBe(DENSITY_DEMAND_THRESHOLD * COMMERCIAL_JOB_SHARE);
    expect(DENSITY_DEMAND_BAR.industrial).toBe(DENSITY_DEMAND_THRESHOLD * (1 - COMMERCIAL_JOB_SHARE));
    // Today's even split makes both entries equal at 0.1875 — exact in binary (3/8 × 1/2 = 3/16).
    expect(DENSITY_DEMAND_BAR.commercial).toBe(0.1875);
    expect(DENSITY_DEMAND_BAR.industrial).toBe(0.1875);
  });

  it('GROWTH_DEMAND_THRESHOLD is 0 and MIGRATION_PRESSURE sits strictly between the two gates', () => {
    expect(GROWTH_DEMAND_THRESHOLD).toBe(0);
    expect(MIGRATION_PRESSURE).toBe(0.1);
    expect(MIGRATION_PRESSURE).toBeGreaterThan(GROWTH_DEMAND_THRESHOLD);
    expect(MIGRATION_PRESSURE).toBeLessThan(DENSITY_DEMAND_BAR.residential);
  });

  it('WORKPLACE_PRESSURE sits strictly between the two gates, like MIGRATION_PRESSURE', () => {
    expect(WORKPLACE_PRESSURE).toBe(0.1);
    // The hard constraint: the floor alone can never drive a density bump or merge, only open the
    // spawn/level-up gates.
    expect(WORKPLACE_PRESSURE).toBeGreaterThan(GROWTH_DEMAND_THRESHOLD);
    // Against the per-type bars C and I actually face, not the flat threshold — floor alone still
    // cannot densify either one.
    expect(WORKPLACE_PRESSURE).toBeLessThan(DENSITY_DEMAND_BAR.commercial);
    expect(WORKPLACE_PRESSURE).toBeLessThan(DENSITY_DEMAND_BAR.industrial);
  });

  it('MIN_MARKET is 100 = 20 * POPULATION_PER_TILE_LEVEL, anchored on the modal building-level', () => {
    expect(MIN_MARKET).toBe(100);
    expect(MIN_MARKET % POPULATION_PER_TILE_LEVEL).toBe(0);
    // Still exactly one modal (structureRect area 2) building-level: 100 / POPULATION_PER_LEVEL = 10.
    expect(MIN_MARKET / POPULATION_PER_LEVEL).toBe(10);
  });

  it('EMPTY_CITY_DEMAND is {1, 0, 0} and is what get() returns before the first recompute', () => {
    expect(EMPTY_CITY_DEMAND).toEqual({ residential: 1, commercial: 0, industrial: 0 });
    expect(new Demand().get()).toBe(EMPTY_CITY_DEMAND);
  });
});

describe('Demand — labor axis', () => {
  it('bootstrap: an empty labor market reads {1, 0, 0} — build homes', () => {
    const v = demandFor(makeBuildingMap(), EMPTY_BAG);
    expect(v.residential).toBe(1);
    expect(v.commercial).toBe(0);
    expect(v.industrial).toBe(0);
  });

  it('balanced and fully employed: all three bars rest on their own damped floor', () => {
    // 4 R + 2 C + 2 I level 1: 40 workers against 40 jobs, all matched, no vacancies.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 4, 1);
    addRun(map, 10, 1, 'commercial', 2, 1);
    addRun(map, 20, 2, 'industrial', 2, 1);

    const v = demandFor(map, { employed: 40, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 40 });

    // The labor axis reaches exactly zero at balance; each bar then reads its own external driver,
    // which is what keeps all three growth gates open in a city that has nothing left to correct.
    expect(v.residential).toBe(MIGRATION_PRESSURE);
    expect(v.commercial).toBe(WORKPLACE_PRESSURE);
    expect(v.industrial).toBe(WORKPLACE_PRESSURE);
  });

  it('deadband: a real 3.2% vacancy surplus still reads as balanced', () => {
    // levelSumR 30, levelSumC 31 → market 310, net 10 = 3.2% < DEADBAND_RATE.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 6, 5);
    addRun(map, 10, 1, 'commercial', 6, 5);
    addBuilding(map, 20, 0, 2, 'commercial', 1);

    const v = demandFor(map, { employed: 300, unemployed: 0, reachableUnfilledJobs: 10, jobsCapacity: 310 });

    // A 3.2% surplus is inside the deadband, so `staffing` stays exactly 1 and the floor undamped.
    expect(v.residential).toBe(MIGRATION_PRESSURE);
    expect(v.commercial).toBe(WORKPLACE_PRESSURE);
    expect(v.industrial).toBe(WORKPLACE_PRESSURE);
  });

  it('mid-band: a 15% vacancy surplus reads half severity on residential', () => {
    // levelSumR 17, levelSumC 20 → market 200, net 30 = 15% → (0.15 − 0.05) / 0.20.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 4, 4);
    addBuilding(map, 10, 0, 1, 'residential', 1);
    addRun(map, 20, 2, 'commercial', 4, 5);

    const v = demandFor(map, { employed: 170, unemployed: 0, reachableUnfilledJobs: 30, jobsCapacity: 200 });

    expect(v.residential).toBeCloseTo(0.5, 10);
    // staffing = 1 - 0.5 = 0.5 halves the floor; retail is 0 (levelSumC 20 over targetC 9.25).
    expect(v.commercial).toBeCloseTo(0.05, 10);
    expect(v.industrial).toBeCloseTo(0.05, 10);
  });

  it('saturation: a 40% vacancy surplus pins residential at exactly 1', () => {
    // levelSumR 6, levelSumC 10 → market 100, net 40 = 40% > SATURATION_RATE.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 6, 1);
    addRun(map, 10, 1, 'commercial', 2, 5);

    const v = demandFor(map, { employed: 60, unemployed: 0, reachableUnfilledJobs: 40, jobsCapacity: 100 });

    expect(v.residential).toBe(1);
    // staffing saturates to exactly 0, so the floor damps to exactly 0 — clamp01 saturates exact.
    expect(v.commercial).toBe(0);
    expect(v.industrial).toBe(0);
  });

  it('MIN_MARKET floors the denominator: one stranded worker-level reads PARTIAL severity', () => {
    // 1 R + 1 C level 1; the C is unreachable, so the single worker-level is unemployed.
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'residential', 1);
    addBuilding(map, 1, 1, 0, 'commercial', 1);

    const v = demandFor(map, { employed: 0, unemployed: 10, reachableUnfilledJobs: 0, jobsCapacity: 10 });

    // market floored 10 → 100, so the ratio is 10/100 = 0.10 → severity 0.25, split evenly.
    // Counterfactual: unfloored, market would be 10, ratio 1.0, and this single building would read
    // a saturated 0.5 on each jobs bar.
    expect(v.commercial).toBeCloseTo(0.125, 10);
    expect(v.industrial).toBeCloseTo(0.125, 10);
    expect(v.residential).toBe(0); // 100% unemployment kills migration
  });

  it('allocation happens AFTER the curve: C and I split one aggregate severity, never spend it twice', () => {
    // 2 R + 2 C level 1, all 20 workers unemployed → market 100, ratio 0.20 → severity 0.75.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 2, 1);
    addRun(map, 10, 1, 'commercial', 2, 1);

    const v = demandFor(map, { employed: 0, unemployed: 20, reachableUnfilledJobs: 0, jobsCapacity: 20 });

    const workplaceSeverity = (20 / MIN_MARKET - DEADBAND_RATE) / (SATURATION_RATE - DEADBAND_RATE);
    expect(v.commercial).toBeCloseTo(0.375, 10);
    expect(v.industrial).toBeCloseTo(0.375, 10);
    // Halving is exact in binary, so the two halves re-sum to the aggregate with no drift.
    expect(v.commercial + v.industrial).toBe(workplaceSeverity);
    // Retail contributes nothing here — C is already over its 25% share.
    expect(v.commercial).toBe(v.industrial);
  });

  it('access mismatch: stranded workers cancel stranded vacancies, but the floor stays up', () => {
    // 10 R + 5 C + 5 I levels. One road component holds 5 R levels against every job; a second
    // holds 5 stranded R levels. C sits exactly at its 25% share.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 10, 1);
    addRun(map, 20, 1, 'commercial', 5, 1);
    addRun(map, 30, 2, 'industrial', 5, 1);

    const v = demandFor(map, { employed: 50, unemployed: 50, reachableUnfilledJobs: 50, jobsCapacity: 100 });

    // net 0, migration damped to 0 by the 50% rate — a legitimate reading, not a stall: the fix is
    // a road, and laborStatus.ts is the channel that says so. C and I differ: there is no vacancy
    // surplus here to damp the floor (net is 0, not positive), and the 50 stranded workers could
    // staff a NEW local workplace, so the fix there is a road OR a local workplace.
    expect(v.residential).toBe(0);
    expect(v.commercial).toBe(WORKPLACE_PRESSURE);
    expect(v.industrial).toBe(WORKPLACE_PRESSURE);
  });

  it('zero-workforce fallback: an all-jobs city counts its whole capacity as vacancies', () => {
    // No residential origins → reachableUnfilledJobs is structurally 0, so jobsCapacity is used.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'commercial', 4, 3);

    const v = demandFor(map, { employed: 0, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 120 });

    expect(v.residential).toBe(1);
    expect(v.commercial).toBe(0); // staffing collapses the retail axis
    expect(v.industrial).toBe(0);
  });

  it('zero-workforce hamlet: the workplace floor is gated to exactly 0 with nobody to staff it', () => {
    // 1 I level 1, no residential at all.
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'industrial', 1);

    const v = demandFor(map, { employed: 0, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 10 });

    // Ungated, the floored 100-unit market would leave staffing at 0.75 and leak a partial floor of
    // 0.1 × 0.75 = 0.075; the workforce === 0 gate zeroes it outright.
    expect(v.industrial).toBe(0);
    // C reads via the retail axis alone: buildingCapacity(level 1) = 10 is exactly the retail
    // axis's `max(targetC, capacitySumC, POPULATION_PER_LEVEL)` floor (targetC = 0.25*10 = 2.5),
    // so retail reads 2.5/10 = 0.25, scaled by staffing (0.75) to 0.1875 — the same reading the
    // level-0 test below pins for this labor state; R via migration.
    expect(v.commercial).toBeCloseTo(0.1875, 10);
    expect(v.residential).toBeCloseTo(0.25, 10);
  });
});

describe('Demand — migration', () => {
  it('(a) 100% unemployment stops in-migration entirely: residential exactly 0', () => {
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 10, 1);

    const v = demandFor(map, { employed: 0, unemployed: 100, reachableUnfilledJobs: 0, jobsCapacity: 0 });

    expect(v.residential).toBe(0);
  });

  it('(b) at exactly MIGRATION_UNEMPLOYMENT_CUTOFF migration is already 0', () => {
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 10, 1);
    addRun(map, 20, 1, 'commercial', 8, 1);

    const v = demandFor(map, { employed: 80, unemployed: 20, reachableUnfilledJobs: 0, jobsCapacity: 80 });

    expect(20 / 100).toBe(MIGRATION_UNEMPLOYMENT_CUTOFF);
    expect(v.residential).toBe(0);
  });

  it('(c) 10% unemployment halves the trickle: residential exactly 0.05', () => {
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 10, 1);
    addRun(map, 20, 1, 'commercial', 9, 1);

    const v = demandFor(map, { employed: 90, unemployed: 10, reachableUnfilledJobs: 0, jobsCapacity: 90 });

    expect(v.residential).toBe(MIGRATION_PRESSURE / 2);
  });
});

describe('Demand — retail axis', () => {
  it('commercial below its 25% share pulls on the retail axis alone', () => {
    // 3 R + 1 C + 2 I level 1 → totalLevels 6, targetC 1.5, levelSumC 1 → 0.5 / 1.5.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 3, 1);
    addBuilding(map, 10, 0, 1, 'commercial', 1);
    addRun(map, 20, 2, 'industrial', 2, 1);

    const v = demandFor(map, { employed: 30, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 30 });

    expect(v.residential).toBe(MIGRATION_PRESSURE);
    expect(v.commercial).toBeCloseTo(1 / 3, 10); // retail beats the floor
    expect(v.industrial).toBe(WORKPLACE_PRESSURE);
  });

  it('commercial OVER its share rests on the workplace floor rather than going negative', () => {
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 4, 1);
    addRun(map, 10, 1, 'commercial', 4, 1);

    const v = demandFor(map, { employed: 40, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 40 });

    expect(v.commercial).toBe(WORKPLACE_PRESSURE);
  });

  it('staffing collapses the retail axis when the city already has more jobs than workers', () => {
    // 1 R + 4 I level 1 and no commercial at all → retail gap 1.0, but resSeverity is 1, so
    // staffing is 0 and the workplace floor is also damped to exactly 0 (its existing toBe(0)
    // assertions below are the pin).
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'residential', 1);
    addRun(map, 10, 1, 'industrial', 4, 1);

    const v = demandFor(map, { employed: 10, unemployed: 0, reachableUnfilledJobs: 30, jobsCapacity: 40 });

    expect(v.residential).toBe(1);
    expect(v.commercial).toBe(0);
    expect(v.industrial).toBe(0);
  });
});

describe('Demand — regression readings', () => {
  it('playtest #1: a jobless city reads R 0.00 / C ≈ 0.68 (retail) / I 0.50', () => {
    // levelSumR 126, levelSumC 12, levelSumI 11; 230 employed, 1030 unemployed, no vacancies.
    const map = new BuildingMap(200, 200);
    addRun(map, 0, 0, 'residential', 42, 3);
    addRun(map, 100, 1, 'commercial', 12, 1);
    addRun(map, 200, 2, 'industrial', 11, 1);

    const v = demandFor(map, { employed: 230, unemployed: 1030, reachableUnfilledJobs: 0, jobsCapacity: 230 });

    expect(v.residential).toBe(0);
    expect(v.industrial).toBe(0.5); // a jobs bar caps at COMMERCIAL_JOB_SHARE
    expect(v.commercial).toBeCloseTo(25.25 / 37.25, 10);
  });

  it('the same city, cleared — a reading the old structural model could never produce', () => {
    // levelSumR 126, levelSumC 63, levelSumI 63: every worker employed, C exactly at its share.
    const map = new BuildingMap(200, 200);
    addRun(map, 0, 0, 'residential', 42, 3);
    addRun(map, 100, 1, 'commercial', 21, 3);
    addRun(map, 200, 2, 'industrial', 21, 3);

    const v = demandFor(map, { employed: 1260, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 1260 });

    // The recorded 850-tick inert-C state from the previous playtest: the C gate now stays open in
    // exactly the city where the tester's paid tiles sat dead.
    expect(v.residential).toBe(MIGRATION_PRESSURE);
    expect(v.commercial).toBe(WORKPLACE_PRESSURE);
    expect(v.industrial).toBe(WORKPLACE_PRESSURE);
  });

  it('outputs stay in [0, 1] with a large, fully severed but producible city', () => {
    // 20 modal (2-wide) buildings need 40 columns of width — wider than makeBuildingMap()'s 20.
    const map = new BuildingMap(50, 20);
    addRun(map, 0, 0, 'residential', 20, 5);
    addRun(map, 100, 1, 'commercial', 10, 5);
    addRun(map, 200, 2, 'industrial', 10, 5);

    const v = demandFor(map, { employed: 0, unemployed: 1000, reachableUnfilledJobs: 0, jobsCapacity: 1000 });

    for (const value of [v.residential, v.commercial, v.industrial]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    // A jobs bar can never exceed its share of a saturated workplace severity.
    expect(v.industrial).toBe(COMMERCIAL_JOB_SHARE);
  });

  it('level-0 buildings contribute nothing to the level sums', () => {
    const map = new BuildingMap(200, 200);
    for (let i = 0; i < 100; i++) addBuilding(map, i, i, 0, 'residential', 0);
    addBuilding(map, 100, 0, 1, 'industrial', 1);

    const v = demandFor(map, { employed: 0, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 10 });

    // No workforce → the 10 jobs are all vacancies against the 100-unit floor → severity 0.25.
    expect(v.residential).toBeCloseTo(0.25, 10);
    // totalCapacity is 10 (the single level-1 I's buildingCapacity), not 1010: the 100 level-0
    // residents each contribute buildingCapacity 0, exactly like they contributed raw level 0
    // under the retired formula — this is the same single-I fixture as the test above, so
    // targetC = 0.25*10 = 2.5 sits at the axis's POPULATION_PER_LEVEL floor, reading 2.5/10 =
    // 0.25, damped by staffing 0.75 to 0.1875.
    expect(v.commercial).toBeCloseTo(0.1875, 10);
  });

  it('abandoned buildings are excluded from the level sums', () => {
    // 8 R + 1 C level 1 active, plus one abandoned level-1 C. Retail binds at (2.25 − 1) / 2.25;
    // counting the derelict would move targetC to 2.5 and drop the reading to the jobs half-share.
    const withAbandoned = makeBuildingMap();
    addRun(withAbandoned, 0, 0, 'residential', 8, 1);
    addBuilding(withAbandoned, 10, 0, 1, 'commercial', 1);
    // x=5 (not 1) so this footprint clears the modal-widened commercial building above,
    // which now occupies columns 0-1 of the same row. Capacity is irrelevant here — the
    // whole point of this fixture is that an abandoned building contributes nothing.
    withAbandoned.addExistingBuilding({
      id: 11,
      type: 'commercial',
      footprint: [{ x: 5, y: 1 }],
      anchor: { x: 5, y: 1 },
      level: 1,
      density: 0,
      age: 0,
      abandoned: true,
      frontage: 'S',
      structureRect: { x: 5, y: 1, w: 1, h: 1 },
    });

    const withoutBuilding = makeBuildingMap();
    addRun(withoutBuilding, 0, 0, 'residential', 8, 1);
    addBuilding(withoutBuilding, 10, 0, 1, 'commercial', 1);

    const bag: LaborBag = { employed: 10, unemployed: 70, reachableUnfilledJobs: 0, jobsCapacity: 10 };
    const v1 = demandFor(withAbandoned, bag);
    const v2 = demandFor(withoutBuilding, bag);

    expect(v1.residential).toBe(v2.residential);
    expect(v1.commercial).toBe(v2.commercial);
    expect(v1.industrial).toBe(v2.industrial);
    // The pinned value IS the discriminator: 5/9 is the retail gap over the NON-abandoned sums,
    // and it beats the 0.5 jobs half-share. Counting the derelict would give retail 0.2 → 0.5.
    expect(v1.commercial).toBeCloseTo(5 / 9, 10);
  });

  // The dead window the per-type DENSITY_DEMAND_BAR fixes: capped at its COMMERCIAL_JOB_SHARE
  // share of workplaceSeverity, industrial's jobs bar could only clear the flat DENSITY_DEMAND_THRESHOLD
  // at exactly 20% unemployment — MIGRATION_UNEMPLOYMENT_CUTOFF, where migration has already hit 0 and
  // residential growth is frozen. Three states over ONE R:C+I = 40:40 building map (workforce 400,
  // jobsCapacity 400, no reachable vacancies) trace the fix at u = 40, 60, 80 (10%, 15%, 20%
  // unemployment).
  //
  // The exact 12.5% contour (u = 50) is deliberately untested in either direction. Measured in node
  // against this exact chain: DENSITY_DEMAND_BAR.industrial (0.1875) is exactly representable, but at
  // u/workforce = 0.125 the severity chain `(rate - DEADBAND_RATE) / (SATURATION_RATE - DEADBAND_RATE)`
  // computes 1 ULP UNDER it — 0.18749999999999997, a 2.8e-17 shortfall, identical at every workforce
  // measured from 100 to 1000; the unsplit severity is likewise 1 ULP under 0.375, so no reassociation
  // of the arithmetic fixes it. That contour is an arithmetic artifact, not a behavior, and the
  // production comparison stays a plain `>=` with no epsilon — the sibling gates in the same density
  // branch compare computed floats against float constants with the identical tie property, so a lone
  // tolerant gate here would be an inconsistency. Pinning u = 50 either way would break on a no-op
  // reassociation, so this table brackets it instead: below at u = 40, above at u = 80, and the new
  // window opened in between at u = 60. A second, tighter pair further below narrows that bracket to
  // the contour's immediate 1-point neighbors — 12% and 13% unemployment on their own 2000-workforce
  // map — so the opening cannot drift anywhere inside the wide 10-to-15 window without failing, while
  // still stopping one point shy of the untested contour on each side. expectProducibleBag requires
  // every labor scalar to be a multiple of POPULATION_PER_LEVEL, so this fixture steps in units of it;
  // 240 and 260 are the nearest values that convention can express on either side of the 250 contour.
  function makeReachMap(): BuildingMap {
    // The building map every row below shares: only the labor bag varies per row.
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 10, 4);
    addRun(map, 100, 1, 'commercial', 10, 2);
    addRun(map, 200, 2, 'industrial', 10, 2);
    return map;
  }

  it('10% unemployment — below both density bars, migration still alive', () => {
    const v = demandFor(makeReachMap(), { employed: 360, unemployed: 40, reachableUnfilledJobs: 0, jobsCapacity: 400 });

    expect(v.industrial).toBeLessThan(DENSITY_DEMAND_BAR.industrial);
    expect(v.industrial).toBeCloseTo(0.125, 10);
    expect(v.residential).toBeGreaterThan(0);
    expect(v.residential).toBeCloseTo(0.05, 10);
  });

  it('15% unemployment — the new window: I clears its own bar, the flat threshold still does not, migration alive', () => {
    const v = demandFor(makeReachMap(), { employed: 340, unemployed: 60, reachableUnfilledJobs: 0, jobsCapacity: 400 });

    expect(v.industrial).toBeGreaterThanOrEqual(DENSITY_DEMAND_BAR.industrial);
    expect(v.industrial).toBeLessThan(DENSITY_DEMAND_THRESHOLD);
    expect(v.industrial).toBeCloseTo(0.25, 10);
    expect(v.residential).toBeGreaterThan(0);
    expect(v.residential).toBeCloseTo(0.025, 10);
  });

  it('20% unemployment — above both bars, where the flat threshold first opens: the diagnosed dead window', () => {
    const v = demandFor(makeReachMap(), { employed: 320, unemployed: 80, reachableUnfilledJobs: 0, jobsCapacity: 400 });

    // The old bar's opening boundary: I first clears DENSITY_DEMAND_THRESHOLD exactly here, and
    // (severity being monotone in u) stays above it for every u beyond, while migration — and so R —
    // is pinned at exactly 0 for every u beyond too. This row is the diagnosed dead window itself.
    expect(v.industrial).toBeGreaterThanOrEqual(DENSITY_DEMAND_BAR.industrial);
    expect(v.industrial).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);
    expect(v.industrial).toBeCloseTo(0.375, 10);
    expect(v.residential).toBe(0);
  });

  /**
   * Own R:C+I = 200:200 map (workforce 2000, jobsCapacity 2000, no reachable vacancies), built only
   * from legal ZONE_MAX_LEVEL buildings: only the labor bag varies per row, same shape as makeReachMap
   * above but scaled so 1% of workforce is a producible 10-worker step, letting the two rows below sit
   * one point on either side of 12.5%.
   */
  function makeBracketMap(): BuildingMap {
    const map = makeBuildingMap();
    // Modal 2-wide building at level 5 (ZONE_MAX_LEVEL): 2 tiles × level 5 × 5 = 50 each. The 20-wide
    // map fits 10 per row, so each count-10 run below needs its own row.
    // 40 residential (50 each) → workforce 2000.
    addRun(map, 0, 0, 'residential', 10, 5);
    addRun(map, 10, 1, 'residential', 10, 5);
    addRun(map, 20, 2, 'residential', 10, 5);
    addRun(map, 30, 3, 'residential', 10, 5);
    // 20 commercial + 20 industrial (50 each) → jobs capacity 2000.
    addRun(map, 100, 4, 'commercial', 10, 5);
    addRun(map, 110, 5, 'commercial', 10, 5);
    addRun(map, 200, 6, 'industrial', 10, 5);
    addRun(map, 210, 7, 'industrial', 10, 5);
    return map;
  }

  it('12% unemployment — brackets the 12.5% industrial-density-bar opening from below', () => {
    const v = demandFor(makeBracketMap(), { employed: 1760, unemployed: 240, reachableUnfilledJobs: 0, jobsCapacity: 2000 });

    expect(v.industrial).toBeLessThan(DENSITY_DEMAND_BAR.industrial);
    expect(v.industrial).toBeCloseTo(0.175, 10);
  });

  it('13% unemployment — brackets the 12.5% industrial-density-bar opening from above', () => {
    const v = demandFor(makeBracketMap(), { employed: 1740, unemployed: 260, reachableUnfilledJobs: 0, jobsCapacity: 2000 });

    expect(v.industrial).toBeGreaterThanOrEqual(DENSITY_DEMAND_BAR.industrial);
    expect(v.industrial).toBeCloseTo(0.2, 10);
  });
});

describe('Demand — purity', () => {
  it('idempotence: recomputing twice on the same input leaves the same values', () => {
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 3, 1);
    addBuilding(map, 10, 0, 1, 'commercial', 1);
    addBuilding(map, 11, 1, 1, 'industrial', 2);
    const bag: LaborBag = { employed: 30, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 30 };
    expectProducibleBag(map, bag);

    const demand = new Demand();
    demand.recompute(map, bag);
    const first = { ...demand.get() };
    demand.recompute(map, bag);
    const second = demand.get();

    expect(second.residential).toBe(first.residential);
    expect(second.commercial).toBe(first.commercial);
    expect(second.industrial).toBe(first.industrial);
  });

  it('determinism: two instances on identical input yield byte-identical output', () => {
    const map = makeBuildingMap();
    addRun(map, 0, 0, 'residential', 3, 1);
    addBuilding(map, 10, 0, 1, 'commercial', 1);
    addBuilding(map, 11, 1, 1, 'industrial', 2);
    const bag: LaborBag = { employed: 30, unemployed: 0, reachableUnfilledJobs: 0, jobsCapacity: 30 };

    const r1 = demandFor(map, bag);
    const r2 = demandFor(map, bag);

    expect(r1.residential).toBe(r2.residential);
    expect(r1.commercial).toBe(r2.commercial);
    expect(r1.industrial).toBe(r2.industrial);
  });

  it('determinism across shuffled building-add orderings', () => {
    const rng = makePRNG(0xc0ffee);

    type BuildingSpec = { id: number; x: number; y: number; type: Building['type']; level: number };
    const specs: BuildingSpec[] = [
      { id: 0, x: 0, y: 0, type: 'residential', level: 2 },
      { id: 1, x: 1, y: 0, type: 'residential', level: 1 },
      { id: 2, x: 2, y: 0, type: 'commercial', level: 1 },
      { id: 3, x: 3, y: 0, type: 'commercial', level: 2 },
      { id: 4, x: 4, y: 0, type: 'industrial', level: 3 },
      { id: 5, x: 5, y: 0, type: 'industrial', level: 1 },
    ];
    // levelSumR 3 → 30 workers; levelSumC + levelSumI = 7 → 70 jobs.
    const bag: LaborBag = { employed: 30, unemployed: 0, reachableUnfilledJobs: 40, jobsCapacity: 70 };

    const refMap = makeBuildingMap();
    for (const s of specs) addBuilding(refMap, s.id, s.x, s.y, s.type, s.level);
    const refV = demandFor(refMap, bag);

    for (let run = 0; run < 50; run++) {
      const shuffled = shuffle(specs, rng);
      const map = makeBuildingMap();
      for (const s of shuffled) addBuilding(map, s.id, s.x, s.y, s.type, s.level);
      const v = demandFor(map, bag);
      expect(v.residential).toBe(refV.residential);
      expect(v.commercial).toBe(refV.commercial);
      expect(v.industrial).toBe(refV.industrial);
    }
  });

  it('immutability: mutating get() result throws in strict mode', () => {
    const demand = new Demand();
    demand.recompute(makeBuildingMap(), EMPTY_BAG);
    const v = demand.get();
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v as any).residential = 999;
    }).toThrow();
  });

  it('get() and getRaw() return the same reference', () => {
    const demand = new Demand();
    demand.recompute(makeBuildingMap(), EMPTY_BAG);
    expect(demand.get()).toBe(demand.getRaw());
  });
});
