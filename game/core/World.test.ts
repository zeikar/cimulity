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
  DENSITY_COOLDOWN_INTERVALS,
  EMPTY_CITY_HAPPINESS,
  HAPPINESS_W_LAND,
  HAPPINESS_W_JOBS,
  HAPPINESS_W_BUDGET,
} from './World';
import { GROWTH_COOLDOWN_INTERVALS, stagger } from './growthConstants';
import { TileType, createTile } from './Tile';
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
      frontage: 'S', // road is south at (0,2)
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    // Jobs source so residential demand stays positive.
    mapF.getBuildings().addExistingBuilding({
      id: 999,
      type: 'commercial',
      footprint: [{ x: 9, y: 7 }],
      anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: 0,
      frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

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

  it('sums building levels and multiplies by POPULATION_PER_LEVEL', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL));
    // Seed buildings with levels 3, 2, 1 respectively; sum = 6
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 }, level: 3, density: 0, age: 0, frontage: 'S', structureRect: { x: 0, y: 0, w: 1, h: 1 } });
    map.getBuildings().addBuilding({ type: 'commercial', footprint: [{ x: 1, y: 0 }], anchor: { x: 1, y: 0 }, level: 2, density: 0, age: 0, frontage: 'S', structureRect: { x: 1, y: 0, w: 1, h: 1 } });
    map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 2, y: 0 }], anchor: { x: 2, y: 0 }, level: 1, density: 0, age: 0, frontage: 'S', structureRect: { x: 2, y: 0, w: 1, h: 1 } });
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
    // Only the zone at (3,0) has a building
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 3, y: 0 }], anchor: { x: 3, y: 0 }, level: 2, density: 0, age: 0, frontage: 'S', structureRect: { x: 3, y: 0, w: 1, h: 1 } });
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

  it('sum(building.level) × POPULATION_PER_LEVEL formula across multiple buildings', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 }, level: 2, density: 0, age: 0, frontage: 'S', structureRect: { x: 0, y: 0, w: 1, h: 1 } });
    map.getBuildings().addBuilding({ type: 'commercial', footprint: [{ x: 1, y: 0 }], anchor: { x: 1, y: 0 }, level: 3, density: 0, age: 0, frontage: 'S', structureRect: { x: 1, y: 0, w: 1, h: 1 } });
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
    const world = new World(18, 4, { regenerate: false });
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
    // Seed an existing commercial building outside the test focus so R demand
    // stays positive (without jobs, demand for R collapses to 0 and level-up halts).
    // The C zones above can't spawn naturally because their frontage face is
    // blocked by R buildings, so a manual seed is the simplest way.
    map.getBuildings().addExistingBuilding({
      id: 999,
      type: 'commercial',
      footprint: [{ x: 9, y: 1 }],
      anchor: { x: 9, y: 1 },
      level: 5,
      density: 0,
      age: 0,
      frontage: 'N',
      structureRect: { x: 9, y: 1, w: 1, h: 1 },
    });
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

    // Jobs source for residential demand.
    map.getBuildings().addExistingBuilding({
      id: 999,
      type: 'commercial',
      footprint: [{ x: 9, y: 7 }],
      anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: 0,
      frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // age already past cooldown
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
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
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
    // Add jobs source for residential demand.
    map.getBuildings().addExistingBuilding({
      id: 999,
      type: 'commercial',
      footprint: [{ x: 9, y: 9 }],
      anchor: { x: 9, y: 9 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: 0,
      frontage: 'N',
      structureRect: { x: 9, y: 9, w: 1, h: 1 },
    });

    // Confirm NOT watered.
    expect(world.getWaterMap().isWatered(0, 1)).toBe(false);

    // Run growth ticks: spawn should happen despite no water.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();

    // A building should have spawned at (0,1).
    expect(map.getBuildings().getBuildingAt(0, 1)).not.toBeNull();
    expect(map.getBuildings().getBuildingAt(0, 1)?.level).toBe(1);
  });

  // Two separate it-blocks for the merge water gate (no if-guards around assertions).
  //
  // Layout (12×6 map):
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
    // NEGATIVE: building B has an isolated road (8,3); tower only waters A's network → B NOT watered.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();

    // Zone row y=2.
    map.setTile(5, 2, createTile(5, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(6, 2, createTile(6, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(7, 2, createTile(7, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(8, 2, createTile(8, 2, TileType.ZONE_RESIDENTIAL));
    // Road A at (5,3),(6,3). GRASS GAP at (7,3). Road B at (8,3) — isolated from A.
    map.setTile(5, 3, createTile(5, 3, TileType.ROAD));
    map.setTile(6, 3, createTile(6, 3, TileType.ROAD));
    // (7,3) intentionally GRASS — road-to-road BFS cannot reach (8,3) from A's network.
    map.setTile(8, 3, createTile(8, 3, TileType.ROAD));
    // Power A: plant (3,3)–(4,4); (4,3) adj (5,3)=ROAD A.
    seedPower(world, 3, 3);
    // Power B: plant (9,2)–(10,3); (9,3) adj (8,3)=ROAD B.
    seedPower(world, 9, 2);
    // Water A only: tower (5,4) (1×1); (5,4) adj (5,3)=ROAD A; A network = (5,3)→(6,3); BFS stops at GRASS (7,3).
    seedWater(world, 5, 4);

    // Unconditional precondition pins — test fails loudly if water wiring regresses.
    expect(world.getWaterMap().isWatered(5, 3)).toBe(true);  // A road watered
    expect(world.getWaterMap().isWatered(6, 3)).toBe(true);  // A road watered
    expect(world.getWaterMap().isWatered(8, 3)).toBe(false); // B road NOT watered (isolated by gap)
    expect(world.getWaterMap().isWatered(5, 2)).toBe(true);  // A footprint cell watered
    expect(world.getWaterMap().isWatered(8, 2)).toBe(false); // B footprint cell NOT watered

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    // Jobs source: level 20 so residential demand stays well above DENSITY_DEMAND_THRESHOLD.
    // Total R levels = 2×ZONE_MAX_LEVEL = 10; commercial level 20 → demand = (20-10)/20+0.25 = 0.75 ≥ 0.6.
    map.getBuildings().addExistingBuilding({
      id: 900, type: 'commercial',
      footprint: [{ x: 11, y: 5 }], anchor: { x: 11, y: 5 },
      level: 20, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 11, y: 5, w: 1, h: 1 },
    });
    const okA = map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential',
      footprint: [{ x: 5, y: 2 }, { x: 6, y: 2 }], anchor: { x: 5, y: 2 },
      level: ZONE_MAX_LEVEL, density: 0, age: cooldown + 10, frontage: 'S',
      structureRect: { x: 5, y: 2, w: 2, h: 1 },
    });
    const okB = map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 7, y: 2 }, { x: 8, y: 2 }], anchor: { x: 7, y: 2 },
      level: ZONE_MAX_LEVEL, density: 0, age: cooldown + 10, frontage: 'S',
      structureRect: { x: 7, y: 2, w: 2, h: 1 },
    });
    expect(okA).toBe(true);
    expect(okB).toBe(true);
    world.markDemandDirty();

    // One growth tick. B unwatered → merge water gate blocks → both buildings survive.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    world.tick();

    // Unconditional — no if-guard.
    expect(map.getBuildings().getBuilding(0)).not.toBeNull();
    expect(map.getBuildings().getBuilding(1)).not.toBeNull();
  });

  it('(d-pos) merge water gate — both candidates watered: merge succeeds (asserts unconditionally)', () => {
    // POSITIVE: (7,3) is now ROAD (gap filled) → A+B connected → tower waters both → merge fires.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();

    map.setTile(5, 2, createTile(5, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(6, 2, createTile(6, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(7, 2, createTile(7, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(8, 2, createTile(8, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(5, 3, createTile(5, 3, TileType.ROAD));
    map.setTile(6, 3, createTile(6, 3, TileType.ROAD));
    map.setTile(7, 3, createTile(7, 3, TileType.ROAD)); // gap now filled → single connected road component
    map.setTile(8, 3, createTile(8, 3, TileType.ROAD));
    // Single plant powers the full row.
    seedPower(world, 3, 3);
    // Same tower position as negative scenario; now BFS reaches (5,3)→(8,3) all watered.
    seedWater(world, 5, 4);

    // Unconditional precondition pins.
    expect(world.getWaterMap().isWatered(8, 3)).toBe(true);  // B road watered (connected now)
    expect(world.getWaterMap().isWatered(8, 2)).toBe(true);  // B footprint cell watered
    expect(world.getWaterMap().isWatered(5, 2)).toBe(true);  // A footprint cell watered

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    // Jobs source: level 20 → residential demand = (20-10)/20+0.25 = 0.75 ≥ 0.6.
    map.getBuildings().addExistingBuilding({
      id: 900, type: 'commercial',
      footprint: [{ x: 11, y: 5 }], anchor: { x: 11, y: 5 },
      level: 20, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 11, y: 5, w: 1, h: 1 },
    });
    const okA = map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential',
      footprint: [{ x: 5, y: 2 }, { x: 6, y: 2 }], anchor: { x: 5, y: 2 },
      level: ZONE_MAX_LEVEL, density: 0, age: cooldown + 10, frontage: 'S',
      structureRect: { x: 5, y: 2, w: 2, h: 1 },
    });
    const okB = map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 7, y: 2 }, { x: 8, y: 2 }], anchor: { x: 7, y: 2 },
      level: ZONE_MAX_LEVEL, density: 0, age: cooldown + 10, frontage: 'S',
      structureRect: { x: 7, y: 2, w: 2, h: 1 },
    });
    expect(okA).toBe(true);
    expect(okB).toBe(true);
    world.markDemandDirty();

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
    // Demand sources: commercial buildings at level 20 → residentialDemand = (20-5)/20+0.25 ≈ 1.0 >> 0.6.
    // Power: plant at (4,3)–(5,4) adj to road (4,2). No tower initially → not watered.
    // Phase 1: run ticks WITHOUT water → density stays 0, age increases (not water-gated).
    // Phase 2: add tower (7,3) (1×1) adj road (7,2) → building watered → density bumps to 1.
    const world = new World(10, 8, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 10; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    seedPower(world, 4, 3); // plant (4,3)–(5,4); (4,3) adj road (4,2) → powers road row

    // Demand sources: commercial buildings supply jobs so residentialDemand >> DENSITY_DEMAND_THRESHOLD.
    // Two commercial buildings at level 10 each → jobsLevels=20, levelSumR=5 → demand≈1.0.
    map.getBuildings().addExistingBuilding({
      id: 800, type: 'commercial',
      footprint: [{ x: 7, y: 7 }], anchor: { x: 7, y: 7 },
      level: 10, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 7, y: 7, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: 801, type: 'commercial',
      footprint: [{ x: 8, y: 7 }], anchor: { x: 8, y: 7 },
      level: 10, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 8, y: 7, w: 1, h: 1 },
    });

    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS + 10,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    expect(b).not.toBeNull();
    const bid = b!.id;

    // Assert demand precondition so the test fails loudly if demand (not water) ever becomes the blocker.
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.6);

    // Phase 1: NOT watered → density must NOT advance.
    expect(world.getWaterMap().isWatered(0, 1)).toBe(false);
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    const mid = map.getBuildings().getBuilding(bid)!;
    expect(mid.density).toBe(0);
    // Age increased — aging is NOT water-gated.
    expect(mid.age).toBeGreaterThan(DENSITY_COOLDOWN_INTERVALS);

    // Phase 2: add tower → building becomes watered → density MUST advance.
    seedWater(world, 7, 3); // tower (7,3) (1×1); (7,3) adj road (7,2) → waters road row
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

    // Jobs source for residential demand.
    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 7 }], anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // past cooldown — only police coverage can block
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();

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

    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 7 }], anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5,
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
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
    // Jobs source for residential demand.
    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 9 }], anchor: { x: 9, y: 9 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 9, w: 1, h: 1 },
    });

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

    // Jobs source for residential demand.
    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 7 }], anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // past cooldown — only fire coverage can block
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();

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

    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 7 }], anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5,
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
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

    // Jobs source for residential demand.
    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 7 }], anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // past cooldown — only hospital coverage can block
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();

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

    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 7 }], anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5,
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
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

    // Jobs source for residential demand.
    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 7 }], anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5, // past cooldown — only school coverage can block
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();

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

    map.getBuildings().addExistingBuilding({
      id: 999, type: 'commercial',
      footprint: [{ x: 9, y: 7 }], anchor: { x: 9, y: 7 },
      level: ZONE_MAX_LEVEL, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 9, y: 7, w: 1, h: 1 },
    });

    const cooldown = GROWTH_COOLDOWN_INTERVALS;
    const b = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 1,
      density: 0,
      age: cooldown + 5,
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
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
    // residentialCount=0, jobsLevels>0) so the empty-city path is NOT taken.
    // Dirty path: setMoney triggers markHappinessDirty.
    const worldRich = new World(4, 4, { regenerate: false });
    const worldPoor = new World(4, 4, { regenerate: false });

    for (const w of [worldRich, worldPoor]) {
      w.getMap().getBuildings().addExistingBuilding({
        id: 1, type: 'commercial',
        footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
        level: 1, density: 0, age: 0, frontage: 'S',
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
      level: 1, density: 0, age: 0, frontage: 'S',
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
      level: 1, density: 0, age: 0, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    worldBalanced.getMap().getBuildings().addExistingBuilding({
      id: 2, type: 'residential',
      footprint: [{ x: 1, y: 0 }], anchor: { x: 1, y: 0 },
      level: 1, density: 0, age: 0, frontage: 'S',
      structureRect: { x: 1, y: 0, w: 1, h: 1 },
    });
    worldBalanced.getMap().getBuildings().addExistingBuilding({
      id: 3, type: 'commercial',
      footprint: [{ x: 2, y: 0 }], anchor: { x: 2, y: 0 },
      level: 1, density: 0, age: 0, frontage: 'S',
      structureRect: { x: 2, y: 0, w: 1, h: 1 },
    });
    worldBalanced.getMap().getBuildings().addExistingBuilding({
      id: 4, type: 'commercial',
      footprint: [{ x: 3, y: 0 }], anchor: { x: 3, y: 0 },
      level: 1, density: 0, age: 0, frontage: 'S',
      structureRect: { x: 3, y: 0, w: 1, h: 1 },
    });

    // Unbalanced: 4R + 0 jobs.
    worldUnbalanced.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    worldUnbalanced.getMap().getBuildings().addExistingBuilding({
      id: 2, type: 'residential',
      footprint: [{ x: 1, y: 0 }], anchor: { x: 1, y: 0 },
      level: 1, density: 0, age: 0, frontage: 'S',
      structureRect: { x: 1, y: 0, w: 1, h: 1 },
    });
    worldUnbalanced.getMap().getBuildings().addExistingBuilding({
      id: 3, type: 'residential',
      footprint: [{ x: 2, y: 0 }], anchor: { x: 2, y: 0 },
      level: 1, density: 0, age: 0, frontage: 'S',
      structureRect: { x: 2, y: 0, w: 1, h: 1 },
    });
    worldUnbalanced.getMap().getBuildings().addExistingBuilding({
      id: 4, type: 'residential',
      footprint: [{ x: 3, y: 0 }], anchor: { x: 3, y: 0 },
      level: 1, density: 0, age: 0, frontage: 'S',
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
        level: 1, density: 0, age: 0, frontage: 'S',
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
      level: 1, density: 0, age: 0, frontage: 'S',
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
      level: 3, density: 0, age: 0, frontage: 'S',
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
      level: 1, density: 0, age: 0, frontage: 'S',
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
      level: 1, density: 0, age: 0, frontage: 'S',
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
    // residentialCount=0, jobsLevels=1, levelSumR=0:
    //   landScore    = 0  (no residential buildings)
    //   jobsBalance  = clamp01(1 - |1-0| / max(1+0,1)) = 0
    //   budgetHealth = clamp01(STARTING_FUNDS / STARTING_FUNDS) = 1
    // expected = HAPPINESS_W_LAND*0 + HAPPINESS_W_JOBS*0 + HAPPINESS_W_BUDGET*1
    const world = new World(4, 4, { regenerate: false });
    world.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'commercial',
      footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 },
      level: 1, density: 0, age: 0, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.setMoney(STARTING_FUNDS);
    const h = world.getHappiness();
    const expected = HAPPINESS_W_LAND * 0 + HAPPINESS_W_JOBS * 0 + HAPPINESS_W_BUDGET * 1;
    expect(h).toBeCloseTo(expected, 5);
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
      level: 3, density: 0, age: 0, frontage: 'S',
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
