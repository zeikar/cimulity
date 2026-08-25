import { describe, it, expect, vi } from 'vitest';
import {
  World,
  ZONE_GROWTH_INTERVAL,
  ZONE_MAX_LEVEL,
  POPULATION_PER_LEVEL,
  STARTING_FUNDS,
  TAX_PER_POP,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  POWER_INTERVAL,
  WATER_INTERVAL,
  SERVICE_INTERVAL,
  TRAFFIC_INTERVAL,
  LAND_VALUE_INTERVAL,
  DENSITY_COOLDOWN_INTERVALS,
  EMPTY_CITY_HAPPINESS,
  HAPPINESS_W_LAND,
  HAPPINESS_W_JOBS,
  HAPPINESS_W_BUDGET,
  HAPPINESS_W_TRAFFIC,
} from './World';
import { GROWTH_COOLDOWN_INTERVALS, LEVEL_THRESHOLDS, stagger } from './growthConstants';
import { buildingCapacity } from './buildingCapacity';
import { DENSITY_DEMAND_THRESHOLD, GROWTH_DEMAND_THRESHOLD } from './Demand';
import { TileType, createTile } from './Tile';
import { SERVICE_COVERAGE_THRESHOLD_RAW } from './ServiceCoverageMap';
import { serializeWorld, deserializeWorldInto } from './mapSerialization';

function seedPower(world: World, ax: number, ay: number): void {
  world.getStructureMap().addStructure({
    type: 'power_plant',
    anchor: { x: ax, y: ay },
    footprint: [
      { x: ax, y: ay }, { x: ax + 1, y: ay },
      { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 },
    ],
  });
  world.markPowerDirty();
  world.recomputePower();
}

function seedWater(world: World, ax: number, ay: number): void {
  world.getStructureMap().addStructure({
    type: 'water_tower',
    anchor: { x: ax, y: ay },
    footprint: [
      { x: ax, y: ay },
    ],
  });
  world.markWaterDirty();
  world.recomputeWater();
}

/** 2×2 footprint at (ax,ay); asserts every cell is GRASS before placing so a stray
 * station-on-zone reseed coord is caught (StructureMap only excludes structure-vs-structure). */
function station2x2(ax: number, ay: number): { x: number; y: number }[] {
  return [
    { x: ax, y: ay }, { x: ax + 1, y: ay },
    { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 },
  ];
}

function seedFire(world: World, ax: number, ay: number): void {
  const footprint = station2x2(ax, ay);
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  const added = world.getStructureMap().addStructure({ type: 'fire_station', anchor: { x: ax, y: ay }, footprint });
  expect(added).not.toBeNull();
  world.markFireDirty();
  world.recomputeFire();
}

function seedHospital(world: World, ax: number, ay: number): void {
  const footprint = station2x2(ax, ay);
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  const added = world.getStructureMap().addStructure({ type: 'hospital', anchor: { x: ax, y: ay }, footprint });
  expect(added).not.toBeNull();
  world.markHospitalDirty();
  world.recomputeHospital();
}

function seedSchool(world: World, ax: number, ay: number): void {
  const footprint = station2x2(ax, ay);
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  const added = world.getStructureMap().addStructure({ type: 'school', anchor: { x: ax, y: ay }, footprint });
  expect(added).not.toBeNull();
  world.markSchoolDirty();
  world.recomputeSchool();
}

/**
 * Two reachable level-2 commercial job sources for the shared 10×8 coverage/water fixture
 * layout: road row at y=2, residential probe at (0,1). Both front 'S' onto that road row, so
 * their 40 jobs are road-reachable from the probe's access node — jobs the probe cannot reach
 * are invisible to the labor market and would leave residential demand at 0.00.
 * Level 2 is supported by bare road frontage (lv ≈ 0.34 > LEVEL_THRESHOLDS[2]) whatever the
 * fixture's coverage looks like, so the abandonment sweep can never quietly delete the demand.
 */
function seedRoadRowJobs(world: World): void {
  for (const [id, x] of [[998, 3], [999, 4]] as const) {
    expect(world.getMap().getBuildings().addExistingBuilding({
      id, type: 'commercial',
      footprint: [{ x, y: 1 }], anchor: { x, y: 1 },
      level: 2, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x, y: 1, w: 1, h: 1 },
    })).toBe(true);
  }
}

/**
 * Symmetric post-run guard for seedRoadRowJobs: the seeders must still be live at the END of the
 * run too. Had the sweep abandoned them their jobs would vanish mid-run, demand rather than the
 * gate under test would become the blocker, and a "does NOT level up" fixture would go green for
 * the wrong reason. Level 2 on road frontage cannot abandon today — this is the guard that would
 * catch a future land-value retune quietly hollowing these fixtures out.
 */
function expectRoadRowJobsAlive(world: World): void {
  for (const id of [998, 999]) {
    expect(world.getMap().getBuildings().getBuilding(id)!.abandoned).toBe(false);
  }
}

/**
 * Assert the fixture really supplies reachable jobs and an open residential gate. Call it once
 * every building exists — a job source is often seeded before the residential probe, and a
 * labor market with no origins reports zero reachable jobs. Buildings added straight to the
 * BuildingMap never mark the world dirty, so force the refresh the growth pass would do.
 */
function expectJobsReachable(world: World): void {
  world.recomputeLabor();
  world.markDemandDirty();
  expect(world.getLaborMarket().getReachableUnfilledJobs()).toBeGreaterThan(0);
  expect(world.getDemand().residential).toBeGreaterThan(0);
}

function seedPolice(world: World, ax: number, ay: number): void {
  const footprint = station2x2(ax, ay);
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  const added = world.getStructureMap().addStructure({ type: 'police_station', anchor: { x: ax, y: ay }, footprint });
  expect(added).not.toBeNull();
  world.markServiceDirty();
  world.recomputeService();
}

describe('World', () => {
  it('builds a map of the requested size', () => {
    const world = new World(8, 6, { regenerate: false });
    const map = world.getMap();

    expect(map.getWidth()).toBe(8);
    expect(map.getHeight()).toBe(6);
  });

  it('returns the same map instance across calls', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getMap()).toBe(world.getMap());
  });

  it('starts at tick 0 and advances one tick at a time', () => {
    const world = new World(4, 4, { regenerate: false });

    expect(world.getTick()).toBe(0);
    world.tick();
    world.tick();
    expect(world.getTick()).toBe(2);
  });

  it('reset() clears the map and the tick counter', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    world.tick();

    world.reset();

    expect(world.getTick()).toBe(0);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });
});

describe('World money — initial state', () => {
  it('new World starts with STARTING_FUNDS', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getMoney()).toBe(STARTING_FUNDS);
  });
});

describe('World.trySpend()', () => {
  it('returns true and decrements money when amount is within balance', () => {
    const world = new World(4, 4, { regenerate: false });
    const result = world.trySpend(100);
    expect(result).toBe(true);
    expect(world.getMoney()).toBe(STARTING_FUNDS - 100);
  });

  it('returns false and leaves money unchanged when amount exceeds balance', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    const result = world.trySpend(STARTING_FUNDS + 1);
    expect(result).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns true and leaves 0 when spending exactly the full balance', () => {
    const world = new World(4, 4, { regenerate: false });
    const result = world.trySpend(STARTING_FUNDS);
    expect(result).toBe(true);
    expect(world.getMoney()).toBe(0);
  });

  it('returns false and leaves money unchanged for negative amount', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    expect(world.trySpend(-1)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for Infinity', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    expect(world.trySpend(Infinity)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for NaN', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    expect(world.trySpend(NaN)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for fractional amount', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    expect(world.trySpend(12.5)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });
});

describe('World.earn()', () => {
  it('increases money by a valid whole amount', () => {
    const world = new World(4, 4, { regenerate: false });
    world.earn(50);
    expect(world.getMoney()).toBe(STARTING_FUNDS + 50);
  });

  it('earn(0) is a no-op that leaves money unchanged', () => {
    const world = new World(4, 4, { regenerate: false });
    world.earn(0);
    expect(world.getMoney()).toBe(STARTING_FUNDS);
  });

  it('earn(-1) is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    world.earn(-1);
    expect(world.getMoney()).toBe(before);
  });

  it('earn(NaN) is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    world.earn(NaN);
    expect(world.getMoney()).toBe(before);
  });

  it('earn(12.5) is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    world.earn(12.5);
    expect(world.getMoney()).toBe(before);
  });
});

describe('World.setMoney()', () => {
  it('returns true and sets money to 500', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.setMoney(500)).toBe(true);
    expect(world.getMoney()).toBe(500);
  });

  it('returns false and leaves money unchanged for -1', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    expect(world.setMoney(-1)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for Infinity', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    expect(world.setMoney(Infinity)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for NaN', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    expect(world.setMoney(NaN)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for 12.5', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    expect(world.setMoney(12.5)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });
});

describe('World calendar', () => {
  it('from a fresh world getDate() is {1,1,1} and getElapsedDays() is 0', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
    expect(world.getElapsedDays()).toBe(0);
  });

  it('after exactly 1 tick() getDate() is {1,1,2} and getElapsedDays() is 1', () => {
    const world = new World(4, 4, { regenerate: false });
    world.tick();
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 2 });
    expect(world.getElapsedDays()).toBe(1);
  });

  it('after a total of DAYS_PER_MONTH tick() calls getDate() is {1,2,1}', () => {
    const world = new World(4, 4, { regenerate: false });
    for (let i = 0; i < DAYS_PER_MONTH; i++) world.tick();
    expect(world.getDate()).toEqual({ year: 1, month: 2, day: 1 });
  });

  it('after a total of DAYS_PER_MONTH*MONTHS_PER_YEAR tick() calls getDate() is {2,1,1}', () => {
    const world = new World(4, 4, { regenerate: false });
    for (let i = 0; i < DAYS_PER_MONTH * MONTHS_PER_YEAR; i++) world.tick();
    expect(world.getDate()).toEqual({ year: 2, month: 1, day: 1 });
  });

  it('getElapsedDays() equals the total number of tick() calls', () => {
    const world = new World(4, 4, { regenerate: false });
    for (let i = 0; i < 47; i++) world.tick();
    expect(world.getElapsedDays()).toBe(47);
  });

  it('reset() returns a ticked world calendar to {1,1,1}, getElapsedDays() to 0, getTick() to 0', () => {
    const world = new World(4, 4, { regenerate: false });
    for (let i = 0; i < DAYS_PER_MONTH + 3; i++) world.tick();

    world.reset();

    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
  });
});

describe('World.setElapsedDays()', () => {
  it('returns true and sets day and tick together for a valid whole ≥0 value', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.setElapsedDays(DAYS_PER_MONTH)).toBe(true);
    expect(world.getDate()).toEqual({ year: 1, month: 2, day: 1 });
    expect(world.getTick()).toBe(DAYS_PER_MONTH);
    expect(world.getElapsedDays()).toBe(DAYS_PER_MONTH);
  });

  it('returns false and leaves elapsed days / tick / date unchanged for -1', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.setElapsedDays(-1)).toBe(false);
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
  });

  it('returns false and leaves elapsed days / tick / date unchanged for Infinity', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.setElapsedDays(Infinity)).toBe(false);
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
  });

  it('returns false and leaves elapsed days / tick / date unchanged for NaN', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.setElapsedDays(NaN)).toBe(false);
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
  });

  it('returns false and leaves elapsed days / tick / date unchanged for 12.5', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.setElapsedDays(12.5)).toBe(false);
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
  });
});

describe('World.tick() — monthly tax settlement', () => {
  it('money is unchanged after the 1st tick() and on every non-month-boundary tick (from a fresh world with a road-adjacent residential zone)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 1));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < DAYS_PER_MONTH - 1; i++) {
      const before = world.getMoney();
      world.tick();
      expect(world.getElapsedDays() % DAYS_PER_MONTH).not.toBe(0);
      expect(world.getMoney()).toBe(before);
    }
  });

  it('on the tick bringing getElapsedDays() to exactly DAYS_PER_MONTH money increases by Math.floor(popBeforeThatTick * TAX_PER_POP) * DAYS_PER_MONTH', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 1));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Advance to one tick before the M1→M2 boundary (no settlement yet).
    for (let i = 0; i < DAYS_PER_MONTH - 1; i++) world.tick();

    const moneyBeforeBoundary = world.getMoney();
    const popBeforeThatTick = world.getPopulation(); // measured pre-growth, just before the boundary tick
    world.tick(); // brings getElapsedDays() to DAYS_PER_MONTH

    expect(world.getElapsedDays()).toBe(DAYS_PER_MONTH);
    expect(world.getMoney()).toBe(
      moneyBeforeBoundary + Math.floor(popBeforeThatTick * TAX_PER_POP) * DAYS_PER_MONTH,
    );
  });

  it('a coincident growth + month-boundary tick taxes the PRE-growth population and still levels the zone up', () => {
    // Decision-A: water now gates level-up, so this fixture adds a water tower adjacent
    // to the road network so the building can still level up. Spawn is NOT water-gated.
    //
    // Layout (10x8 map):
    //   Road row at y=2: all 10 cells connected.
    //   Zone (0,1)=RESIDENTIAL, frontage='S' adj to road (0,2).
    //   Diversity in 3×3 around (0,1): (0,0)=INDUSTRIAL, (1,1)=COMMERCIAL → all 3 types.
    //   Plant at (4,3)–(5,4): (4,3) adj to road (4,2) → powers road row.
    //   Tower at (7,3)–(8,4): (7,3) adj to road (7,2) → waters road row.
    //   Road (0,2) is powered+watered; zone (0,1) adj to (0,2) → powered+watered ✓.
    //   Service coverage now ALSO contributes to land value (weight 0.50), so the four
    //   stations are reseeded close to road (0,2) to push LV(0,1) ≥ 0.85 (level-5 gate):
    //   service-avg ≈ 0.896 → LV(0,1) ≈ 0.89.
    const world = new World(10, 8, { regenerate: false });
    const mapF = world.getMap();
    // Road row.
    for (let x = 0; x < 10; x++) mapF.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    // Zone + diversity (all in 3×3 window around (0,1)).
    mapF.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    mapF.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    mapF.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    // Plant, tower, and the four coverage stations — all near the road row, footprints disjoint.
    seedPower(world, 4, 3); // plant at (4,3)–(5,4); cell (4,3) adj to road (4,2)
    seedWater(world, 7, 3); // tower at (7,3)–(8,4); cell (7,3) adj to road (7,2)
    // Police (0,3)–(1,4): (0,3) adj road (0,2) d=0 → anchor (0,1) coverage 1.0.
    seedPolice(world, 0, 3);
    // Hospital (2,3)–(3,4): (2,3) adj road (2,2) → road(0,2) 2 hops → ≈0.917.
    seedHospital(world, 2, 3);
    // Fire (3,0)–(4,1): (3,1)/(4,1) adj road (3,2)/(4,2) → road(0,2) 3 hops → ≈0.875.
    seedFire(world, 3, 0);
    // School (5,0)–(6,1): (5,1)/(6,1) adj road (5,2)/(6,2) → road(0,2) 5 hops → ≈0.792.
    seedSchool(world, 5, 0);

    world.setElapsedDays(ZONE_GROWTH_INTERVAL * DAYS_PER_MONTH - 1);

    // Verify road (0,2) is powered and watered, and zone (0,1) inherits both, and is covered.
    expect(world.getPowerMap().isPowered(0, 2)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 2)).toBe(true);
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    // Authoritative land-value guard: the level-5 gate is LEVEL_THRESHOLDS[5] = 0.85.
    world.recomputeLandValue();
    expect(world.getLandValue().getValue(0, 1)).toBeGreaterThanOrEqual(0.85);

    // Seed a building at level (ZONE_MAX_LEVEL - 1) = 4 to level up on this growth tick.
    // stagger(first-alloc-id)=0, cooldown=8. age=7 → after age+1=8 >= 8 → level-up fires.
    mapF.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: ZONE_MAX_LEVEL - 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      abandoned: false,
      frontage: 'S', // road is south at (0,2)
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    // Jobs sources so residential demand stays positive. Two level-4 commercials at (8,1) and
    // (9,1) — covered, road-adjacent cells with lv ≈ 0.73, so level 4 (their supportable max)
    // survives the abandonment sweep. Frontage 'S': the access node is the road row at y=2, so
    // the probe's BFS actually reaches them; fronting 'N' onto grass would make the jobs
    // invisible and residential demand 0. buildingCapacity(level 4, 1x1 sr) = 20, so two C
    // give 40 jobs against the level-4 probe's 20 workers → net 20 on a market of 100 →
    // resSeverity 0.75, comfortably above GROWTH_DEMAND_THRESHOLD. (Both sit on GRASS tiles,
    // so the growth loop never visits them; only the sweep reads their anchors.)
    for (const x of [8, 9]) {
      expect(mapF.getBuildings().addExistingBuilding({
        id: 990 + x,
        type: 'commercial',
        footprint: [{ x, y: 1 }],
        anchor: { x, y: 1 },
        level: 4,
        density: 0,
        age: 0,
        abandoned: false,
        frontage: 'S',
        structureRect: { x, y: 1, w: 1, h: 1 },
      })).toBe(true);
    }

    expectJobsReachable(world);

    const moneyBefore = world.getMoney();
    const level4Pop = world.getPopulation();
    world.tick();

    expect(world.getMoney()).toBe(
      moneyBefore + Math.floor(level4Pop * TAX_PER_POP) * DAYS_PER_MONTH,
    );
    expect(mapF.getBuildings().getBuildingAt(0, 1)?.level).toBe(ZONE_MAX_LEVEL);
  });

  it('money is unchanged even on a month-boundary tick when population is 0', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = world.getMoney();
    for (let i = 0; i < DAYS_PER_MONTH; i++) world.tick();
    expect(world.getElapsedDays()).toBe(DAYS_PER_MONTH);
    expect(world.getMoney()).toBe(before);
  });
});

describe('World.reset() — treasury', () => {
  it('restores money to STARTING_FUNDS after spending and zeroes the calendar and tick', () => {
    const world = new World(4, 4, { regenerate: false });
    world.trySpend(5000);
    for (let i = 0; i < DAYS_PER_MONTH + 5; i++) world.tick();
    world.reset();
    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
  });
});

describe('World.getPopulation()', () => {
  it('returns 0 for a default map with no zone tiles', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getPopulation()).toBe(0);
  });

  it('returns 0 when zone tiles are all at level 0', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 0));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL, 0));
    expect(world.getPopulation()).toBe(0);
  });

  it('sums buildingCapacity() across levels (modal 1x2 sr, so it equals level × POPULATION_PER_LEVEL)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL));
    // Seed buildings with levels 3, 2, 1 respectively; sum = 6. Modal 1x2 structureRect
    // (full 2-deep lot) so buildingCapacity = 1*2*level*5 = 10*level, matching
    // level * POPULATION_PER_LEVEL exactly (see growthConstants.ts POPULATION_PER_TILE_LEVEL).
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 0, y: 0 }, { x: 0, y: 1 }], anchor: { x: 0, y: 0 }, level: 3, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 0, y: 0, w: 1, h: 2 } });
    map.getBuildings().addBuilding({ type: 'commercial', footprint: [{ x: 1, y: 0 }, { x: 1, y: 1 }], anchor: { x: 1, y: 0 }, level: 2, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 1, y: 0, w: 1, h: 2 } });
    map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 2, y: 0 }, { x: 2, y: 1 }], anchor: { x: 2, y: 0 }, level: 1, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 2, y: 0, w: 1, h: 2 } });
    // sum = 3+2+1 = 6; population = 6 * POPULATION_PER_LEVEL
    expect(world.getPopulation()).toBe(6 * POPULATION_PER_LEVEL);
  });

  it('non-zone buildings (ROAD, GRASS, etc. tiles) contribute 0 to population', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ROAD));
    // (1, 0) stays GRASS — water is elevation-derived; type identity is fine here.
    map.setTile(2, 0, createTile(2, 0, TileType.DIRT));
    map.setTile(3, 0, createTile(3, 0, TileType.ZONE_RESIDENTIAL));
    // Only the zone at (3,0) has a building. Modal 1x2 structureRect, as above.
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 3, y: 0 }, { x: 3, y: 1 }], anchor: { x: 3, y: 0 }, level: 2, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 3, y: 0, w: 1, h: 2 } });
    expect(world.getPopulation()).toBe(2 * POPULATION_PER_LEVEL);
  });

  it('reset() zeroes tick and population returns 0 after reset', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 3));
    world.tick();

    world.reset();

    expect(world.getTick()).toBe(0);
    expect(world.getPopulation()).toBe(0);
  });
});

describe('World.getPopulation() — building-based formula', () => {
  it('returns 0 when no buildings exist (tiles alone do not contribute)', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 3));
    // No building in BuildingMap → population is 0
    expect(world.getPopulation()).toBe(0);
  });

  it('sums buildingCapacity() across multiple buildings (all modal 1x2 sr)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    // Modal 1x2 structureRect (full 2-deep lot), as in the getPopulation() suite above.
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 0, y: 0 }, { x: 0, y: 1 }], anchor: { x: 0, y: 0 }, level: 2, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 0, y: 0, w: 1, h: 2 } });
    map.getBuildings().addBuilding({ type: 'commercial', footprint: [{ x: 1, y: 0 }, { x: 1, y: 1 }], anchor: { x: 1, y: 0 }, level: 3, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 1, y: 0, w: 1, h: 2 } });
    // sum = 2+3 = 5
    expect(world.getPopulation()).toBe(5 * POPULATION_PER_LEVEL);
  });
});

describe('stagger() — deterministic per-building jitter', () => {
  it('stagger sanity: produces at least 2 distinct values across ids 0–10', () => {
    const values = Array.from({ length: 11 }, (_, i) => stagger(i));
    expect(new Set(values).size).toBeGreaterThanOrEqual(2);
  });

  it('stagger returns a value in [0, 6] for a range of ids', () => {
    for (let id = 0; id < 100; id++) {
      const s = stagger(id);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(6);
    }
  });

  it('stagger is deterministic: same id always returns same value', () => {
    for (let id = 0; id < 20; id++) {
      expect(stagger(id)).toBe(stagger(id));
    }
  });

  it('stagger differentiates first-level-up tick across 5 buildings in a row', () => {
    // 5 single-tile zones along a road. The seeded jobs-source building below
    // claims id=999 and advances `nextId`, so the residential spawns get ids
    // 1000-1004. stagger is mod 7 so some of those collide, but the assertion
    // only needs at least 2 distinct stagger buckets across the 5 buildings.
    // All spawn at level=1 simultaneously on the first growth interval; the next
    // level-up (to level=2) is gated by GROWTH_COOLDOWN_INTERVALS + stagger(id),
    // which is what differentiates the per-building first-level-2 ticks.
    // Widened to 18 so free 2×2 fire, hospital, AND school stations fit adjacent to the extended road row at the right end.
    const world = new World(18, 12, { regenerate: false });
    const map = world.getMap();
    // Road along the top row
    for (let x = 0; x < 18; x++) {
      map.setTile(x, 0, createTile(x, 0, TileType.ROAD));
    }
    // 5 zones below the road — all road-adjacent
    for (let x = 0; x < 5; x++) {
      map.setTile(x, 1, createTile(x, 1, TileType.ZONE_RESIDENTIAL));
    }
    // Add extra zone types near each residential for diversity score
    for (let x = 0; x < 5; x++) {
      map.setTile(x, 2, createTile(x, 2, TileType.ZONE_COMMERCIAL));
    }
    // Job bank on the SAME road row the five R lots front (x=6..17, ids 999–1010), each
    // frontage 'W' so its access node is the road cell to its west — jobs on an isolated road
    // are unreachable and would leave residential demand at 0.00. Sitting on ROAD tiles keeps
    // them out of the zone-growth loop, and a road cell's land value (0.40, distance 0)
    // supports level 2 forever, so the sweep never abandons them. 12 × 20 = 240 jobs against
    // at most 150 workers (five lots reach level 3 within the 20 growth intervals below), i.e.
    // always well over the 30-unit surplus that saturates the residential bar.
    for (let x = 6; x < 18; x++) {
      expect(map.getBuildings().addExistingBuilding({
        id: 993 + x,
        type: 'commercial',
        footprint: [{ x, y: 0 }],
        anchor: { x, y: 0 },
        level: 2,
        density: 0,
        age: 0,
        abandoned: false,
        frontage: 'W',
        structureRect: { x, y: 0, w: 1, h: 1 },
      })).toBe(true);
    }
    seedPower(world, 8, 1); // plant at (8,1)–(9,2); cell (8,1) adj to road (8,0) → all road y=0 powered
    // Decision-A: water gates level-up. Add tower adj to road y=0 so all 5 buildings can level up.
    seedWater(world, 6, 1); // tower at (6,1)–(7,2); cell (6,1) adj to road (6,0) → waters road y=0
    // Service coverage gates level-up too. Station at (10,1)–(11,2); cell (10,1) adj to road (10,0)
    // → covers road y=0 → off-road frontage covers all 5 residential anchors at y=1.
    seedPolice(world, 10, 1);
    // Fire coverage gates level-up too. Station at (12,1)–(13,2); cell (12,1) adj to road (12,0)
    // → covers road y=0 → off-road frontage covers all 5 residential anchors at y=1.
    seedFire(world, 12, 1);
    // Hospital coverage gates level-up too. Station at (14,1)–(15,2); cell (14,1) adj to road (14,0)
    // → covers road y=0 → off-road frontage covers all 5 residential anchors at y=1.
    seedHospital(world, 14, 1);
    // School coverage gates level-up too. Station at (16,1)–(17,2); cell (16,1) adj to road (16,0)
    // → covers road y=0 → off-road frontage covers all 5 residential anchors at y=1.
    seedSchool(world, 16, 1);
    // All 5 residential anchors are fire-, hospital-, and school-covered (sample the closest and farthest).
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(4, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(4, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(4, 1)).toBeGreaterThan(0);
    // The five lots are still empty here, so the bank's jobs are not yet reachable from any
    // origin; assert the open gate the first growth pass will actually see.
    world.recomputeLabor();
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThan(0);

    const firstLevelTwoTick = new Map<number, number>();

    // Run enough ticks: spawn at growth tick 1; first level-2 hits at
    // GROWTH_COOLDOWN_INTERVALS+stagger growth intervals later. Max stagger=6 →
    // max cooldown=14. 20 growth intervals covers all.
    for (let tick = 1; tick <= ZONE_GROWTH_INTERVAL * 20; tick++) {
      const result = world.tick();
      for (const id of result.changedBuildingIds) {
        const b = map.getBuildings().getBuilding(id);
        if (b && b.level === 2 && !firstLevelTwoTick.has(id)) {
          firstLevelTwoTick.set(id, tick);
        }
      }
    }

    // At least 2 distinct first-level-2 ticks across the 5 buildings
    expect(new Set(firstLevelTwoTick.values()).size).toBeGreaterThanOrEqual(2);
  });
});

describe('growthConstants', () => {
  it('stagger(0) returns a value in [0, 6]', () => {
    const val = stagger(0);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(6);
  });

  it('stagger(1) returns a value in [0, 6]', () => {
    const val = stagger(1);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(6);
  });

  it('stagger(2) returns a value in [0, 6]', () => {
    const val = stagger(2);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(6);
  });

  it('stagger(0xFFFFFFFF) returns a value in [0, 6]', () => {
    const val = stagger(0xFFFFFFFF);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(6);
  });

  it('GROWTH_COOLDOWN_INTERVALS is 8', () => {
    expect(GROWTH_COOLDOWN_INTERVALS).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Task 4 (T6): structure-grow branch B'
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Power + StructureMap wiring into World
// ---------------------------------------------------------------------------

describe('World.getPowerMap() — lazy allocation', () => {
  it('first call returns a non-null PowerMap instance', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getPowerMap()).not.toBeNull();
  });

  it('subsequent calls return the same instance', () => {
    const world = new World(4, 4, { regenerate: false });
    const first = world.getPowerMap();
    const second = world.getPowerMap();
    expect(second).toBe(first);
  });
});

describe('World.markPowerDirty() + recomputePowerIfDirty()', () => {
  it('recomputePowerIfDirty() after markPowerDirty() triggers recompute exactly once; second call is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputePower');

    world.markPowerDirty();
    world.recomputePowerIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    // No further dirty mark — second call is a no-op.
    world.recomputePowerIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});

describe('World.reset() — power and structure cleanup', () => {
  it('clears getStructureMap().getAllStructures() to empty AND zeroes getPowerMap().getRaw() AND clears the dirty flag', () => {
    const world = new World(4, 4, { regenerate: false });

    // Populate the StructureMap.
    world.getStructureMap().addStructure({
      type: 'power_plant',
      anchor: { x: 0, y: 0 },
      footprint: [
        { x: 0, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: 1 }, { x: 1, y: 1 },
      ],
    });
    // Trigger a power recompute so the backing array is non-zero somewhere.
    world.recomputePower();
    world.markPowerDirty();

    world.reset({ regenerate: false });

    expect(world.getStructureMap().getAllStructures()).toHaveLength(0);

    const raw = world.getPowerMap().getRaw();
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBe(0);
    }

    // Dirty flag is cleared: a recomputePowerIfDirty call should be a no-op.
    const spy = vi.spyOn(world, 'recomputePower');
    world.recomputePowerIfDirty();
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });
});

describe('World.tick() — power periodic cadence', () => {
  it('at tickCount === POWER_INTERVAL, tick() triggers recomputePower even when powerDirty is false', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputePower');

    // Advance to one tick before the cadence fires.
    for (let i = 0; i < POWER_INTERVAL - 1; i++) world.tick();
    const callsBefore = spy.mock.calls.length;

    // This tick brings tickCount to POWER_INTERVAL — force recompute fires.
    world.tick();
    expect(spy.mock.calls.length).toBe(callsBefore + 1);

    spy.mockRestore();
  });
});

describe('World.reset({ regenerate: true }) — isPowered returns false everywhere after reset', () => {
  it('isPowered returns false everywhere even if the prior world had powered cells', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();

    // Place a power plant and a road so some cells become powered.
    world.getStructureMap().addStructure({
      type: 'power_plant',
      anchor: { x: 0, y: 0 },
      footprint: [
        { x: 0, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: 1 }, { x: 1, y: 1 },
      ],
    });
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));
    world.recomputePower();

    // Confirm at least one cell is powered before reset.
    expect(world.getPowerMap().isPowered(2, 0)).toBe(true);

    world.reset({ regenerate: true });

    // After reset, isPowered must return false for every cell.
    const pm = world.getPowerMap();
    const w = world.getMap().getWidth();
    const h = world.getMap().getHeight();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        expect(pm.isPowered(x, y)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// WaterMap API on World
// ---------------------------------------------------------------------------

describe('World.getWaterMap() — lazy allocation', () => {
  it('first call returns a non-null WaterMap instance', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getWaterMap()).not.toBeNull();
  });

  it('subsequent calls return the same instance', () => {
    const world = new World(4, 4, { regenerate: false });
    const first = world.getWaterMap();
    const second = world.getWaterMap();
    expect(second).toBe(first);
  });
});

describe('World.markWaterDirty() + recomputeWaterIfDirty()', () => {
  it('recomputeWaterIfDirty() after markWaterDirty() triggers recompute exactly once; second call is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeWater');

    world.markWaterDirty();
    world.recomputeWaterIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    // No further dirty mark — second call is a no-op.
    world.recomputeWaterIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});

describe('World.reset() — water cleanup', () => {
  it('zeroes getWaterMap().getRaw() AND clears the dirty flag after reset', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();

    // Place a tower and a road so some cells become watered.
    world.getStructureMap().addStructure({
      type: 'water_tower',
      anchor: { x: 0, y: 0 },
      footprint: [
        { x: 0, y: 0 },
      ],
    });
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));
    world.recomputeWater();
    world.markWaterDirty();

    world.reset({ regenerate: false });

    const raw = world.getWaterMap().getRaw();
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBe(0);
    }

    // Dirty flag is cleared: a recomputeWaterIfDirty call should be a no-op.
    const spy = vi.spyOn(world, 'recomputeWater');
    world.recomputeWaterIfDirty();
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });
});

describe('World.tick() — water periodic cadence', () => {
  it('at tickCount === WATER_INTERVAL, tick() triggers recomputeWater even when waterDirty is false', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeWater');

    // Advance to one tick before the cadence fires.
    for (let i = 0; i < WATER_INTERVAL - 1; i++) world.tick();
    const callsBefore = spy.mock.calls.length;

    // This tick brings tickCount to WATER_INTERVAL — force recompute fires.
    world.tick();
    expect(spy.mock.calls.length).toBe(callsBefore + 1);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// ServiceCoverageMap API on World (lifecycle/cadence only — gate lands in Task 5)
// ---------------------------------------------------------------------------

describe('World.getServiceCoverageMap() — lazy allocation', () => {
  it('first call returns a non-null ServiceCoverageMap instance', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getServiceCoverageMap()).not.toBeNull();
  });

  it('subsequent calls return the same instance', () => {
    const world = new World(4, 4, { regenerate: false });
    const first = world.getServiceCoverageMap();
    const second = world.getServiceCoverageMap();
    expect(second).toBe(first);
  });
});

describe('World.markServiceDirty() + recomputeServiceIfDirty()', () => {
  it('recomputeServiceIfDirty() after markServiceDirty() triggers recompute exactly once; second call is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeService');

    world.markServiceDirty();
    world.recomputeServiceIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    // No further dirty mark — second call is a no-op.
    world.recomputeServiceIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('markServiceDirty() + tick() recomputes the coverage map so a police station covers an adjacent road', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    // Police station 2×2 at (2,2)–(3,3); road at (2,4) adjacent to the station's south edge.
    world.getStructureMap().addStructure({
      type: 'police_station',
      anchor: { x: 2, y: 2 },
      footprint: [
        { x: 2, y: 2 }, { x: 3, y: 2 },
        { x: 2, y: 3 }, { x: 3, y: 3 },
      ],
    });
    map.setTile(2, 4, createTile(2, 4, TileType.ROAD));

    // Before any recompute the coverage map is empty.
    expect(world.getServiceCoverageMap().getCoverage(2, 4)).toBe(0);

    world.markServiceDirty();
    world.tick();

    // The road adjacent to the station now carries coverage.
    expect(world.getServiceCoverageMap().getCoverage(2, 4)).toBeGreaterThan(0);
  });
});

describe('World.reset() — service coverage cleanup', () => {
  it('zeroes getServiceCoverageMap().getRaw() AND clears the dirty flag after reset', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();

    // Place a station and a road so some cells gain coverage.
    world.getStructureMap().addStructure({
      type: 'police_station',
      anchor: { x: 0, y: 0 },
      footprint: [
        { x: 0, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: 1 }, { x: 1, y: 1 },
      ],
    });
    map.setTile(0, 2, createTile(0, 2, TileType.ROAD));
    world.recomputeService();
    world.markServiceDirty();

    world.reset({ regenerate: false });

    const raw = world.getServiceCoverageMap().getRaw();
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBe(0);
    }

    // Dirty flag is cleared: a recomputeServiceIfDirty call should be a no-op.
    const spy = vi.spyOn(world, 'recomputeService');
    world.recomputeServiceIfDirty();
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });
});

describe('World.reset() — land value recompute (B1\' cascade)', () => {
  it('drops the stale pre-reset land value: anchor reflects service coverage before reset, drops after', () => {
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    // Road row + a zone anchor at (0,1) fully covered by the four stations.
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    seedPolice(world, 0, 3);
    seedHospital(world, 2, 3);
    seedFire(world, 3, 0);
    seedSchool(world, 5, 0);
    world.recomputeLandValue();
    const beforeReset = world.getLandValue().getValue(0, 1);
    // Service term (weight 0.50) lifts the anchor well above a road-only baseline (≈0.34).
    expect(beforeReset).toBeGreaterThan(0.5);

    world.reset({ regenerate: false });

    // After reset, structures are gone → coverage is zero → the land value must reflect
    // the fresh (empty) world, NOT the stale high pre-reset value.
    const afterReset = world.getLandValue().getValue(0, 1);
    expect(afterReset).toBeLessThan(beforeReset);
  });
});

describe('World.tick() — service coverage periodic cadence', () => {
  it('at tickCount === SERVICE_INTERVAL, tick() triggers recomputeService even when serviceDirty is false', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeService');

    // Advance to one tick before the cadence fires.
    for (let i = 0; i < SERVICE_INTERVAL - 1; i++) world.tick();
    const callsBefore = spy.mock.calls.length;

    // This tick brings tickCount to SERVICE_INTERVAL — force recompute fires.
    world.tick();
    expect(spy.mock.calls.length).toBe(callsBefore + 1);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Water gate semantics (Major-5): unwatered buildings STILL AGE but don't grow
// ---------------------------------------------------------------------------

describe('World.tick() water gate — level-up/density/merge gated, spawn and aging NOT gated', () => {
  it('(a) powered-but-unwatered building STILL AGES but does NOT level up', () => {
    // After the police+fire+hospital+school gate, water must be the SOLE blocker: seed all four
    // coverage services reaching the anchor while keeping the building unwatered (no tower).
    // Layout (14×10): top road ROW y=0 (x=0..13). Building (0,1) frontage N adj to road (0,0)
    // → road access + anchor (0,1) off-road at offDist 1. Five 2×2 structures hang off the
    // road row at y=1 in DISJOINT x-ranges: hospital (3,1), power (5,1), police (7,1), fire (9,1), school (11,1).
    const world = new World(14, 10, { regenerate: false });
    const map = world.getMap();
    // Top road row.
    for (let x = 0; x < 14; x++) map.setTile(x, 0, createTile(x, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    // Zone diversity for land value.
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_INDUSTRIAL));
    // Hospital (3,1)–(4,2); cell (3,1) adj road (3,0). Powers/covers via the connected road row.
    seedHospital(world, 3, 1);
    // Power plant (5,1)–(6,2); cell (5,1) adj road (5,0) → powers the road row → road (0,0) → building (0,1).
    seedPower(world, 5, 1);
    // Police (7,1)–(8,2); cell (7,1) adj road (7,0). Fire (9,1)–(10,2); cell (9,1) adj road (9,0).
    seedPolice(world, 7, 1);
    seedFire(world, 9, 1);
    // School (11,1)–(12,2); cell (11,1) adj road (11,0) → covers the road row → anchor (0,1).
    // Seeded so school is SATISFIED and water remains the SOLE blocker.
    seedSchool(world, 11, 1);

    // Seed a level-1 building ready to level up: age just below cooldown.
    const cooldown = GROWTH_COOLDOWN_INTERVALS; // stagger(0) = 0 for id 0
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown - 1, // next growth tick will age → cooldown met
      abandoned: false,
      frontage: 'N',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;
    // Confirm building's footprint cell is powered (not just the road), and not watered.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(false);
    // All four services reach the anchor — water is the SOLE blocker.
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);

    // Run enough growth ticks for the building to age significantly.
    const GROWTH_TICKS = 5;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * GROWTH_TICKS; i++) world.tick();

    const after = map.getBuildings().getBuilding(bid);
    expect(after).not.toBeNull();
    // Level must NOT have increased (water gate blocked it).
    expect(after!.level).toBe(1);
    // Age MUST have increased (aging is NOT water-gated).
    expect(after!.age).toBeGreaterThan(cooldown - 1);
  });

  it('(b) once watered, the same building levels up given demand/land-value/cooldown satisfied', () => {
    // Layout (10x8): road row at y=2. Zone (0,1)=RESIDENTIAL frontage S adj to road (0,2).
    // Diversity: (1,1)=COMMERCIAL, (0,0)=INDUSTRIAL in 3×3 window. With the four services
    // also feeding land value (weight 0.50), LV(0,1) is comfortably above the level-2 gate (0.25).
    // Plant at (4,3)–(5,4) adj to road (4,2) → powers road row.
    // Tower at (7,3)–(8,4) adj to road (7,2) → waters road row.
    // Building at (0,1) is powered and watered. With age past cooldown and demand positive,
    // the building should level up within a few growth ticks.
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    // Service coverage now gates level-up too — station at (1,3)–(2,4); cell (1,3) adj to road (1,2).
    seedPolice(world, 1, 3);
    // Fire coverage ALSO gates level-up — station at (8,3)–(9,4); cell (8,3) adj to road (8,2).
    seedFire(world, 8, 3);
    // Hospital coverage ALSO gates level-up — station at (5,0)–(6,1); cell (5,1) adj to road (5,2).
    seedHospital(world, 5, 0);
    // School coverage ALSO gates level-up — station at (8,0)–(9,1); cell (8,1) adj to road (8,2).
    seedSchool(world, 8, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // age already past cooldown
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Confirm powered, watered, and covered.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);

    // Run growth ticks — with water and coverage present, building should level up.
    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    expectRoadRowJobsAlive(world);
    expect(map.getBuildings().getBuilding(bid)?.level).toBeGreaterThan(1);
  });

  it('(c) spawn is NOT water-gated: powered road-adjacent unwatered zone tile STILL spawns level-1 building', () => {
    const world = new World(10, 10, { regenerate: false });
    const map = world.getMap();
    // Road + zone + power (no water tower).
    map.setTile(0, 0, createTile(0, 0, TileType.ROAD));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 2, 0);
    // No job source: with no buildings at all the labor market is empty and residential demand
    // is the bootstrap 1.0, which is exactly what a pure spawn fixture needs. A source could not
    // help anyway — with no residential origin, reachableUnfilledJobs is structurally 0.

    // Confirm NOT watered.
    expect(world.getWaterMap().isWatered(0, 1)).toBe(false);

    // Run growth ticks: spawn should happen despite no water.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();

    // A building should have spawned at (0,1).
    expect(map.getBuildings().getBuildingAt(0, 1)).not.toBeNull();
    expect(map.getBuildings().getBuildingAt(0, 1)?.level).toBe(1);
  });

  // Two separate it-blocks for the merge water gate (no if-guards around assertions).
  // (d-neg) carries its own layout — see the coordinate list in that test. The sketch below
  // is (d-pos)'s.
  //
  // Layout:
  //   Building A: 2-wide 1-deep lot at (5,2),(6,2), frontage 'S'. South face road: (5,3),(6,3).
  //   Building B: 2-wide 1-deep lot at (7,2),(8,2), frontage 'S'. South face road: (7,3),(8,3) BUT
  //     (7,3)=GRASS in the negative scenario — only (8,3) is road for B, giving ≥1 road on face ✓.
  //   canMerge geometry: same frontage 'S', h=1=h, A.x+w=5+2=7=B.x, A.y+h=3=B.y+h → all pass.
  //   Road A: (5,3),(6,3). Road B (negative): (8,3) isolated by GRASS at (7,3).
  //   Power A: plant (3,3)–(4,4); cell (4,3) adj (5,3)=ROAD A → seeds A network.
  //   Power B: plant (9,2)–(10,3); cell (9,3) adj (8,3)=ROAD B → seeds B.
  //   Water (negative): tower (5,4) (1×1); (5,4) adj (5,3)=ROAD A → BFS seeds A network ((5,3)→(6,3) via road),
  //     stops at GRASS (7,3). B road (8,3) unreachable → B NOT watered.
  //   Water (positive): (7,3) is ROAD (gap filled); same tower waters full (5,3)→(8,3) row.

  it('(d-neg) merge water gate — one unwatered candidate: no merge (asserts unconditionally)', () => {
    // NEGATIVE: two BUILT-OUT lots sit on two road components that share no orthogonal ROAD
    // chain, and only the western one has a water source — water is the sole variable. Both
    // probes are at ZONE_MAX_LEVEL, at density 2 (maxDensityForLot for their 2-wide lots) and
    // carry a structureRect that already fills their 1-deep lot, so every rung of canMerge's
    // built-out gate is satisfied. Everything else (power, all four coverages, land value ≥
    // LEVEL_THRESHOLDS[5], reachable jobs) is satisfied on BOTH sides too, so neither probe can
    // be frozen by the abandonment sweep and make "no merge" true for the wrong reason.
    //
    // ROAD tiles — these and no others: (0,5)…(11,5) = component A, (12,5) GRASS (the gap),
    // (13,5)…(23,5) = component B. Row 5 holds every road on the map, so no orthogonal chain
    // joins A to B; structures are excluded from the water/power BFS and only SEED it from an
    // adjacent road cell, so none of the placements below can bridge them either.
    const world = new World(24, 12, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x <= 11; x++) map.setTile(x, 5, createTile(x, 5, TileType.ROAD));
    for (let x = 13; x <= 23; x++) map.setTile(x, 5, createTile(x, 5, TileType.ROAD));

    // Probes: A on component A, B on component B, geometrically merge-eligible
    // (11+2 === 13, equal depth, shared frontage edge at y+h = 5, merged width 4).
    for (const x of [11, 12, 13, 14]) map.setTile(x, 4, createTile(x, 4, TileType.ZONE_RESIDENTIAL));

    // Component A: power plant seeding (0,5), the four stations, a 1×1 water tower whose only
    // ROAD neighbour is (10,5) ∈ A, and a park north of anchor A.
    seedPower(world, 0, 6);
    seedPolice(world, 2, 6);
    seedFire(world, 4, 6);
    seedHospital(world, 6, 6);
    seedSchool(world, 8, 6);
    seedWater(world, 10, 6);
    expect(world.getStructureMap().addStructure({ type: 'park', anchor: { x: 11, y: 3 }, footprint: [{ x: 11, y: 3 }] })).not.toBeNull();

    // Component B: its own power and its own four stations — no 2×2 footprint can touch a road
    // cell of both components across the (12,5) gap, and coverage is not water, so the second
    // set bridges nothing. NO water source on B: that omission is the test's sole variable.
    seedPolice(world, 13, 6);
    seedFire(world, 15, 6);
    seedHospital(world, 17, 6);
    seedSchool(world, 19, 6);
    seedPower(world, 21, 6);
    expect(world.getStructureMap().addStructure({ type: 'park', anchor: { x: 13, y: 3 }, footprint: [{ x: 13, y: 3 }] })).not.toBeNull();

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    // Jobs bank, part 1: four level-4 commercials on GRASS at y=4, each a 2-wide 1-deep lot
    // fronting the A road directly below it → buildingCapacity = 2·1·4·5 = 40 each, 160 jobs.
    // Level 4, not 5: those anchors reach lv ≈ 0.78 (road + service, no park in range), which
    // clears LEVEL_THRESHOLDS[4] = 0.65 but not [5] = 0.85, so a level-5 bank would abandon on
    // the first sweep. Grass tiles keep the bank out of the zone loop, so it never ages, levels
    // or merges. Widening (rather than deepening northward) keeps each anchor's road distance —
    // and therefore its land value — unchanged.
    for (const [i, x] of [2, 4, 6, 8].entries()) {
      expect(map.getBuildings().addExistingBuilding({
        id: 900 + i, type: 'commercial',
        footprint: [{ x, y: 4 }, { x: x + 1, y: 4 }], anchor: { x, y: 4 },
        level: 4, density: 0, age: 0, abandoned: false, frontage: 'S',
        structureRect: { x, y: 4, w: 2, h: 1 },
      })).toBe(true);
    }
    // Jobs bank, part 2: the built-out probes carry 2·1·5·10 = 100 workers EACH, and probe B's
    // 100 are stranded on component B with no job in reach, so unemployment is pinned at 100 of
    // a 200 workforce — a 50% rate that damps migration to exactly 0. Residential demand can
    // therefore only come from a net vacancy surplus past the deadband, and 160 jobs alone give
    // net = (160 − 100) − 100 < 0. One more level-4 commercial takes the bank to 240: a 1-wide,
    // 4-deep lot on the GRASS south of the A road at column 11 → buildingCapacity = 1·4·4·5 = 80.
    // Column 11 is the ONLY column free there — the plant owns 0–1, the four stations 2–9 and the
    // water tower (10,6) — and column 12 has no road on its frontage face (that is the gap).
    // Result: employed 100, reachable 140, net 40 on a market of 340 → residential ≈ 0.34.
    // NEW LOT SHAPE, so its anchor land value is re-derived rather than inherited: (11,6) reads
    // 0.40 · 6/7 (road (11,5) at Chebyshev 1) + 0.10 · 0 (no zone tile in the 3×3) + 0.50 · ~0.79
    // (four A stations, road-hop distances 2/4/6/8) + 0.25 · 2/5 (park (11,3) at Chebyshev 3)
    // = 0.839 — over LEVEL_THRESHOLDS[4] = 0.65 and under [5] = 0.85, so level 4 survives the
    // sweep and level 5 would not. Its survival is load-bearing; pinned after the tick below.
    expect(map.getBuildings().addExistingBuilding({
      id: 910, type: 'commercial',
      footprint: [{ x: 11, y: 6 }, { x: 11, y: 7 }, { x: 11, y: 8 }, { x: 11, y: 9 }],
      anchor: { x: 11, y: 6 },
      level: 4, density: 0, age: 0, abandoned: false, frontage: 'N',
      structureRect: { x: 11, y: 6, w: 1, h: 4 },
    })).toBe(true);

    // Density 2 is maxDensityForLot for a 2-wide lot, and the 2×1 structureRect already fills the
    // 1-deep lot, so both probes are BUILT OUT — canMerge's density and extend gates pass and the
    // water gate is the only thing left that can block them. Capacity 2·1·5·10 = 100 each.
    const okA = map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential',
      footprint: [{ x: 11, y: 4 }, { x: 12, y: 4 }], anchor: { x: 11, y: 4 },
      level: ZONE_MAX_LEVEL, density: 2, age: cooldown + 10, abandoned: false, frontage: 'S',
      structureRect: { x: 11, y: 4, w: 2, h: 1 },
    });
    const okB = map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 13, y: 4 }, { x: 14, y: 4 }], anchor: { x: 13, y: 4 },
      level: ZONE_MAX_LEVEL, density: 2, age: cooldown + 10, abandoned: false, frontage: 'S',
      structureRect: { x: 13, y: 4, w: 2, h: 1 },
    });
    expect(okA).toBe(true);
    expect(okB).toBe(true);
    world.markLandValueDirty();
    world.recomputeLandValue();
    world.markDemandDirty();
    world.recomputeLabor();

    // Water: the disconnect, and the only difference between the two components.
    expect(world.getWaterMap().isWatered(11, 5)).toBe(true);
    expect(world.getWaterMap().isWatered(11, 4)).toBe(true);
    expect(world.getWaterMap().isWatered(13, 5)).toBe(false);
    expect(world.getWaterMap().isWatered(13, 4)).toBe(false);
    // Everything else the sweep and the merge pass read is satisfied on BOTH anchors.
    expect(world.getPowerMap().isPowered(11, 4)).toBe(true);
    expect(world.getPowerMap().isPowered(13, 4)).toBe(true);
    for (const a of [{ x: 11, y: 4 }, { x: 13, y: 4 }]) {
      expect(world.getServiceCoverageMap().getCoverage(a.x, a.y)).toBeGreaterThanOrEqual(SERVICE_COVERAGE_THRESHOLD_RAW);
      expect(world.getFireCoverageMap().getCoverage(a.x, a.y)).toBeGreaterThanOrEqual(SERVICE_COVERAGE_THRESHOLD_RAW);
      expect(world.getHospitalCoverageMap().getCoverage(a.x, a.y)).toBeGreaterThanOrEqual(SERVICE_COVERAGE_THRESHOLD_RAW);
      expect(world.getSchoolCoverageMap().getCoverage(a.x, a.y)).toBeGreaterThanOrEqual(SERVICE_COVERAGE_THRESHOLD_RAW);
      expect(world.getLandValue().getValue(a.x, a.y)).toBeGreaterThanOrEqual(LEVEL_THRESHOLDS[5]);
    }
    for (const id of [0, 1]) expect(buildingCapacity(map.getBuildings().getBuilding(id)!)).toBe(100);
    // 240 jobs on A, 100 of them filled by probe A's workers; probe B's 100 reach none.
    expect(world.getLaborMarket().getReachableUnfilledJobs()).toBe(140);
    expect(world.getLaborMarket().getUnemployed()).toBe(100);
    // Demand positivity is a PRECONDITION here, not an outcome: with it, "no merge" can only be
    // the water gate. The merge gate keys on GROWTH_DEMAND_THRESHOLD now, not on a density spike.
    expect(world.getDemand().residential).toBeGreaterThan(GROWTH_DEMAND_THRESHOLD);

    // One growth tick. B unwatered → merge water gate blocks → both buildings survive.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    world.tick();

    // Unconditional — no if-guard.
    expect(map.getBuildings().getBuilding(0)).not.toBeNull();
    expect(map.getBuildings().getBuilding(1)).not.toBeNull();
    // Neither probe was frozen by the abandonment sweep, and neither could have moved off its
    // seeded state (both already sit at their lot's density cap), so "no merge" can only be the
    // water gate.
    expect(map.getBuildings().getBuilding(0)!.abandoned).toBe(false);
    expect(map.getBuildings().getBuilding(1)!.abandoned).toBe(false);
    expect(map.getBuildings().getBuilding(0)!.density).toBe(2);
    expect(map.getBuildings().getBuilding(1)!.density).toBe(2);
    // ...and the part-2 bank lot that carries the demand argument is still occupied, so the
    // vacancy surplus the precondition measured was still there when the merge pass ran. Were it
    // abandoned the bank would fall 240 → 160 jobs, net would go negative and residential to 0,
    // and "no merge" would become attributable to the DEMAND gate instead of the water gate.
    expect(map.getBuildings().getBuilding(910)!.abandoned).toBe(false);
  });

  it('(d-pos) merge water gate — both candidates watered: merge succeeds (asserts unconditionally)', () => {
    // POSITIVE: (7,3) is now ROAD (gap filled) → A+B connected → tower waters both → merge fires.
    // Taller/wider (16×12) so the built-out merge candidates can be fully served (not abandoned)
    // via stations hung off a full-width frontage road, with jobs from a bank that fronts that
    // SAME road — leaving water the sole merge variable. Both probe anchors read 0.933 at seed
    // and still 0.933 through the single growth tick this test runs, because land value is only
    // recomputed against a REFRESHED traffic map on the TRAFFIC_INTERVAL cadence, which tick 8
    // does not reach. Fold this fixture's post-merge commute load in and they read 0.865 at
    // (5,2) and 0.875 at (7,2) — still over LEVEL_THRESHOLDS[5], but by 0.015 rather than the
    // 0.08 the pre-density-2 fixture had. Raising the probes past 2·1·5·10 = 100 workers each
    // would spend that margin: their whole workforce leaves from one access node
    // (roadGraph.accessNodeFor), so the byte on it — 102 here — scales with capacity.
    const world = new World(16, 12, { regenerate: false });
    const map = world.getMap();

    map.setTile(5, 2, createTile(5, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(6, 2, createTile(6, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(7, 2, createTile(7, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(8, 2, createTile(8, 2, TileType.ZONE_RESIDENTIAL));
    // Full-width frontage road at y=3 (single connected component for the merge candidates).
    for (let x = 0; x < 16; x++) map.setTile(x, 3, createTile(x, 3, TileType.ROAD));
    // Four services hung off the frontage road (y=4) → coverage reaches the y=2 anchors.
    seedPolice(world, 0, 4);
    seedFire(world, 2, 4);
    seedHospital(world, 10, 4);
    seedSchool(world, 12, 4);
    // Plant at (14,4)–(15,5); (14,4) adj road (14,3) → powers the frontage road.
    seedPower(world, 14, 4);
    // Tower (5,4) (1×1) adj road (5,3) → BFS reaches (5,3)→(8,3); all anchors watered.
    seedWater(world, 5, 4);
    // Park north of the merge candidates → final additive boost so lv ≥ 0.85 (not abandoned).
    world.getStructureMap().addStructure({ type: 'park', anchor: { x: 6, y: 0 }, footprint: [{ x: 6, y: 0 }] });

    // Unconditional precondition pins.
    expect(world.getWaterMap().isWatered(8, 3)).toBe(true);  // B road watered (connected now)
    expect(world.getWaterMap().isWatered(8, 2)).toBe(true);  // B footprint cell watered
    expect(world.getWaterMap().isWatered(5, 2)).toBe(true);  // A footprint cell watered

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    // Jobs bank: five level-4 commercials on GRASS at y=4, frontage 'N' onto the shared y=3
    // road, so their jobs are reachable from both probes' access nodes. The two BUILT-OUT probes
    // supply 2 × 100 = 200 workers and every job is reachable, so a bank of J jobs leaves
    // employed = min(200, J): J must exceed 200 just to zero out unemployment and let the 0.1
    // migration floor hold residential demand positive at all. Each bank lot is 1 wide × 3 deep
    // (rows 4–6) → buildingCapacity = 1·3·4·5 = 60, and five of them (columns 4, 6, 7, 8, 9 —
    // the stations, the plant and the water tower own the rest) give J = 300: employed 200,
    // reachable 100, net 100 on a market of 300 → residential saturates at 1.0. Level 4 (not 5)
    // because those anchors reach lv ≈ 0.80 — over LEVEL_THRESHOLDS[4] = 0.65 but under
    // [5] = 0.85, so a level-5 bank would abandon on the first sweep and take the demand with it.
    // The lots extend SOUTH (not north), which keeps the frontage-'N' anchor on row 4 and
    // therefore its distance to the y=3 road — and its land value — unchanged.
    for (const x of [4, 6, 7, 8, 9]) {
      expect(map.getBuildings().addExistingBuilding({
        id: 900 + x, type: 'commercial',
        footprint: [{ x, y: 4 }, { x, y: 5 }, { x, y: 6 }], anchor: { x, y: 4 },
        level: 4, density: 0, age: 0, abandoned: false, frontage: 'N',
        structureRect: { x, y: 4, w: 1, h: 3 },
      })).toBe(true);
    }

    // Density 2 is maxDensityForLot for a 2-wide lot, and the 2×1 structureRect already fills the
    // 1-deep lot, so both probes are BUILT OUT — every rung of canMerge's built-out gate passes
    // and water is the only variable left. Capacity 2·1·5·10 = 100 each.
    const okA = map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential',
      footprint: [{ x: 5, y: 2 }, { x: 6, y: 2 }], anchor: { x: 5, y: 2 },
      level: ZONE_MAX_LEVEL, density: 2, age: cooldown + 10, abandoned: false, frontage: 'S',
      structureRect: { x: 5, y: 2, w: 2, h: 1 },
    });
    const okB = map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 7, y: 2 }, { x: 8, y: 2 }], anchor: { x: 7, y: 2 },
      level: ZONE_MAX_LEVEL, density: 2, age: cooldown + 10, abandoned: false, frontage: 'S',
      structureRect: { x: 7, y: 2, w: 2, h: 1 },
    });
    expect(okA).toBe(true);
    expect(okB).toBe(true);
    world.markLandValueDirty();
    world.recomputeLandValue();
    world.markDemandDirty();
    world.recomputeLabor();
    for (const id of [0, 1]) expect(buildingCapacity(map.getBuildings().getBuilding(id)!)).toBe(100);
    // Anchor pin, matching (d-neg)'s: below this the sweep would freeze both probes and "merge
    // fires" could never be attributed to water.
    for (const a of [{ x: 5, y: 2 }, { x: 7, y: 2 }]) {
      expect(world.getLandValue().getValue(a.x, a.y)).toBeGreaterThanOrEqual(LEVEL_THRESHOLDS[5]);
    }
    // 300 jobs, all reachable, against 200 workers.
    expect(world.getLaborMarket().getReachableUnfilledJobs()).toBe(100);
    expect(world.getLaborMarket().getUnemployed()).toBe(0);
    // Demand positivity is a PRECONDITION here, not an outcome: with it, the merge firing can
    // only be the water gate opening. The merge gate keys on GROWTH_DEMAND_THRESHOLD now.
    expect(world.getDemand().residential).toBeGreaterThan(GROWTH_DEMAND_THRESHOLD);

    // One growth tick. Both watered → merge fires.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    world.tick();

    // Unconditional: at least one original gone, merged 4-cell building exists.
    const aGone = map.getBuildings().getBuilding(0) === null;
    const bGone = map.getBuildings().getBuilding(1) === null;
    expect(aGone || bGone).toBe(true);
    const allRes = [...map.getBuildings().iterBuildings()].filter(b => b.type === 'residential');
    expect(allRes.some(b => b.footprint.length === 4)).toBe(true);
  });

  it('(e) density-bump requires water: unwatered building does NOT get density bump; watered does', () => {
    // Two-phase test mirroring test (b). Water is the SOLE variable: demand is satisfied throughout.
    // Layout (10×8, road row at y=2): building at (0,1) frontage 'S' adj to road (0,2).
    // Demand source: two level-4 commercials fronting the same road row as the probe (below).
    // Power: plant at (4,3)–(5,4) adj to road (4,2). No tower initially → not watered.
    // Phase 1: run ticks WITHOUT water → density stays 0, age increases (not water-gated).
    // Phase 2: add tower (7,3) (1×1) adj road (7,2) → building watered → density bumps to 1.
    // Taller/wider (12×12) so the residential anchor can be fully served (lv ≈ 0.97 → not
    // abandoned) AND a reachable jobs bank fits on the same road row, leaving WATER as the
    // sole variable for the density bump.
    const world = new World(12, 12, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 12; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    seedPower(world, 10, 3); // plant (10,3)–(11,4); (10,3) adj road (10,2) → powers road row
    // Four services keep the max-level residential out of abandonment (lv ≥ 0.85).
    seedPolice(world, 2, 3);
    seedFire(world, 4, 3);
    seedHospital(world, 6, 3);
    seedSchool(world, 8, 3);
    world.getStructureMap().addStructure({ type: 'park', anchor: { x: 0, y: 0 }, footprint: [{ x: 0, y: 0 }] });

    // Jobs bank: two level-4 commercials on GRASS at (3,1) and (5,1), frontage 'S' onto the
    // y=2 road the probe fronts, so their jobs are reachable from its access node. The level-5
    // probe supplies 50 workers, so for J ≤ 100 the MIN_MARKET floor sets market = 100 and the
    // ratio is (J−50)/100: clearing DENSITY_DEMAND_THRESHOLD needs J ≥ 70 (60 jobs read 0.25,
    // BELOW the gate) and saturating needs J ≥ 80. Two level-4 buildings are exactly 80 — the
    // smallest bank that saturates, so no third seeder is provisioned.
    for (const x of [3, 5]) {
      expect(map.getBuildings().addExistingBuilding({
        id: 800 + x, type: 'commercial',
        footprint: [{ x, y: 1 }], anchor: { x, y: 1 },
        level: 4, density: 0, age: 0, abandoned: false, frontage: 'S',
        structureRect: { x, y: 1, w: 1, h: 1 },
      })).toBe(true);
    }

    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS + 10,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    world.markLandValueDirty();
    world.recomputeLandValue();
    // Assert demand precondition so the test fails loudly if demand (not water) ever becomes the blocker.
    world.markDemandDirty();
    world.recomputeLabor();
    expect(world.getLaborMarket().getReachableUnfilledJobs()).toBeGreaterThan(0);
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    // Phase 1: NOT watered → density must NOT advance.
    expect(world.getWaterMap().isWatered(0, 1)).toBe(false);
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    const mid = map.getBuildings().getBuilding(bid)!;
    expect(mid.density).toBe(0);
    // Age increased — aging is NOT water-gated.
    expect(mid.age).toBeGreaterThan(DENSITY_COOLDOWN_INTERVALS);

    // Phase 2: add tower → building becomes watered → density MUST advance.
    seedWater(world, 11, 1); // tower (11,1) (1×1); (11,1) adj road (11,2) → waters road row
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true); // confirm water reached building
    // Reset age so the next growth tick fires the density gate (age >= DENSITY_COOLDOWN_INTERVALS guaranteed).
    mid.age = DENSITY_COOLDOWN_INTERVALS + 10;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    expect(map.getBuildings().getBuilding(bid)?.density).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Service-coverage gate (police): coverage gates LEVEL-UP ONLY at the anchor.
// Power, water, and land value are satisfied throughout so coverage is the SOLE
// variable. Spawn is NOT coverage-gated (power-only).
// ---------------------------------------------------------------------------

describe('World.tick() service-coverage gate — level-up gated at the anchor; spawn NOT gated', () => {
  it('(a) powered+watered building with fire+hospital but NO police coverage does NOT level up', () => {
    // Layout (10×8): road row y=2. Zone (0,1)=RESIDENTIAL frontage S adj to road (0,2).
    // Diversity: (1,1)=COMMERCIAL, (0,0)=INDUSTRIAL in 3×3 window. Land value (road +
    // diversity + the present services' coverage) stays well above the level-2 gate (0.25);
    // the missing service is the SOLE level-up blocker here, not land value.
    // Plant (4,3)–(5,4) powers the road row; tower (7,3) waters it. Fire (8,3)–(9,4),
    // hospital (5,0)–(6,1), and school (8,0)–(9,1) cover the anchor; NO police station → police is the SOLE blocker.
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    seedFire(world, 8, 3);
    seedHospital(world, 5, 0);
    // School covers the anchor so police stays the SOLE blocker. Station (8,0)–(9,1); cell (8,1) adj road (8,2).
    seedSchool(world, 8, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // past cooldown — only police coverage can block
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Power + water + fire + hospital + school satisfied; police coverage is ZERO — the SOLE blocker.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBe(0);

    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();
    expectRoadRowJobsAlive(world);

    const after = map.getBuildings().getBuilding(bid)!;
    // Level must NOT have increased (police-coverage gate blocked it).
    expect(after.level).toBe(1);
    // Age MUST have increased (aging is NOT coverage-gated).
    expect(after.age).toBeGreaterThan(cooldown + 5);
  });

  it('(b) once a police station covers the anchor, the same building levels up', () => {
    // Identical layout to (a), plus a station at (1,3)–(2,4): cell (1,3) adj to road (1,2)
    // → covers road row → off-road frontage covers the building anchor (0,1).
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    seedPolice(world, 1, 3);
    // Fire coverage ALSO gates level-up — station at (8,3)–(9,4); cell (8,3) adj to road (8,2).
    seedFire(world, 8, 3);
    // Hospital coverage ALSO gates level-up — station at (5,0)–(6,1); cell (5,1) adj to road (5,2).
    seedHospital(world, 5, 0);
    // School coverage ALSO gates level-up — station at (8,0)–(9,1); cell (8,1) adj to road (8,2).
    seedSchool(world, 8, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Power + water + coverage all satisfied at the anchor.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);

    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    expectRoadRowJobsAlive(world);
    expect(map.getBuildings().getBuilding(bid)?.level).toBeGreaterThan(1);
  });

  it('(c) spawn is NOT coverage-gated: a powered road-adjacent zone tile STILL spawns with no station', () => {
    const world = new World(10, 10, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ROAD));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 2, 0);
    // No job source — see the water-gate spawn fixture: an empty labor market bootstraps
    // residential demand to 1.0, and an unreachable source would contribute nothing.

    // No station anywhere — coverage is zero at the seed tile.
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBe(0);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();

    // Spawn fires despite no coverage (spawn is power-only).
    expect(map.getBuildings().getBuildingAt(0, 1)).not.toBeNull();
    expect(map.getBuildings().getBuildingAt(0, 1)?.level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fire-coverage gate: level-up requires police AND fire AND hospital AND school coverage at
// the anchor. Police, hospital, school, power, water, and land value are satisfied
// throughout so fire coverage is the SOLE variable. Spawn is NOT fire-gated.
// ---------------------------------------------------------------------------

describe('World.tick() fire-coverage gate — level-up needs police AND fire AND hospital AND school at the anchor', () => {
  it('with police+hospital but NO fire coverage does NOT level up', () => {
    // Layout (10×8): road row y=2. Zone (0,1)=RESIDENTIAL frontage S adj to road (0,2).
    // Diversity: (1,1)=COMMERCIAL, (0,0)=INDUSTRIAL in 3×3 window. Land value (road +
    // diversity + the present services' coverage) stays well above the level-2 gate (0.25);
    // the missing service is the SOLE level-up blocker here, not land value.
    // Plant (4,3)–(5,4) powers the road row; tower (7,3) waters it. Police (1,3)–(2,4),
    // hospital (5,0)–(6,1), and school (8,0)–(9,1) cover the anchor. NO fire station → fire is the SOLE blocker.
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    seedPolice(world, 1, 3);
    seedHospital(world, 5, 0);
    // School covers the anchor so fire stays the SOLE blocker. Station (8,0)–(9,1); cell (8,1) adj road (8,2).
    seedSchool(world, 8, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // past cooldown — only fire coverage can block
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Power + water + police + hospital + school coverage satisfied; fire coverage is ZERO — the SOLE blocker.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBe(0);

    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();
    expectRoadRowJobsAlive(world);

    const after = map.getBuildings().getBuilding(bid)!;
    // Level must NOT have increased (fire-coverage gate blocked it).
    expect(after.level).toBe(1);
    // Age MUST have increased (aging is NOT coverage-gated).
    expect(after.age).toBeGreaterThan(cooldown + 5);
  });

  it('with all four (police+fire+hospital+school) coverage at the anchor, the building levels up', () => {
    // Identical layout to the negative case, plus a fire station at (8,3)–(9,4), a
    // hospital at (5,0)–(6,1), and a school at (8,0)–(9,1): all reach the road row → off-road frontage covers (0,1).
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    seedPolice(world, 1, 3);
    seedFire(world, 8, 3);
    seedHospital(world, 5, 0);
    // School ALSO gates level-up — station (8,0)–(9,1); cell (8,1) adj road (8,2).
    seedSchool(world, 8, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Power + water + ALL FOUR (police, fire, hospital, school) coverage satisfied at the anchor.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);

    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    expectRoadRowJobsAlive(world);
    expect(map.getBuildings().getBuilding(bid)?.level).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Hospital-coverage gate: level-up requires police AND fire AND hospital AND school
// coverage at the anchor. Police, fire, school, power, water, and land value are
// satisfied throughout so hospital coverage is the SOLE variable. Spawn is NOT hospital-gated.
// ---------------------------------------------------------------------------

describe('World.tick() hospital-coverage gate — level-up needs police AND fire AND hospital AND school at the anchor', () => {
  it('with police+fire but NO hospital coverage does NOT level up', () => {
    // Layout (10×8): road row y=2. Zone (0,1)=RESIDENTIAL frontage S adj to road (0,2).
    // Diversity: (1,1)=COMMERCIAL, (0,0)=INDUSTRIAL in 3×3 window. Land value (road +
    // diversity + the present services' coverage) stays well above the level-2 gate (0.25);
    // the missing service is the SOLE level-up blocker here, not land value.
    // Plant (4,3)–(5,4) powers the road row; tower (7,3) waters it. Police (1,3)–(2,4),
    // fire (8,3)–(9,4), and school (8,0)–(9,1) cover the anchor. NO hospital → hospital is the SOLE blocker.
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    seedPolice(world, 1, 3);
    seedFire(world, 8, 3);
    // School covers the anchor so hospital stays the SOLE blocker. Station (8,0)–(9,1); cell (8,1) adj road (8,2).
    seedSchool(world, 8, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // past cooldown — only hospital coverage can block
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Power + water + police + fire + school coverage satisfied; hospital coverage is ZERO — the SOLE blocker.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBe(0);

    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();
    expectRoadRowJobsAlive(world);

    const after = map.getBuildings().getBuilding(bid)!;
    // Level must NOT have increased (hospital-coverage gate blocked it).
    expect(after.level).toBe(1);
    // Age MUST have increased (aging is NOT coverage-gated).
    expect(after.age).toBeGreaterThan(cooldown + 5);
  });

  it('with all four (police+fire+hospital+school) the building levels up', () => {
    // Identical layout to the negative case, plus a hospital at (5,0)–(6,1) and a
    // school at (8,0)–(9,1): both reach the road row → off-road frontage covers (0,1).
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    seedPolice(world, 1, 3);
    seedFire(world, 8, 3);
    seedHospital(world, 5, 0);
    // School ALSO gates level-up — station (8,0)–(9,1); cell (8,1) adj road (8,2).
    seedSchool(world, 8, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Power + water + ALL FOUR (police, fire, hospital, school) coverage satisfied at the anchor.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);

    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    expectRoadRowJobsAlive(world);
    expect(map.getBuildings().getBuilding(bid)?.level).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// School-coverage gate: level-up requires police AND fire AND hospital AND school
// coverage at the anchor. Police, fire, hospital, power, water, and land value are
// satisfied throughout so school coverage is the SOLE variable. Spawn is NOT school-gated.
// ---------------------------------------------------------------------------

describe('World.tick() school-coverage gate — level-up needs police AND fire AND hospital AND school at the anchor', () => {
  it('with police+fire+hospital but NO school does NOT level up', () => {
    // Layout (10×8): road row y=2. Zone (0,1)=RESIDENTIAL frontage S adj to road (0,2).
    // Diversity: (1,1)=COMMERCIAL, (0,0)=INDUSTRIAL in 3×3 window. Land value (road +
    // diversity + the present services' coverage) stays well above the level-2 gate (0.25);
    // the missing service is the SOLE level-up blocker here, not land value.
    // Plant (4,3)–(5,4) powers the road row; tower (7,3) waters it. Police (1,3)–(2,4),
    // fire (8,3)–(9,4), and hospital (5,0)–(6,1) cover the anchor. NO school → school is the SOLE blocker.
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    seedPolice(world, 1, 3);
    seedFire(world, 8, 3);
    seedHospital(world, 5, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // past cooldown — only school coverage can block
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Power + water + police + fire + hospital coverage satisfied; school coverage is ZERO — the SOLE blocker.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBe(0);

    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();
    expectRoadRowJobsAlive(world);

    const after = map.getBuildings().getBuilding(bid)!;
    // Level must NOT have increased (school-coverage gate blocked it).
    expect(after.level).toBe(1);
    // Age MUST have increased (aging is NOT coverage-gated).
    expect(after.age).toBeGreaterThan(cooldown + 5);
  });

  it('with all four (police+fire+hospital+school) the building levels up', () => {
    // Identical layout to the negative case, plus a school at (8,0)–(9,1):
    // cell (8,1) adj to road (8,2) → covers the road row → off-road frontage covers (0,1).
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 4, 3);
    seedWater(world, 7, 3);
    seedPolice(world, 1, 3);
    seedFire(world, 8, 3);
    seedHospital(world, 5, 0);
    seedSchool(world, 8, 0);

    seedRoadRowJobs(world);

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Power + water + ALL FOUR (police, fire, hospital, school) coverage satisfied at the anchor.
    expect(world.getPowerMap().isPowered(0, 1)).toBe(true);
    expect(world.getWaterMap().isWatered(0, 1)).toBe(true);
    expect(world.getServiceCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 1)).toBeGreaterThan(0);

    // Asserted last, once every building exists: the fixture really does supply reachable
    // jobs and an open residential gate, so the gate under test is the only blocker.
    expectJobsReachable(world);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    expectRoadRowJobsAlive(world);
    expect(map.getBuildings().getBuilding(bid)?.level).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// FireCoverageMap API on World (lifecycle/cadence only — gate lands in Task 4)
// ---------------------------------------------------------------------------

describe('World.getFireCoverageMap() — lazy allocation', () => {
  it('first call returns a non-null FireCoverageMap instance', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getFireCoverageMap()).not.toBeNull();
  });

  it('subsequent calls return the same instance', () => {
    const world = new World(4, 4, { regenerate: false });
    const first = world.getFireCoverageMap();
    const second = world.getFireCoverageMap();
    expect(second).toBe(first);
  });
});

describe('World.markFireDirty() + recomputeFireIfDirty()', () => {
  it('recomputeFireIfDirty() after markFireDirty() triggers recompute exactly once; second call is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeFire');

    world.markFireDirty();
    world.recomputeFireIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    // No further dirty mark — second call is a no-op.
    world.recomputeFireIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('markFireDirty() + tick() recomputes the coverage map so a fire station covers an adjacent road', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    // Fire station 2×2 at (2,2)–(3,3); road at (2,4) adjacent to the station's south edge.
    world.getStructureMap().addStructure({
      type: 'fire_station',
      anchor: { x: 2, y: 2 },
      footprint: [
        { x: 2, y: 2 }, { x: 3, y: 2 },
        { x: 2, y: 3 }, { x: 3, y: 3 },
      ],
    });
    map.setTile(2, 4, createTile(2, 4, TileType.ROAD));

    // Before any recompute the coverage map is empty.
    expect(world.getFireCoverageMap().getCoverage(2, 4)).toBe(0);

    world.markFireDirty();
    world.tick();

    // The road adjacent to the station now carries coverage.
    expect(world.getFireCoverageMap().getCoverage(2, 4)).toBeGreaterThan(0);
  });
});

describe('World.reset() — fire coverage cleanup', () => {
  it('zeroes getFireCoverageMap().getRaw() AND clears the dirty flag after reset', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();

    // Place a station and a road so some cells gain coverage.
    seedFire(world, 0, 0);
    map.setTile(0, 2, createTile(0, 2, TileType.ROAD));
    world.recomputeFire();
    world.markFireDirty();

    world.reset({ regenerate: false });

    const raw = world.getFireCoverageMap().getRaw();
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBe(0);
    }

    // Dirty flag is cleared: a recomputeFireIfDirty call should be a no-op.
    const spy = vi.spyOn(world, 'recomputeFire');
    world.recomputeFireIfDirty();
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });
});

describe('World.tick() — fire coverage periodic cadence', () => {
  it('at tickCount === SERVICE_INTERVAL, tick() triggers recomputeFire even when fireDirty is false', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeFire');

    // Advance to one tick before the cadence fires.
    for (let i = 0; i < SERVICE_INTERVAL - 1; i++) world.tick();
    const callsBefore = spy.mock.calls.length;

    // This tick brings tickCount to SERVICE_INTERVAL — force recompute fires.
    world.tick();
    expect(spy.mock.calls.length).toBe(callsBefore + 1);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// HospitalCoverageMap API on World (lifecycle/cadence only — gate lands in Task 4)
// ---------------------------------------------------------------------------

describe('World.getHospitalCoverageMap() — lazy allocation', () => {
  it('first call returns a non-null HospitalCoverageMap instance', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getHospitalCoverageMap()).not.toBeNull();
  });

  it('subsequent calls return the same instance', () => {
    const world = new World(4, 4, { regenerate: false });
    const first = world.getHospitalCoverageMap();
    const second = world.getHospitalCoverageMap();
    expect(second).toBe(first);
  });
});

describe('World.markHospitalDirty() + recomputeHospitalIfDirty()', () => {
  it('recomputeHospitalIfDirty() after markHospitalDirty() triggers recompute exactly once; second call is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeHospital');

    world.markHospitalDirty();
    world.recomputeHospitalIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    // No further dirty mark — second call is a no-op.
    world.recomputeHospitalIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('markHospitalDirty() + tick() recomputes the coverage map so a hospital covers an adjacent road', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    // Hospital 2×2 at (2,2)–(3,3); road at (2,4) adjacent to the hospital's south edge.
    world.getStructureMap().addStructure({
      type: 'hospital',
      anchor: { x: 2, y: 2 },
      footprint: [
        { x: 2, y: 2 }, { x: 3, y: 2 },
        { x: 2, y: 3 }, { x: 3, y: 3 },
      ],
    });
    map.setTile(2, 4, createTile(2, 4, TileType.ROAD));

    // Before any recompute the coverage map is empty.
    expect(world.getHospitalCoverageMap().getCoverage(2, 4)).toBe(0);

    world.markHospitalDirty();
    world.tick();

    // The road adjacent to the hospital now carries coverage.
    expect(world.getHospitalCoverageMap().getCoverage(2, 4)).toBeGreaterThan(0);
  });
});

describe('World.reset() — hospital coverage cleanup', () => {
  it('zeroes getHospitalCoverageMap().getRaw() AND clears the dirty flag after reset', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();

    // Place a hospital and a road so some cells gain coverage.
    seedHospital(world, 0, 0);
    map.setTile(0, 2, createTile(0, 2, TileType.ROAD));
    world.recomputeHospital();
    world.markHospitalDirty();

    world.reset({ regenerate: false });

    const raw = world.getHospitalCoverageMap().getRaw();
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBe(0);
    }

    // Dirty flag is cleared: a recomputeHospitalIfDirty call should be a no-op.
    const spy = vi.spyOn(world, 'recomputeHospital');
    world.recomputeHospitalIfDirty();
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });
});

describe('World.tick() — hospital coverage periodic cadence', () => {
  it('at tickCount === SERVICE_INTERVAL, tick() triggers recomputeHospital even when hospitalDirty is false', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeHospital');

    // Advance to one tick before the cadence fires.
    for (let i = 0; i < SERVICE_INTERVAL - 1; i++) world.tick();
    const callsBefore = spy.mock.calls.length;

    // This tick brings tickCount to SERVICE_INTERVAL — force recompute fires.
    world.tick();
    expect(spy.mock.calls.length).toBe(callsBefore + 1);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// SchoolCoverageMap API on World (lifecycle/cadence only — gate lands in Task 4)
// ---------------------------------------------------------------------------

describe('World.getSchoolCoverageMap() — lazy allocation', () => {
  it('first call returns a non-null SchoolCoverageMap instance', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getSchoolCoverageMap()).not.toBeNull();
  });

  it('subsequent calls return the same instance', () => {
    const world = new World(4, 4, { regenerate: false });
    const first = world.getSchoolCoverageMap();
    const second = world.getSchoolCoverageMap();
    expect(second).toBe(first);
  });
});

describe('World.markSchoolDirty() + recomputeSchoolIfDirty()', () => {
  it('recomputeSchoolIfDirty() after markSchoolDirty() triggers recompute exactly once; second call is a no-op', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeSchool');

    world.markSchoolDirty();
    world.recomputeSchoolIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    // No further dirty mark — second call is a no-op.
    world.recomputeSchoolIfDirty();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});

describe('World.reset() — school coverage cleanup', () => {
  it('zeroes getSchoolCoverageMap().getRaw() AND clears the dirty flag after reset', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();

    // Place a school and a road so some cells gain coverage.
    seedSchool(world, 0, 0);
    map.setTile(0, 2, createTile(0, 2, TileType.ROAD));
    world.recomputeSchool();
    world.markSchoolDirty();

    world.reset({ regenerate: false });

    const raw = world.getSchoolCoverageMap().getRaw();
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBe(0);
    }

    // Dirty flag is cleared: a recomputeSchoolIfDirty call should be a no-op.
    const spy = vi.spyOn(world, 'recomputeSchool');
    world.recomputeSchoolIfDirty();
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });
});

describe('World.tick() — school coverage periodic cadence', () => {
  it('at tickCount === SERVICE_INTERVAL, tick() triggers recomputeSchool even when schoolDirty is false', () => {
    const world = new World(4, 4, { regenerate: false });
    const spy = vi.spyOn(world, 'recomputeSchool');

    // Advance to one tick before the cadence fires.
    for (let i = 0; i < SERVICE_INTERVAL - 1; i++) world.tick();
    const callsBefore = spy.mock.calls.length;

    // This tick brings tickCount to SERVICE_INTERVAL — force recompute fires.
    world.tick();
    expect(spy.mock.calls.length).toBe(callsBefore + 1);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// World.getHappiness() — display-only city KPI
// ---------------------------------------------------------------------------

describe('World.getHappiness() — range and empty-city default', () => {
  it('result is always in [0, 1] range after tick()', () => {
    const world = new World(4, 4, { regenerate: false });
    world.tick();
    const h = world.getHappiness();
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
  });

  it('empty city (no buildings, no jobs) returns EMPTY_CITY_HAPPINESS', () => {
    const world = new World(4, 4, { regenerate: false });
    // Dirty via setMoney so the lazy path runs recomputeHappiness (not the stale cache).
    world.setMoney(STARTING_FUNDS);
    expect(world.getHappiness()).toBe(EMPTY_CITY_HAPPINESS);
  });
});

describe('World.getHappiness() — budget sensitivity', () => {
  it('higher money produces higher or equal happiness (budgetHealth term)', () => {
    // Two worlds identical except treasury; both have only a commercial building (jobs only,
    // residentialCount=0, jobsCapacitySum>0) so the empty-city path is NOT taken.
    // Dirty path: setMoney triggers markHappinessDirty.
    const worldRich = new World(4, 4, { regenerate: false });
    const worldPoor = new World(4, 4, { regenerate: false });

    for (const w of [worldRich, worldPoor]) {
      w.getMap().getBuildings().addExistingBuilding({
        id: 1, type: 'commercial',
        footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
        level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
        structureRect: { x: 0, y: 0, w: 1, h: 1 },
      });
    }

    worldRich.setMoney(STARTING_FUNDS);
    worldPoor.setMoney(Math.floor(STARTING_FUNDS * 0.1));

    expect(worldRich.getHappiness()).toBeGreaterThan(worldPoor.getHappiness());
  });

  it('setMoney(0) produces the lowest budgetHealth (0) in budget term', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'commercial',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.setMoney(0);
    const hZero = world.getHappiness();

    world.setMoney(STARTING_FUNDS);
    const hFull = world.getHappiness();

    expect(hFull).toBeGreaterThan(hZero);
  });
});

describe('World.getHappiness() — jobs-balance sensitivity', () => {
  it('balanced residential/jobs levels produce higher happiness than all-residential with same money', () => {
    // Balanced: 2 residential level-1 + 2 commercial level-1 → jobsBalance near 1.
    // Unbalanced: 4 residential level-1 + 0 commercial → jobsBalance = clamp01(1 - 4/4) = 0.
    // Both worlds have the same money (STARTING_FUNDS), no roads (landScore=0 for residentialCount>0 path).
    const worldBalanced = new World(4, 4, { regenerate: false });
    const worldUnbalanced = new World(4, 4, { regenerate: false });

    // Balanced: 2R + 2C, level 1 each.
    worldBalanced.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    worldBalanced.getMap().getBuildings().addExistingBuilding({
      id: 2, type: 'residential',
      footprint: [{ x: 1, y: 0 }], anchor: { x: 1, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 1, y: 0, w: 1, h: 1 },
    });
    worldBalanced.getMap().getBuildings().addExistingBuilding({
      id: 3, type: 'commercial',
      footprint: [{ x: 2, y: 0 }], anchor: { x: 2, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 0, w: 1, h: 1 },
    });
    worldBalanced.getMap().getBuildings().addExistingBuilding({
      id: 4, type: 'commercial',
      footprint: [{ x: 3, y: 0 }], anchor: { x: 3, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 3, y: 0, w: 1, h: 1 },
    });

    // Unbalanced: 4R + 0 jobs.
    worldUnbalanced.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    worldUnbalanced.getMap().getBuildings().addExistingBuilding({
      id: 2, type: 'residential',
      footprint: [{ x: 1, y: 0 }], anchor: { x: 1, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 1, y: 0, w: 1, h: 1 },
    });
    worldUnbalanced.getMap().getBuildings().addExistingBuilding({
      id: 3, type: 'residential',
      footprint: [{ x: 2, y: 0 }], anchor: { x: 2, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 0, w: 1, h: 1 },
    });
    worldUnbalanced.getMap().getBuildings().addExistingBuilding({
      id: 4, type: 'residential',
      footprint: [{ x: 3, y: 0 }], anchor: { x: 3, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 3, y: 0, w: 1, h: 1 },
    });

    // Dirty both via setMoney to trigger recompute through the proper path.
    worldBalanced.setMoney(STARTING_FUNDS);
    worldUnbalanced.setMoney(STARTING_FUNDS);

    expect(worldBalanced.getHappiness()).toBeGreaterThan(worldUnbalanced.getHappiness());
  });
});

describe('World.getHappiness() — land-value sensitivity', () => {
  it('residential building WITH a road nearby has higher happiness than without', () => {
    // Two 10×8 worlds. Both: single residential at (0,1), same money (STARTING_FUNDS).
    // "With road": road row at y=2, power plant so land value is non-zero at (0,1).
    // "Without road": no road → land value at anchor stays 0 → landScore=0.
    // Both dirty via setMoney.
    const worldWithRoad = new World(10, 8, { regenerate: false });
    const worldNoRoad = new World(10, 8, { regenerate: false });

    for (const w of [worldWithRoad, worldNoRoad]) {
      w.getMap().setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
      w.getMap().getBuildings().addExistingBuilding({
        id: 1, type: 'residential',
        footprint: [{ x: 0, y: 1 }], anchor: { x: 0, y: 1 },
        level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
        structureRect: { x: 0, y: 1, w: 1, h: 1 },
      });
    }

    // Road + power for worldWithRoad.
    for (let x = 0; x < 10; x++) worldWithRoad.getMap().setTile(x, 2, createTile(x, 2, TileType.ROAD));
    seedPower(worldWithRoad, 4, 3);

    // Dirty both via markLandValueDirty + setMoney so the cascade fires.
    worldWithRoad.markLandValueDirty();
    worldWithRoad.setMoney(STARTING_FUNDS);
    worldNoRoad.setMoney(STARTING_FUNDS);

    expect(worldWithRoad.getHappiness()).toBeGreaterThan(worldNoRoad.getHappiness());
  });
});

describe('World.getHappiness() — B1 station-coverage cascade (all four methods)', () => {
  // Each test proves that a specific markX*Dirty path routes through dirtyLandValueAndHappiness()
  // so placing that service type lifts happiness above the pre-station baseline.
  // Layout: single residential at anchor (0,1) adjacent to road row y=2, power at (4,3).
  // We read getHappiness() before placing the station (pre-value), then place the station,
  // call the markX*Dirty route + recompute, and confirm getHappiness() increases.
  // setMoney(STARTING_FUNDS) is called before each read to ensure the dirty path runs.

  function makeBaseWorld(): World {
    const w = new World(10, 8, { regenerate: false });
    for (let x = 0; x < 10; x++) w.getMap().setTile(x, 2, createTile(x, 2, TileType.ROAD));
    w.getMap().setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    w.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 1 }], anchor: { x: 0, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    seedPower(w, 4, 3);
    return w;
  }

  it('police (markServiceDirty) cascade: placing a police station lifts happiness', () => {
    const w = makeBaseWorld();
    w.setMoney(STARTING_FUNDS);
    const before = w.getHappiness();

    seedPolice(w, 0, 3); // markServiceDirty is called inside seedPolice
    // setMoney re-dirties happiness so the next read re-enters recomputeHappiness.
    w.setMoney(STARTING_FUNDS);
    const after = w.getHappiness();

    expect(after).toBeGreaterThanOrEqual(before);
    // Station at (0,3) is directly adjacent to road (0,2) → max coverage → should strictly increase.
    expect(after).toBeGreaterThan(before);
  });

  it('fire (markFireDirty) cascade: placing a fire station lifts happiness', () => {
    const w = makeBaseWorld();
    w.setMoney(STARTING_FUNDS);
    const before = w.getHappiness();

    seedFire(w, 0, 3); // markFireDirty called inside seedFire
    w.setMoney(STARTING_FUNDS);
    const after = w.getHappiness();

    expect(after).toBeGreaterThan(before);
  });

  it('hospital (markHospitalDirty) cascade: placing a hospital lifts happiness', () => {
    const w = makeBaseWorld();
    w.setMoney(STARTING_FUNDS);
    const before = w.getHappiness();

    seedHospital(w, 0, 3); // markHospitalDirty called inside seedHospital
    w.setMoney(STARTING_FUNDS);
    const after = w.getHappiness();

    expect(after).toBeGreaterThan(before);
  });

  it('school (markSchoolDirty) cascade: placing a school lifts happiness', () => {
    const w = makeBaseWorld();
    w.setMoney(STARTING_FUNDS);
    const before = w.getHappiness();

    seedSchool(w, 0, 3); // markSchoolDirty called inside seedSchool
    w.setMoney(STARTING_FUNDS);
    const after = w.getHappiness();

    expect(after).toBeGreaterThan(before);
  });
});

describe('World.getHappiness() — reset freshness', () => {
  it('after growing a city and then reset(), getHappiness() returns EMPTY_CITY_HAPPINESS (no buildings)', () => {
    // Grow a building then reset; reset clears buildings so empty-city path fires.
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 1 }], anchor: { x: 0, y: 1 },
      level: 3, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    seedPower(world, 4, 3);
    world.setMoney(STARTING_FUNDS);
    // Confirm non-empty-city happiness before reset.
    expect(world.getHappiness()).not.toBe(EMPTY_CITY_HAPPINESS);

    world.reset({ regenerate: false });

    // After reset, no buildings exist → empty-city path.
    expect(world.getHappiness()).toBe(EMPTY_CITY_HAPPINESS);
  });
});

describe('World.getHappiness() — dirty/lazy correctness', () => {
  it('trySpend() changes happiness on the next read (no tick needed)', () => {
    const world = new World(4, 4, { regenerate: false });
    // Add a commercial building so we are out of empty-city state; budget term will vary.
    world.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'commercial',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // setMoney so initial read is fresh and non-empty.
    world.setMoney(STARTING_FUNDS);
    const hFull = world.getHappiness();

    world.trySpend(STARTING_FUNDS - 100); // spend most of the money
    const hLow = world.getHappiness();

    expect(hLow).toBeLessThan(hFull);
  });

  it('earn() changes happiness on the next read (no tick needed)', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'commercial',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.setMoney(100); // start low
    const hLow = world.getHappiness();

    world.earn(STARTING_FUNDS); // earn a lot
    const hHigh = world.getHappiness();

    expect(hHigh).toBeGreaterThan(hLow);
  });

  it('two consecutive reads with no mutation return the same value', () => {
    const world = new World(4, 4, { regenerate: false });
    world.setMoney(STARTING_FUNDS); // dirty
    const h1 = world.getHappiness();
    const h2 = world.getHappiness(); // no mutation between reads
    expect(h1).toBe(h2);
  });

  it('formula sanity: pure-budget world matches HAPPINESS_W_LAND*0 + HAPPINESS_W_JOBS*0 + HAPPINESS_W_BUDGET*1', () => {
    // World with only commercial buildings (no residential, has jobs) → NOT empty-city.
    // residentialCount=0, jobsCapacitySum=buildingCapacity(level 1, 1x1 sr)=5, capacitySumR=0:
    //   landScore    = 0  (no residential buildings)
    //   jobsBalance  = clamp01(1 - |5-0| / max(5+0,1)) = 0
    //   budgetHealth = clamp01(STARTING_FUNDS / STARTING_FUNDS) = 1
    // expected = HAPPINESS_W_LAND*0 + HAPPINESS_W_JOBS*0 + HAPPINESS_W_BUDGET*1
    const world = new World(4, 4, { regenerate: false });
    world.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'commercial',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.setMoney(STARTING_FUNDS);
    const h = world.getHappiness();
    const expected = HAPPINESS_W_LAND * 0 + HAPPINESS_W_JOBS * 0 + HAPPINESS_W_BUDGET * 1;
    expect(h).toBeCloseTo(expected, 5);
  });

  it('recomputeLandValue() invalidates the happiness cache so the next getHappiness() reflects the new land value', () => {
    // Reproduces the stale-cache gap: call getHappiness() to populate the cache,
    // then place a road (raises land value), call public recomputeLandValue(), and
    // assert the next getHappiness() is NOT the same as the old cached value.
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    // Seed a residential building with no road → land value low → happiness low.
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.setMoney(STARTING_FUNDS);
    // Prime the cache — happiness is computed and stored.
    const hBefore = world.getHappiness();

    // Place a road adjacent to the residential anchor to raise land value.
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD));
    // Force a land-value recompute via the public path (not markLandValueDirty).
    world.recomputeLandValue();

    // After recomputeLandValue(), the next read must re-derive happiness — NOT return hBefore.
    const hAfter = world.getHappiness();
    expect(hAfter).toBeGreaterThan(hBefore);
  });
});

describe('World.getHappiness() — hydration freshness', () => {
  it('deserializing a grown city re-derives happiness on first read (no tick) via markLandValueDirty cascade', () => {
    // Build a source world with a residential building and a road nearby so land value
    // and happiness are non-trivially above EMPTY_CITY_HAPPINESS.
    const src = new World(10, 8, { regenerate: false });
    const map = src.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 3, createTile(x, 3, TileType.ROAD));
    map.setTile(0, 2, createTile(0, 2, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 2 }], anchor: { x: 0, y: 2 },
      level: 3, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 2, w: 1, h: 1 },
    });
    src.setMoney(STARTING_FUNDS);
    // Confirm source happiness is not the empty-city default.
    const srcHappiness = src.getHappiness();
    expect(srcHappiness).not.toBe(EMPTY_CITY_HAPPINESS);

    // Round-trip through serialize/deserialize.
    const dst = new World(10, 8, { regenerate: false });
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);

    // First read of getHappiness() on the loaded world — NO tick called.
    // deserializeWorldInto calls markLandValueDirty(), which cascades to happinessDirty,
    // so getHappiness() re-derives on this first read.
    const dstHappiness = dst.getHappiness();
    expect(dstHappiness).not.toBe(EMPTY_CITY_HAPPINESS);
    expect(dstHappiness).toBeGreaterThanOrEqual(0);
    expect(dstHappiness).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// TrafficMap wiring into World
// ---------------------------------------------------------------------------

describe('World.getTrafficMap() — drain-on-read', () => {
  it('markTrafficDirty() + getTrafficMap() returns fresh non-zero congestion WITHOUT manual recompute', () => {
    // Layout (8×6): road row at y=2. Residential at (0,1) frontage S adj road (0,2).
    // Commercial (job destination) at (5,1) frontage S adj road (5,2).
    // assignTraffic routes vol=1 from (0,1) over the road → road tiles carry load → congestion > 0.
    const world = new World(8, 6, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 8; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 1 }], anchor: { x: 0, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'commercial',
      footprint: [{ x: 5, y: 1 }], anchor: { x: 5, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 5, y: 1, w: 1, h: 1 },
    });

    // Mark dirty — getter must drain and deliver fresh data without a manual recompute call.
    world.markTrafficDirty();
    const tm = world.getTrafficMap();

    // Road tile (0,2) is the residential origin access node — it must carry load.
    expect(tm.getCongestion(0, 2)).toBeGreaterThan(0);
  });
});

describe('traffic cadence constants', () => {
  it('TRAFFIC_INTERVAL is a multiple of LAND_VALUE_INTERVAL', () => {
    // Land value reads the traffic snapshot, and recomputeTraffic deliberately does NOT
    // dirty land value (cascades fire on mark, never on recompute). So a cadence-forced
    // congestion refresh only reaches land value on a tick where the land-value cadence
    // fires too. If this divisibility ever breaks, the refreshed congestion sits unread and
    // growth/abandonment decide on stale congestion for the rest of the traffic period.
    // See the TRAFFIC_INTERVAL doc comment in World.ts.
    expect(TRAFFIC_INTERVAL % LAND_VALUE_INTERVAL).toBe(0);
  });
});

describe('World.tick() — traffic cadence (retained-ref mutation proof)', () => {
  it('tick to TRAFFIC_INTERVAL mutates the RETAINED TrafficMap instance in place without calling getTrafficMap again', () => {
    // Layout (8×6): road row at y=2. No zone tiles → no growth → changedBuildingIds stays
    // empty on every tick → the growth guard never calls markTrafficDirty() during the loop.
    //
    // Step 1: seed origin (residential at (0,1)) and destination (commercial at (5,1)).
    // Step 2: mark dirty + getTrafficMap() drains once → BASELINE on the retained instance.
    // Step 3: remove the destination directly via BuildingMap (does NOT call markTrafficDirty).
    //         trafficDirty is now false. expectedNew = 0 (no destination → no route).
    // Step 4: tick to the TRAFFIC_INTERVAL boundary WITHOUT calling getTrafficMap again and
    //         WITHOUT calling markTrafficDirty. trafficDirty stays false throughout, so the
    //         else-branch recomputeTrafficIfDirty() is a no-op on every tick 1..15. Only the
    //         if (tickCount % TRAFFIC_INTERVAL === 0) recomputeTraffic() force-branch can
    //         update the retained instance — which is what this test proves.
    // Step 5: assert retained.getCongestion(px,py) === expectedNew (and !== baseline).
    const world = new World(8, 6, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 8; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 1 }], anchor: { x: 0, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'commercial',
      footprint: [{ x: 5, y: 1 }], anchor: { x: 5, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 5, y: 1, w: 1, h: 1 },
    });

    // Step 2: mark dirty then obtain+RETAIN the TrafficMap reference; drain drains once → BASELINE.
    world.markTrafficDirty();
    const retained = world.getTrafficMap();
    const px = 0; const py = 2; // probe: residential origin access node road tile
    const baseline = retained.getCongestion(px, py);
    expect(baseline).toBeGreaterThan(0); // non-zero — route exists

    // Step 3: remove the destination DIRECTLY via BuildingMap — does NOT call markTrafficDirty.
    // trafficDirty is now false; the else-branch is a no-op until the cadence boundary.
    map.getBuildings().removeBuilding(2);
    const expectedNew = 0; // no destination → no route → no load on probe tile
    expect(expectedNew).not.toBe(baseline); // guard: mutation changes the expected value

    // Step 4: tick to the next TRAFFIC_INTERVAL boundary. Do NOT call markTrafficDirty or
    // getTrafficMap. trafficDirty stays false → only the cadence force-recompute can update
    // the retained instance. No zone tiles → no growth → no changedBuildingIds on any tick.
    const currentTick = world.getTick(); // 0 (no ticks fired yet)
    const ticksNeeded = TRAFFIC_INTERVAL - (currentTick % TRAFFIC_INTERVAL);
    for (let i = 0; i < ticksNeeded; i++) {
      const result = world.tick();
      // Guard: if growth somehow fired and dirtied traffic via the guard, the else-branch
      // could drain it early and the cadence branch would not be what updated the map.
      expect(result.changedBuildingIds).toHaveLength(0);
    }

    // Step 5: retained instance must have been updated IN PLACE by the cadence block.
    expect(retained.getCongestion(px, py)).toBe(expectedNew);
    expect(retained.getCongestion(px, py)).not.toBe(baseline);
  });
});

describe('World.tick() — growth pass marks traffic dirty', () => {
  it('after a growth tick that spawns a building, getTrafficMap() shows non-zero load on the connecting road', () => {
    // Layout (8×6): road row at y=2. Residential zone (0,1) frontage S → spawn a building.
    // Commercial (job destination) already at (5,1). After spawn, traffic must route through road.
    const world = new World(8, 6, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 8; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));

    // Zone tile for residential — the growth pass will spawn a building here.
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));

    // Commercial job destination already placed.
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'commercial',
      footprint: [{ x: 5, y: 1 }], anchor: { x: 5, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 5, y: 1, w: 1, h: 1 },
    });

    // Power is required for spawn.
    seedPower(world, 6, 3); // plant at (6,3)–(7,4); (6,3) adj road (6,2) → powers road row

    // Confirm no residential building yet.
    expect(map.getBuildings().getBuildingAt(0, 1)).toBeNull();

    // Run until a growth tick spawns the residential building.
    let spawned = false;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) {
      const result = world.tick();
      if (result.changedBuildingIds.length > 0 && map.getBuildings().getBuildingAt(0, 1) !== null) {
        spawned = true;
        break;
      }
    }
    expect(spawned).toBe(true);

    // After growth (which calls markTrafficDirty), getTrafficMap() must drain and show load.
    // The residential building is at (0,1) frontage S → access node is road (0,2).
    expect(world.getTrafficMap().getCongestion(0, 2)).toBeGreaterThan(0);
  });
});

describe('World.reset() — traffic clear (common block)', () => {
  it('with non-zero traffic present, reset({regenerate:false}) clears all congestion to 0', () => {
    // Seed buildings and force a recompute so the backing array is non-zero.
    const world = new World(8, 6, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 8; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 1 }], anchor: { x: 0, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'commercial',
      footprint: [{ x: 5, y: 1 }], anchor: { x: 5, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 5, y: 1, w: 1, h: 1 },
    });

    // Force traffic to be computed and non-zero.
    world.markTrafficDirty();
    expect(world.getTrafficMap().getCongestion(0, 2)).toBeGreaterThan(0);

    world.reset({ regenerate: false });

    // After reset, getCongestion must return 0 for every tile.
    const raw = world.getTrafficMap().getRaw();
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Traffic feedback loop: congestion → land value → happiness
// ---------------------------------------------------------------------------

/**
 * Corridor fixture shared by the traffic-feedback tests: 8×6 world, road row at y=2,
 * a level-4 residential origin at (0,1) and — with `withJobs` — a level-4 commercial job
 * destination at (5,1). Without the destination the labor matcher produces no commute
 * flows, so the road row stays at zero congestion: the control for every penalty
 * assertion. Both variants have identical tiles, structures and (zero) coverage, so
 * congestion is the ONLY land-value input that differs between them.
 */
function makeCorridorWorld(opts: { withJobs: boolean }): World {
  const world = new World(8, 6, { regenerate: false });
  const map = world.getMap();
  for (let x = 0; x < 8; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
  map.getBuildings().addExistingBuilding({
    id: 1, type: 'residential',
    footprint: [{ x: 0, y: 1 }], anchor: { x: 0, y: 1 },
    level: 4, density: 0, age: 0, abandoned: false, frontage: 'S',
    structureRect: { x: 0, y: 1, w: 1, h: 1 },
  });
  if (opts.withJobs) {
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'commercial',
      footprint: [{ x: 5, y: 1 }], anchor: { x: 5, y: 1 },
      level: 4, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 5, y: 1, w: 1, h: 1 },
    });
  }
  // Mirrors what the growth pass and CommandDispatcher do after a building change.
  world.markLaborDirty();
  return world;
}

describe('World land value — congestion feedback', () => {
  it('a loaded road lowers the land value beside it versus an identical no-flow city', () => {
    const withFlows = makeCorridorWorld({ withJobs: true });
    const noFlows = makeCorridorWorld({ withJobs: false });
    withFlows.tick();
    noFlows.tick();

    // Guard: the corridor really is loaded in one world and empty in the other.
    expect(withFlows.getTrafficMap().getCongestion(2, 2)).toBeGreaterThan(0);
    expect(noFlows.getTrafficMap().getCongestion(2, 2)).toBe(0);

    // Probe (2,1): Chebyshev distance 1 from the loaded road tile (2,2).
    expect(withFlows.getLandValue().getValue(2, 1))
      .toBeLessThan(noFlows.getLandValue().getValue(2, 1));
  });

  it('markTrafficDirty() alone refreshes land value (traffic → land value cascade)', () => {
    const world = makeCorridorWorld({ withJobs: true });
    world.tick();
    const penalized = world.getLandValue().getValue(2, 1);

    // Remove the job destination DIRECTLY via BuildingMap — this marks nothing dirty.
    world.getMap().getBuildings().removeBuilding(2);
    // ONLY traffic is marked (no markLandValueDirty). Without the cascade the tick below
    // would refresh congestion but leave the stale penalty baked into the land-value field.
    world.markTrafficDirty();
    world.tick();
    const recovered = world.getLandValue().getValue(2, 1);

    const control = makeCorridorWorld({ withJobs: false });
    control.tick();

    expect(recovered).toBeGreaterThan(penalized);
    expect(recovered).toBe(control.getLandValue().getValue(2, 1));
  });
});

describe('World.getHappiness() — congestion term', () => {
  it('matches the four-term formula (land, jobs, budget, congestion)', () => {
    const world = makeCorridorWorld({ withJobs: true });

    // Capture happiness FIRST: its internal drain order (land value, then traffic) is what
    // refreshes every component. getLandValue() never drains and getTrafficMap() does not
    // drain landValueDirty, so reading the components first could disagree with the result.
    const happiness = world.getHappiness();

    const congestionIndex = world.getTrafficMap().getCongestionIndex();
    expect(congestionIndex).toBeGreaterThan(0);

    let capacitySumR = 0;
    let jobsCapacitySum = 0;
    let residentialCount = 0;
    let residentialLandValueSum = 0;
    for (const b of world.getMap().getBuildings().iterBuildings()) {
      if (b.abandoned) continue;
      if (b.type === 'residential') {
        capacitySumR += buildingCapacity(b);
        residentialCount++;
        residentialLandValueSum += world.getLandValue().getValue(b.anchor.x, b.anchor.y);
      } else {
        jobsCapacitySum += buildingCapacity(b);
      }
    }

    const landScore = residentialLandValueSum / residentialCount;
    const jobsBalance = 1 - Math.abs(jobsCapacitySum - capacitySumR) / Math.max(jobsCapacitySum + capacitySumR, 1);
    const budgetHealth = world.getMoney() / STARTING_FUNDS;
    const expected =
      HAPPINESS_W_LAND * landScore +
      HAPPINESS_W_JOBS * jobsBalance +
      HAPPINESS_W_BUDGET * budgetHealth -
      HAPPINESS_W_TRAFFIC * congestionIndex;

    expect(happiness).toBeCloseTo(expected, 8);
  });

  it('congestion strictly lowers happiness below the three positive terms alone', () => {
    const world = makeCorridorWorld({ withJobs: true });
    const happiness = world.getHappiness();

    const congestionIndex = world.getTrafficMap().getCongestionIndex();
    expect(congestionIndex).toBeGreaterThan(0);

    // Same city, three-term (pre-feedback) score: 1 R and 1 C building, both level 4, so
    // jobsBalance = 1 and budgetHealth = 1 (no tick, so money is untouched).
    const landScore = world.getLandValue().getValue(0, 1);
    const threeTerm =
      HAPPINESS_W_LAND * landScore + HAPPINESS_W_JOBS * 1 + HAPPINESS_W_BUDGET * 1;

    expect(happiness).toBeLessThan(threeTerm);
  });
});
