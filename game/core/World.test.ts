import { describe, it, expect } from 'vitest';
import {
  World,
  ZONE_GROWTH_INTERVAL,
  ZONE_MAX_LEVEL,
  POPULATION_PER_LEVEL,
  STARTING_FUNDS,
  TAX_PER_POP,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
} from './World';
import { GROWTH_COOLDOWN_INTERVALS, stagger } from './growthConstants';
import { TileType, createTile } from './Tile';

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
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    // Extra zone types to push diversity score to 1.0 so landValue at (0,0) ≈ 0.9 >= LEVEL_THRESHOLDS[5]=0.85.
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    // Next tick: tickCount = 8*30 = 240 (240 % 8 === 0 → growth) and
    // day = 240 (240 % 30 === 0 → month boundary).
    // 240 % 16 === 0 → land value is force-recomputed before the growth pass.
    world.setElapsedDays(ZONE_GROWTH_INTERVAL * DAYS_PER_MONTH - 1);
    // Seed a building at level (ZONE_MAX_LEVEL - 1) = 4 so it will level up on the growth tick.
    // id=0 (first building), stagger(0)=0, cooldown=8. age=7 → after age+1 = 8 >= 8 → level-up fires.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL - 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    const moneyBefore = world.getMoney();
    const level4Pop = world.getPopulation();
    world.tick();

    expect(world.getMoney()).toBe(
      moneyBefore + Math.floor(level4Pop * TAX_PER_POP) * DAYS_PER_MONTH,
    );
    expect(map.getBuildings().getBuildingAt(0, 0)?.level).toBe(ZONE_MAX_LEVEL);
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
    // 5 zones along a road. Each building gets a distinct id (0-4).
    // With the Knuth hash, their stagger values differ, so level-up ticks differ.
    const world = new World(10, 4, { regenerate: false });
    const map = world.getMap();
    // Road along the top row
    for (let x = 0; x < 10; x++) {
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

    const firstLevelOneTick = new Map<number, number>();

    // Run enough ticks: buildings are created on tick ZONE_GROWTH_INTERVAL;
    // level-up needs cooldown=8+stagger(id) growth ticks after creation.
    // Max stagger=6 → max cooldown=14. With 15 growth intervals that covers all.
    for (let tick = 1; tick <= ZONE_GROWTH_INTERVAL * 20; tick++) {
      const result = world.tick();
      for (const id of result.changedBuildingIds) {
        const b = map.getBuildings().getBuilding(id);
        if (b && b.level === 1 && !firstLevelOneTick.has(id)) {
          firstLevelOneTick.set(id, tick);
        }
      }
    }

    // At least 2 distinct first-level-1 ticks across the 5 buildings
    expect(new Set(firstLevelOneTick.values()).size).toBeGreaterThanOrEqual(2);
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
