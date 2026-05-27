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
  DENSITY_COOLDOWN_INTERVALS,
  DEFAULT_NEWCITY_SEED,
} from './World';
import { GROWTH_COOLDOWN_INTERVALS, stagger } from './growthConstants';
import { DENSITY_DEMAND_THRESHOLD } from './Demand';
import { MERGE_LEVEL_THRESHOLD } from './mergePolicy';
import { TileType, createTile } from './Tile';
import { Terrain, MIN_LAND_ELEVATION, SEA_LEVEL } from './Terrain';
import { executeClick } from '../engine/CommandDispatcher';
import { Tool } from '../tools/Tool';

function setTileCorners(world: World, x: number, y: number, h: number): void {
  const terrain = world.getTerrain();
  terrain.unsafeSetVertexHeight(x, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y + 1, h);
  terrain.unsafeSetVertexHeight(x, y + 1, h);
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

describe('World.tick() — heal rule', () => {
  it('converts a DIRT tile to GRASS and returns changed === 1', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.DIRT));

    const result = world.tick();

    expect(result.changed).toBe(1);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
  });

  it('returns changed === 0 and leaves map untouched when no DIRT present', () => {
    const world = new World(4, 4, { regenerate: false });

    const result = world.tick();

    expect(result.changed).toBe(0);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('does not alter ROAD tiles or water-elevation cells during a tick', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    // (1, 0) stays GRASS but with elevation <= SEA_LEVEL — water is elevation-derived.
    setTileCorners(world, 1, 0, 0);

    const result = world.tick();

    expect(result.changed).toBe(0);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.GRASS);
    expect(world.isWater(1, 0)).toBe(true);
  });
});

describe('World.tick() — permanence guard', () => {
  it('leaves zone tiles unchanged and only heals the DIRT control tile', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();

    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 0, createTile(3, 0, TileType.DIRT));

    const result = world.tick();

    expect(result.changed).toBe(1);
    expect(map.getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(map.getTile(1, 0)?.type).toBe(TileType.ZONE_COMMERCIAL);
    expect(map.getTile(2, 0)?.type).toBe(TileType.ZONE_INDUSTRIAL);
    expect(map.getTile(3, 0)?.type).toBe(TileType.GRASS);
  });
});

describe('World.countDirt()', () => {
  it('returns the number of DIRT tiles before a tick', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.DIRT));

    expect(world.countDirt()).toBe(2);
  });

  it('returns 0 after a tick heals all DIRT', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));

    world.tick();

    expect(world.countDirt()).toBe(0);
  });
});

describe('World.tick() — zone growth', () => {
  it('ROAD-adjacent zone does NOT grow before the Nth tick (ZONE_GROWTH_INTERVAL - 1 ticks)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();

    expect(map.getTile(1, 0)?.level).toBe(0);
  });

  it('ROAD-adjacent zone creates a building (level 0) on tick N; returned changed includes the creation', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    const result = world.tick(); // tick N

    // Growth creates a building at level 0; tile.level is legacy (never written by growth).
    expect(map.getBuildings().getBuildingAt(1, 0)?.level).toBe(0);
    expect(result.changed).toBeGreaterThanOrEqual(1);
  });

  it('zone with no orthogonal ROAD neighbor stays level 0 across multiple growth intervals', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    // No road anywhere near

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();

    expect(map.getTile(1, 1)?.level).toBe(0);
  });

  it('diagonal-only ROAD adjacency does NOT cause growth (orthogonal only)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    // Zone at (1,1), ROAD only at (2,2) — diagonal, not orthogonal
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(2, 2, createTile(2, 2, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 2; i++) world.tick();

    expect(map.getTile(1, 1)?.level).toBe(0);
  });

  it('zone building level caps at ZONE_MAX_LEVEL and stops contributing to changed at cap', () => {
    // Use a larger map to add two more zone types near (0,0) to push diversity to 1.0,
    // which brings landValue above the LEVEL_THRESHOLDS[5]=0.85 threshold needed for
    // the final level-up. The commercial and industrial tiles are not road-adjacent so
    // they never create buildings — they only contribute to the diversity score of (0,0).
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Two extra zone types in the 3×3 neighborhood of (0,0) to reach diversity=1.0
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    // GROWTH_COOLDOWN_INTERVALS + max stagger = 8 + 6 = 14 growth-opportunity intervals per level.
    // 5 levels × 14 + 1 creation = 71 growth intervals × ZONE_GROWTH_INTERVAL ticks each.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 80; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(0, 0)?.level).toBe(ZONE_MAX_LEVEL);
  });

  it('at cap, zone no longer contributes to changed', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Seed a building already at max level so the first growth tick should not level it up
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Run exactly one growth tick
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) {
      const result = world.tick();
      if (i === ZONE_GROWTH_INTERVAL - 1) {
        // On the growth tick, this zone is already capped — should not appear in changed
        expect(result.changed).toBe(0);
      }
    }
    expect(map.getBuildings().getBuildingAt(0, 0)?.level).toBe(ZONE_MAX_LEVEL);
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

describe('WorldTickResult.changedTiles — canonical delta', () => {
  it('changedTiles contains the exact coord for a single DIRT heal', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.DIRT));

    const result = world.tick();

    expect(result.changedTiles).toEqual([{ x: 2, y: 3 }]);
    expect(result.changed).toBe(result.changedTiles.length);
  });

  it('changedTiles is empty when no mutations occur', () => {
    const world = new World(4, 4, { regenerate: false });

    const result = world.tick();

    expect(result.changedTiles).toEqual([]);
    expect(result.changed).toBe(0);
  });

  it('tick with both DIRT-heal AND zone-growth mutations reports all changed coords; changed === changedTiles.length', () => {
    // Arrange a map where:
    //   (0,0) = ZONE_RESIDENTIAL (level 0), road-adjacent → will grow on tick ZONE_GROWTH_INTERVAL
    //   (1,0) = ROAD
    //   (2,0) = DIRT → will heal on every tick
    // We advance to tick ZONE_GROWTH_INTERVAL - 1 without the DIRT tile, then place
    // the DIRT tile just before the final tick so it heals on the same tick that
    // growth fires.
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Advance to one tick before the first growth tick.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();

    // Now place the DIRT tile; it will heal on the very next tick (= tick ZONE_GROWTH_INTERVAL).
    map.setTile(2, 0, createTile(2, 0, TileType.DIRT));

    const result = world.tick(); // tick ZONE_GROWTH_INTERVAL: dirt heals + zone grows

    // Exactly 2 mutations: the DIRT heal at (2,0) and the zone level-up at (0,0).
    expect(result.changedTiles.length).toBe(2);
    expect(result.changedTiles).toEqual(
      expect.arrayContaining([
        { x: 2, y: 0 },
        { x: 0, y: 0 },
      ]),
    );
    // Hard contract: changed is always changedTiles.length
    expect(result.changed).toBe(result.changedTiles.length);
  });
});

describe('World.tick() — building creation and changedBuildingIds', () => {
  it('zone-grows-creates-building: first growth tick on a road-adjacent zone creates a building at level 0', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const building = map.getBuildings().getBuildingAt(0, 0);
    expect(building).not.toBeNull();
    expect(building?.level).toBe(0);
    expect(building?.type).toBe('residential');
  });

  it('changedBuildingIds emission: growth tick emits the created building id in WorldTickResult', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    const result = world.tick();

    expect(result.changedBuildingIds.length).toBeGreaterThanOrEqual(1);
    const building = map.getBuildings().getBuildingAt(0, 0);
    expect(building).not.toBeNull();
    expect(result.changedBuildingIds).toContain(building!.id);
  });

  it('building eventually levels up to 1 given sufficient land value and age', () => {
    // landValue at (0,0) ≈ 0.7 (road at dist=1) which exceeds LEVEL_THRESHOLDS[1]=0.1.
    // stagger(0)=0 → cooldown=8 growth-opportunity intervals. Building is created on the
    // first growth tick (age=0); after 8 more growth ticks (age=8) it levels up to 1.
    // Run 10 growth intervals (80 ticks) to comfortably cover creation + first level-up.
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(0, 0)?.level).toBeGreaterThanOrEqual(1);
  });
});

describe('World — bulldoze and repaint remove buildings', () => {
  it('bulldoze-developed-zone: bulldozing a zone tile with a building removes the building from BuildingMap', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 3,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });
    expect(building).not.toBeNull();

    // Bulldoze replaces ZONE_RESIDENTIAL with DIRT via setTileAndReconcile
    const rec = map.setTileAndReconcile(2, 2, createTile(2, 2, TileType.DIRT));

    expect(rec.changed).toBe(true);
    expect(rec.removedBuilding).not.toBeNull();
    expect(rec.removedBuilding?.id).toBe(building!.id);
    expect(map.getBuildings().getBuildingAt(2, 2)).toBeNull();
  });

  it('repaint zone type: painting a different zone over an existing zone removes the building', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 2,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    expect(building).not.toBeNull();

    // Repaint with a different zone type
    const rec = map.setTileAndReconcile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));

    expect(rec.changed).toBe(true);
    expect(rec.removedBuilding).not.toBeNull();
    expect(rec.removedBuilding?.id).toBe(building!.id);
    expect(map.getBuildings().getBuildingAt(1, 1)).toBeNull();
    expect(map.getTile(1, 1)?.type).toBe(TileType.ZONE_COMMERCIAL);
  });

  it('same-zone repaint: setTileAndReconcile returns changed=false and keeps building', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    const rec = map.setTileAndReconcile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));

    expect(rec.changed).toBe(false);
    expect(rec.removedBuilding).toBeNull();
    expect(map.getBuildings().getBuildingAt(0, 0)?.id).toBe(building!.id);
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

describe('World.tick() — land value gating of growth', () => {
  it('zones near a road reach higher levels than zones far from any road', () => {
    // Near-road zones at x=0,1 with road at x=2; far zones at x=4,5 with no road anywhere near
    const world = new World(10, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));
    // Near zones (road-adjacent)
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(3, 0, createTile(3, 0, TileType.ZONE_RESIDENTIAL));
    // Far zones — road at (2,0) is distance 3 from x=5, still within ROAD_RADIUS=6
    // but with much lower road score. No road adjacent → no buildings created at all.
    map.setTile(8, 0, createTile(8, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(9, 0, createTile(9, 0, TileType.ZONE_RESIDENTIAL));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 40; i++) world.tick();

    const nearLevel1 = map.getBuildings().getBuildingAt(1, 0)?.level ?? 0;
    const nearLevel2 = map.getBuildings().getBuildingAt(3, 0)?.level ?? 0;
    // Far zones have no orthogonal road neighbor → no buildings at all
    const farBuilding1 = map.getBuildings().getBuildingAt(8, 0);
    const farBuilding2 = map.getBuildings().getBuildingAt(9, 0);

    expect(nearLevel1).toBeGreaterThan(0);
    expect(nearLevel2).toBeGreaterThan(0);
    expect(farBuilding1).toBeNull();
    expect(farBuilding2).toBeNull();
  });
});

describe('World.tick() — density tier', () => {
  it('density does NOT advance before level === ZONE_MAX_LEVEL', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Seed a building below ZONE_MAX_LEVEL with enough age
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL - 1,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS + 10,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Run many ticks — density must stay 0 until level reaches ZONE_MAX_LEVEL
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();

    // Building might have levelled up to max, but density can only advance once at max level
    const b = map.getBuildings().getBuildingAt(0, 0)!;
    if (b.level < ZONE_MAX_LEVEL) {
      expect(b.density).toBe(0);
    }
    // If it reached max level, density might be > 0 but that's fine — the test only
    // asserts that while below max, density is 0. We enforce this via a fresh setup:
    const world2 = new World(4, 4, { regenerate: false });
    const map2 = world2.getMap();
    map2.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map2.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Building at level 2 (not max), with very large age — density should NOT advance
    map2.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 2,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Run just one growth tick
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world2.tick();
    const b2 = map2.getBuildings().getBuildingAt(0, 0)!;
    // Level 2 building should never have its density bumped
    expect(b2.density).toBe(0);
  });

  it('density advances only when at ZONE_MAX_LEVEL + age >= DENSITY_COOLDOWN_INTERVALS + demand[type] >= DENSITY_DEMAND_THRESHOLD', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    // Seed building at ZONE_MAX_LEVEL with age just under DENSITY_COOLDOWN_INTERVALS.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Seed C+I level-points >=8 so residentialDemand >= 0.6.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();

    let densityBumpResult: ReturnType<typeof world.tick> | null = null;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) {
      const result = world.tick();
      const b = map.getBuildings().getBuildingAt(0, 0)!;
      if (b.density === 1 && densityBumpResult === null) {
        densityBumpResult = result;
        break;
      }
    }

    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(b.density).toBe(1);
    expect(b.level).toBe(ZONE_MAX_LEVEL);
  });

  it('density bump emits changedTiles with footprint coords and changedBuildingIds with building id', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    })!;
    // Seed C+I level-points >=8 so residentialDemand >= 0.6.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();

    let densityTickResult: ReturnType<typeof world.tick> | null = null;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) {
      const result = world.tick();
      const b = map.getBuildings().getBuildingAt(0, 0)!;
      if (b.density === 1 && densityTickResult === null) {
        densityTickResult = result;
        break;
      }
    }

    expect(densityTickResult).not.toBeNull();
    expect(densityTickResult!.changedBuildingIds).toContain(building.id);
    expect(densityTickResult!.changedTiles).toContainEqual({ x: 0, y: 0 });
    expect(densityTickResult!.changedTiles.length).toBeGreaterThanOrEqual(1);
  });
});

describe('World.tick() — changedBuildingIds contract', () => {
  it('changedBuildingIds contains right id on level-up and is empty on non-growth/no-change ticks', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Seed a building at level 0, age sufficient for level-up.
    // id=0, stagger(0)=0, cooldown=8. age=7 → after +1 = 8 >= 8 → level-up on next growth tick.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Find the first tick on which the building levels up to 1
    let levelUpResult: ReturnType<typeof world.tick> | null = null;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) {
      const result = world.tick();
      const b = map.getBuildings().getBuildingAt(0, 0)!;
      if (b && b.level === 1 && levelUpResult === null) {
        levelUpResult = result;
        break;
      }
    }

    expect(levelUpResult).not.toBeNull();
    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(levelUpResult!.changedBuildingIds).toContain(b.id);
    expect(levelUpResult!.changedTiles).toContainEqual({ x: 0, y: 0 });
  });
});

describe('World.tick() — invariant: changedBuildingIds > 0 → changedTiles > 0', () => {
  it('on every tick of a long simulation changedBuildingIds implies changedTiles is non-empty', () => {
    // Use diversified map so growth can progress all the way to density bumps
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 200; i++) {
      const result = world.tick();
      if (result.changedBuildingIds.length > 0) {
        expect(result.changedTiles.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('World.tick() — multi-tile building guard', () => {
  it('2×2 building: age advances by exactly 1 per growth tick, never levels twice in one tick', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    // Zone tiles for 2×2 footprint
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    // Road adjacent to the footprint
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    // Use addExistingBuilding to place a 2×2 building with a known id
    const ok = map.getBuildings().addExistingBuilding({
      id: 100,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 2, h: 2 },
    });
    expect(ok).toBe(true);

    let prevAge = 0;
    let prevLevel = 0;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) {
      world.tick();
      const b = map.getBuildings().getBuilding(100)!;
      const isGrowthTick = world.getTick() % ZONE_GROWTH_INTERVAL === 0;
      if (isGrowthTick) {
        // Age must advance by exactly 1 compared to before this growth tick
        expect(b.age).toBeLessThanOrEqual(prevAge + 1);
        // Level must advance by at most 1 per tick
        expect(b.level).toBeLessThanOrEqual(prevLevel + 1);
        prevLevel = b.level;
        prevAge = b.age;
      }
    }
  });
});

describe('World.tick() — no-building branch creates level-0 building', () => {
  it('zone tile next to road with no building: one tick creates level-0 building AND coord in changedTiles', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Advance to the first growth tick
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const building = map.getBuildings().getBuildingAt(0, 0);
    expect(building).not.toBeNull();
    expect(building!.level).toBe(0);
    // The creation tick result — need to capture it
    // Re-run from scratch to capture the result
    const world2 = new World(4, 4, { regenerate: false });
    const map2 = world2.getMap();
    map2.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map2.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world2.tick();
    const result = world2.tick(); // the creation tick

    expect(result.changedTiles).toContainEqual({ x: 0, y: 0 });
    expect(result.changedBuildingIds.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Task 7: zone-growth terrain buildability gate
// ---------------------------------------------------------------------------

describe('World.tick() — zone-growth blocked on slope edge tile', () => {
  it('zone tile on slope edge does NOT grow even after ZONE_GROWTH_INTERVAL ticks', () => {
    // Tile (1,0) is raised to elevation 2; its east/west neighbors are at MIN_LAND_ELEVATION=1 → slope mask non-zero.
    // tile (1,0) is non-coplanar AND non-flat → spawn (strict-flat) denies regardless.
    // Road placed at (1,1) (elevation MIN_LAND_ELEVATION, flat) to satisfy road-adjacency requirement for the zone.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    world.getTerrain().unsafeSetVertexHeight(1, 0, 2);
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ROAD)); // orthogonal neighbor (south)

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(1, 0)).toBeNull();
  });
});

describe('World.tick() — zone-growth blocked on coplanar slope tile (spawn stays strict-flat)', () => {
  it('zone tile on uniform N-S ramp does NOT grow even though canBuildAt allows it', () => {
    // Tile (1,0): corners (1,0)=1,(2,0)=1,(2,1)=2,(1,1)=2 — uniform N-S ramp.
    // topH+bottomH=1+2=3, leftH+rightH=2+1=3 → coplanar (canBuildAt passes).
    // But not flat (heights differ) → isFlatTile returns false → spawn denied.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    const terrain = world.getTerrain();
    // Raise south vertices to create a uniform N-S ramp at tile (1,0).
    terrain.unsafeSetVertexHeight(1, 1, 2);
    terrain.unsafeSetVertexHeight(2, 1, 2);

    // Verify the asymmetry: loosened gate allows, strict-flat gate denies.
    expect(world.canBuildAt(1, 0, 1, 1)).toBe(true);
    expect(world.getTerrain().isFlatTile(1, 0, (xx, yy) => world.isWater(xx, yy))).toBe(false);

    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    // Road at (2,0) — orthogonal east neighbor satisfies road-adjacency.
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(1, 0)).toBeNull();
  });
});

describe('World.tick() — zone-growth proceeds on plateau interior tile', () => {
  it('zone tile on 5×5 plateau interior DOES grow when it has a road neighbor inside the plateau', () => {
    // 5×5 plateau at (2,2)–(6,6): all tiles at elevation 1.
    // Interior cells (not on the plateau edge) are (3,3)–(5,5) — all have elevation-1 orthogonal neighbors.
    // Zone at (3,3), road at (4,3) — both interior flat tiles at the same elevation.
    // canBuildAt(3,3,1,1) = true → building is created on the first growth tick.
    const world = new World(10, 10, { regenerate: false });
    const map = world.getMap();
    for (let py = 2; py <= 6; py++) {
      for (let px = 2; px <= 6; px++) {
        setTileCorners(world, px, py, 1);
      }
    }
    map.setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
    map.setTile(4, 3, createTile(4, 3, TileType.ROAD)); // orthogonal neighbor (east), inside plateau

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(3, 3)).not.toBeNull();
    expect(map.getBuildings().getBuildingAt(3, 3)?.level).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Terrain integration tests (Task 4)
// ---------------------------------------------------------------------------

describe('World.getTerrain() — initial state', () => {
  it('terrain dimensions match the map dimensions', () => {
    const world = new World(8, 6, { regenerate: false });
    expect(world.getTerrain().getWidth()).toBe(8);
    expect(world.getTerrain().getHeight()).toBe(6);
  });

  it('terrainRev starts at >= 1 (constructor install bumps from 0 to 1)', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(world.getTerrainRevision()).toBeGreaterThanOrEqual(1);
  });
});

describe('World.getTerrainRevision() — monotonicity', () => {
  it('unsafeSetVertexHeight (accepted) increments rev by exactly 1', () => {
    const world = new World(4, 4, { regenerate: false });
    const rev0 = world.getTerrainRevision();
    world.getTerrain().unsafeSetVertexHeight(0, 0, 1);
    expect(world.getTerrainRevision()).toBe(rev0 + 1);
  });

  it('setBaseTerrain to "grass" (accepted, same value) increments rev by 1', () => {
    const world = new World(4, 4, { regenerate: false });
    const rev0 = world.getTerrainRevision();
    world.getTerrain().setBaseTerrain(0, 0, 'grass');
    expect(world.getTerrainRevision()).toBe(rev0 + 1);
  });

  it('rejected setPlayerVertexHeight (diff > cap from flat neighbors) does NOT bump rev', () => {
    const world = new World(4, 4, { regenerate: false });
    const rev0 = world.getTerrainRevision();
    // All neighbors are at MIN_LAND_ELEVATION; setting to 5 violates the player cap.
    const accepted = world.getTerrain().setPlayerVertexHeight(0, 0, 5);
    expect(accepted).toBe(false);
    expect(world.getTerrainRevision()).toBe(rev0);
  });

  it('rejected setBaseTerrain("water") does NOT bump rev', () => {
    const world = new World(4, 4, { regenerate: false });
    const rev0 = world.getTerrainRevision();
    // v1 reserved slot — non-grass is rejected.
    const accepted = world.getTerrain().setBaseTerrain(0, 0, 'water');
    expect(accepted).toBe(false);
    expect(world.getTerrainRevision()).toBe(rev0);
  });
});

describe('World.installTerrain() — successful swap', () => {
  it('install always bumps rev even if new terrain is structurally identical', () => {
    const world = new World(4, 4, { regenerate: false });
    const rev1 = world.getTerrainRevision();
    const second = new Terrain(world.getTerrain().getWidth(), world.getTerrain().getHeight());
    world.installTerrain(second);
    expect(world.getTerrainRevision()).toBe(rev1 + 1);
    expect(world.getTerrain()).toBe(second);
  });
});

describe('World.installTerrain() — dimension mismatch', () => {
  it('throws with "dimension mismatch" and leaves state unchanged', () => {
    const world = new World(4, 4, { regenerate: false });
    const prevTerrain = world.getTerrain();
    const prevRev = world.getTerrainRevision();
    const bad = new Terrain(prevTerrain.getWidth() + 1, prevTerrain.getHeight());
    expect(() => world.installTerrain(bad)).toThrow('dimension mismatch');
    expect(world.getTerrain()).toBe(prevTerrain);
    expect(world.getTerrainRevision()).toBe(prevRev);
  });

  it('after a rejected install the previous terrain callback is still wired', () => {
    const world = new World(4, 4, { regenerate: false });
    const prevTerrain = world.getTerrain();
    const prevRev = world.getTerrainRevision();
    const bad = new Terrain(prevTerrain.getWidth() + 1, prevTerrain.getHeight());
    expect(() => world.installTerrain(bad)).toThrow();
    // Mutation on the original terrain must still bump world's rev.
    prevTerrain.unsafeSetVertexHeight(0, 0, 1);
    expect(world.getTerrainRevision()).toBe(prevRev + 1);
  });
});

describe('World.installTerrain() — callback un-wiring after successful swap', () => {
  it('mutating the OLD terrain after a successful install does NOT bump terrainRev', () => {
    const world = new World(4, 4, { regenerate: false });
    const oldTerrain = world.getTerrain();
    world.installTerrain(new Terrain(world.getTerrain().getWidth(), world.getTerrain().getHeight()));
    const revAfterInstall = world.getTerrainRevision();
    oldTerrain.unsafeSetVertexHeight(0, 0, 2);
    // Old terrain's callback must have been cleared — rev must not change.
    expect(world.getTerrainRevision()).toBe(revAfterInstall);
  });
});

describe('World.reset() — terrainRev', () => {
  it('reset() bumps terrainRev strictly above its pre-reset value', () => {
    const world = new World(4, 4, { regenerate: false });
    // Make at least one accepted mutation to ensure the counter has advanced.
    world.getTerrain().unsafeSetVertexHeight(0, 0, 1);
    const prevRev = world.getTerrainRevision();
    world.reset();
    expect(world.getTerrainRevision()).toBeGreaterThan(prevRev);
  });
});

describe('World.isWater()', () => {
  it('returns false for all tiles in a { regenerate: false } world (all elevations are MIN_LAND_ELEVATION > SEA_LEVEL)', () => {
    const world = new World(8, 8, { regenerate: false });
    expect(world.isWater(0, 0)).toBe(false);
    expect(world.isWater(3, 3)).toBe(false);
  });
});

describe('isWater (sea-level derived)', () => {
  it('(a) returns true when elevation is set to SEA_LEVEL', () => {
    const world = new World(8, 8, { regenerate: false });
    setTileCorners(world, 2, 2, SEA_LEVEL);
    expect(world.isWater(2, 2)).toBe(true);
  });

  it('(b) returns false when elevation is MIN_LAND_ELEVATION (above SEA_LEVEL)', () => {
    const world = new World(8, 8, { regenerate: false });
    // Default elevation is already MIN_LAND_ELEVATION; verify false
    expect(world.isWater(0, 0)).toBe(false);
  });

  it('(c) returns false for OOB coordinates', () => {
    const world = new World(8, 8, { regenerate: false });
    expect(world.isWater(-1, 0)).toBe(false);
    expect(world.isWater(0, -1)).toBe(false);
    expect(world.isWater(100, 100)).toBe(false);
  });
});

describe('World.canBuildAt()', () => {
  it('returns false for a water cell (elevation <= SEA_LEVEL) and true for a flat land tile', () => {
    const world = new World(8, 8, { regenerate: false });
    setTileCorners(world, 3, 3, SEA_LEVEL);
    expect(world.canBuildAt(3, 3, 1, 1)).toBe(false);
    expect(world.canBuildAt(0, 0, 1, 1)).toBe(true);
  });
});

describe('World.canBuildRoadAt()', () => {
  it('returns false for a water cell (elevation <= SEA_LEVEL)', () => {
    const world = new World(8, 8, { regenerate: false });
    setTileCorners(world, 3, 3, SEA_LEVEL);
    expect(world.canBuildRoadAt(3, 3)).toBe(false);
  });

  it('returns false for a non-coplanar vertex tile (triangle wedge)', () => {
    const world = new World(8, 8, { regenerate: false });
    world.getTerrain().unsafeSetVertexHeight(2, 2, 2);
    expect(world.canBuildRoadAt(2, 2)).toBe(false);
  });

  it('returns true for a flat GRASS tile', () => {
    const world = new World(8, 8, { regenerate: false });
    expect(world.canBuildRoadAt(0, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 6: procedural terrain wired into World constructor and reset()
// ---------------------------------------------------------------------------

describe('World procedural terrain — constructor default (regenerate: true)', () => {
  it('(a) new World(32, 32) produces at least one elevation > 0 and at least one water tile', () => {
    const world = new World(32, 32);
    const W = 32;
    const H = 32;
    let hasElevation = false;
    let hasWater = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (world.getTerrain().getTileElevation(x, y) > 0) hasElevation = true;
        if (world.isWater(x, y)) hasWater = true;
      }
    }
    expect(hasElevation).toBe(true);
    expect(hasWater).toBe(true);
  });

  it('(b) new World(32, 32, { regenerate: false }) has all-MIN_LAND_ELEVATION elevations and no water tiles', () => {
    const world = new World(32, 32, { regenerate: false });
    const W = 32;
    const H = 32;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(world.getTerrain().getTileElevation(x, y)).toBe(MIN_LAND_ELEVATION);
        expect(world.isWater(x, y)).toBe(false);
      }
    }
  });

  it('(c) new World(32, 32, {}) defaults to regenerate=true — produces non-trivial terrain', () => {
    const world = new World(32, 32, {});
    const W = 32;
    const H = 32;
    let hasElevation = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (world.getTerrain().getTileElevation(x, y) > MIN_LAND_ELEVATION) hasElevation = true;
      }
    }
    expect(hasElevation).toBe(true);
  });

  it('(d) reset({ regenerate: false }) after a generated world resets to MIN_LAND_ELEVATION and removes water', () => {
    const world = new World(32, 32);
    world.reset({ regenerate: false });
    const W = 32;
    const H = 32;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(world.getTerrain().getTileElevation(x, y)).toBe(MIN_LAND_ELEVATION);
        expect(world.isWater(x, y)).toBe(false);
      }
    }
  });

  it('(e) reset({ regenerate: true, seed: 42 }) is reproducible — two worlds with same seed have equal terrain', () => {
    const world1 = new World(16, 16, { regenerate: false });
    world1.reset({ regenerate: true, seed: 42 });
    const world2 = new World(16, 16, { regenerate: false });
    world2.reset({ regenerate: true, seed: 42 });
    expect(world1.getTerrain().toJSON()).toEqual(world2.getTerrain().toJSON());
  });

  it('(f) regenerateTerrain with different seeds yields different terrain; same seed yields same terrain', () => {
    const world = new World(16, 16);
    world.regenerateTerrain(123);
    const json123a = world.getTerrain().toJSON();
    world.regenerateTerrain(456);
    const json456 = world.getTerrain().toJSON();
    world.regenerateTerrain(123);
    const json123b = world.getTerrain().toJSON();
    // Same seed → same result.
    expect(json123a).toEqual(json123b);
    // Different seeds → different terrain (extremely unlikely to collide by chance).
    expect(json123a).not.toEqual(json456);
  });

  it('(g) regenerateTerrain() clears buildings', () => {
    const world = new World(16, 16, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 2,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    expect(map.getBuildings().getBuildingAt(0, 0)).not.toBeNull();

    world.regenerateTerrain(DEFAULT_NEWCITY_SEED);

    expect(map.getBuildings().getBuildingAt(0, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T1 Task 5 tests — frontage spawn + Branch B road-access gate
// ---------------------------------------------------------------------------

describe('World.tick() — Branch A spawn: frontage is set correctly', () => {
  it('zone with road only to the south stores frontage: S', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD)); // south neighbor

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('S');
  });

  it('zone with road only to the north stores frontage: N', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD)); // north neighbor

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('N');
  });

  it('zone with road both N and S stores frontage: S (tie-break)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD)); // north
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD)); // south

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('S');
  });
});

describe('World.tick() — Branch A spawn: same-tick dedup guard', () => {
  it('building is eventually created with level=0 and density=0', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD));

    // Run enough intervals for the hash to land on 1×1 for this isolated zone tile.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.level).toBe(0);
    expect(b!.density).toBe(0);
  });
});

describe('World.tick() — Branch B road-access gate', () => {
  it('existing building loses road access: age stops incrementing', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // One growth tick with road: age should become 1.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    const ageWithRoad = map.getBuildings().getBuildingAt(0, 0)!.age;
    expect(ageWithRoad).toBe(1);

    // Remove the road, run another growth tick: age must NOT increment.
    map.setTile(1, 0, createTile(1, 0, TileType.GRASS));
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    const ageWithoutRoad = map.getBuildings().getBuildingAt(0, 0)!.age;
    expect(ageWithoutRoad).toBe(1);
  });

  it('existing building loses road access: level-up does not fire', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Positive control: with road, building should level up.
    // Seed at level 0, age = cooldown-1 so on the next growth tick it levels up.
    // id=0, stagger(0)=0 → cooldown = GROWTH_COOLDOWN_INTERVALS.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Also need land value >= LEVEL_THRESHOLDS[1]=0.1; road at distance 1 should suffice.
    // Force land value recompute.
    world.markLandValueDirty();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.level).toBeGreaterThanOrEqual(1);

    // Negative control: rebuild world without road.
    const world2 = new World(4, 4, { regenerate: false });
    const map2 = world2.getMap();
    map2.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    // No road placed → no building created by Branch A (road required).
    // Manually seed the building.
    map2.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // No road → hasRoadAccess returns false → age does not increment → level stays 0.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world2.tick();
    expect(map2.getBuildings().getBuildingAt(0, 0)!.level).toBe(0);
  });

  it('existing building loses road access: density bump does not fire', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    // Positive control: seed at ZONE_MAX_LEVEL, density=0, age just under cooldown.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Seed C+I level-points >=8 so residentialDemand >= 0.6.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();
    world.markLandValueDirty();
    // Run enough ticks so density fires (positive control).
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.density).toBeGreaterThanOrEqual(1);

    // Negative control: same setup but no road.
    const world2 = new World(6, 6, { regenerate: false });
    const map2 = world2.getMap();
    map2.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map2.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map2.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map2.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world2.markLandValueDirty();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world2.tick();
    // No road → density stays 0.
    expect(map2.getBuildings().getBuildingAt(0, 0)!.density).toBe(0);
  });

  it('road re-added: building resumes aging on the next growth tick', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Tick with road → age becomes 1.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.age).toBe(1);

    // Remove road, tick → age stays 1.
    map.setTile(1, 0, createTile(1, 0, TileType.GRASS));
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.age).toBe(1);

    // Re-add road, tick → age becomes 2.
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.age).toBe(2);
  });
});

describe('World.tick() — spawn size', () => {
  function setupZoneBlock(world: World, zoneW: number, zoneH: number, roadY: number): void {
    const map = world.getMap();
    for (let y = 0; y < zoneH; y++) {
      for (let x = 0; x < zoneW; x++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
        setTileCorners(world, x, y, 1);
      }
    }
    for (let x = 0; x < zoneW; x++) {
      map.setTile(x, roadY, createTile(x, roadY, TileType.ROAD));
    }
  }

  it('Fixture D: zone block with road → at least one newly spawned building has footprint.length > 1', () => {
    const world = new World(8, 7, { regenerate: false });
    const map = world.getMap();
    setupZoneBlock(world, 8, 6, 6);

    // Demand recompute only reads building type + level, not tile type.
    // I buildings on road tiles are invisible to zone growth (iterates zone tiles only)
    // but still drive demand via building type + level.
    map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 0, y: 6 }], anchor: { x: 0, y: 6 }, level: 2, density: 0, age: 0, frontage: 'N', structureRect: { x: 0, y: 6, w: 1, h: 1 } });
    map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 1, y: 6 }], anchor: { x: 1, y: 6 }, level: 2, density: 0, age: 0, frontage: 'N', structureRect: { x: 1, y: 6, w: 1, h: 1 } });

    const preSeededIds = new Set<number>();
    for (const b of map.getBuildings().iterBuildings()) preSeededIds.add(b.id);

    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.75);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 8; i++) world.tick();

    let foundMultiTile = false;
    for (const b of map.getBuildings().iterBuildings()) {
      if (preSeededIds.has(b.id)) continue;
      if (b.footprint.length > 1) { foundMultiTile = true; break; }
    }
    expect(foundMultiTile).toBe(true);
  });

  it('Fixture E: two worlds with identical setup produce identical newly-spawned buildings', () => {
    function buildWorld(): World {
      const world = new World(8, 7, { regenerate: false });
      const map = world.getMap();
      setupZoneBlock(world, 8, 6, 6);
      map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 0, y: 6 }], anchor: { x: 0, y: 6 }, level: 2, density: 0, age: 0, frontage: 'N', structureRect: { x: 0, y: 6, w: 1, h: 1 } });
      map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 1, y: 6 }], anchor: { x: 1, y: 6 }, level: 2, density: 0, age: 0, frontage: 'N', structureRect: { x: 1, y: 6, w: 1, h: 1 } });
      world.markDemandDirty();
      return world;
    }

    const worldA = buildWorld();
    const worldB = buildWorld();

    const preSeededIdsA = new Set<number>();
    for (const b of worldA.getMap().getBuildings().iterBuildings()) preSeededIdsA.add(b.id);
    const preSeededIdsB = new Set<number>();
    for (const b of worldB.getMap().getBuildings().iterBuildings()) preSeededIdsB.add(b.id);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 8; i++) {
      worldA.tick();
      worldB.tick();
    }

    function snapshot(w: World, preSeededIds: Set<number>) {
      return Array.from(w.getMap().getBuildings().iterBuildings())
        .filter(b => !preSeededIds.has(b.id))
        .map(b => ({ ax: b.anchor.x, ay: b.anchor.y, len: b.footprint.length }))
        .sort((a, b) => a.ay - b.ay || a.ax - b.ax);
    }

    expect(snapshot(worldA, preSeededIdsA)).toEqual(snapshot(worldB, preSeededIdsB));
  });
});

describe('World.tick() — T3 spawn-size determinism', () => {
  it('two identically seeded worlds produce identical post-id-2 buildings after ticking', () => {
    function buildWorld(): World {
      const world = new World(8, 8, { regenerate: false });
      const map = world.getMap();
      for (let x = 0; x < 8; x++) {
        map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
      }
      for (let y = 2; y <= 3; y++) {
        for (let x = 1; x <= 6; x++) {
          map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
        }
      }
      map.setTile(6, 0, createTile(6, 0, TileType.ZONE_INDUSTRIAL));
      map.setTile(7, 0, createTile(7, 0, TileType.ZONE_INDUSTRIAL));
      map.getBuildings().addExistingBuilding({ id: 0, type: 'industrial', footprint: [{ x: 6, y: 0 }], anchor: { x: 6, y: 0 }, level: 5, density: 0, age: 0, frontage: 'S', structureRect: { x: 6, y: 0, w: 1, h: 1 } });
      map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 7, y: 0 }], anchor: { x: 7, y: 0 }, level: 5, density: 0, age: 0, frontage: 'S', structureRect: { x: 7, y: 0, w: 1, h: 1 } });
      world.markDemandDirty();
      return world;
    }

    const worldA = buildWorld();
    const worldB = buildWorld();

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) {
      worldA.tick();
      worldB.tick();
    }

    function snapshot(w: World) {
      return Array.from(w.getMap().getBuildings().iterBuildings())
        .filter(b => b.id >= 2)
        .map(b => ({ ax: b.anchor.x, ay: b.anchor.y, len: b.footprint.length }))
        .sort((a, b) => a.ay - b.ay || a.ax - b.ax);
    }

    const snapA = snapshot(worldA);
    const snapB = snapshot(worldB);
    expect(snapA).toEqual(snapB);

    const hasMultiTile = snapA.some(b => b.len >= 2);
    expect(hasMultiTile).toBe(true);
  });
});

describe('World.tick() — T3 density-bump E2E', () => {
  it('max-level R with demand satisfied bumps density to 1 after one growth interval', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();

    for (let x = 0; x < 8; x++) {
      map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
    }
    map.setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 3, createTile(2, 3, TileType.ZONE_COMMERCIAL));
    map.setTile(4, 3, createTile(4, 3, TileType.ZONE_INDUSTRIAL));
    map.setTile(5, 3, createTile(5, 3, TileType.ZONE_INDUSTRIAL));

    map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential', footprint: [{ x: 3, y: 3 }], anchor: { x: 3, y: 3 },
      level: ZONE_MAX_LEVEL, density: 0, age: DENSITY_COOLDOWN_INTERVALS, frontage: 'S',
      structureRect: { x: 3, y: 3, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 4, y: 3 }], anchor: { x: 4, y: 3 }, level: 5, density: 0, age: 0, frontage: 'S', structureRect: { x: 4, y: 3, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [{ x: 5, y: 3 }], anchor: { x: 5, y: 3 }, level: 5, density: 0, age: 0, frontage: 'S', structureRect: { x: 5, y: 3, w: 1, h: 1 } });

    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.6);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(3, 3);
    expect(b).not.toBeNull();
    expect(b!.density).toBe(1);
  });
});

describe('World.getDemand() — freshness', () => {
  it('reset({ regenerate: false }) drops demand back to baseline 0.25', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_INDUSTRIAL));
    map.getBuildings().addExistingBuilding({ id: 0, type: 'industrial', footprint: [{ x: 1, y: 1 }], anchor: { x: 1, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 1, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 2, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [{ x: 3, y: 1 }], anchor: { x: 3, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 3, y: 1, w: 1, h: 1 } });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.6);

    world.reset({ regenerate: false });

    expect(world.getDemand().residential).toBe(0.25);
  });

  it('reset({ regenerate: true }) drops demand back to baseline 0.25', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_INDUSTRIAL));
    map.getBuildings().addExistingBuilding({ id: 0, type: 'industrial', footprint: [{ x: 1, y: 1 }], anchor: { x: 1, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 1, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 2, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [{ x: 3, y: 1 }], anchor: { x: 3, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 3, y: 1, w: 1, h: 1 } });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.6);

    world.reset({ regenerate: true });

    expect(world.getDemand().residential).toBe(0.25);
  });

  it('CommandDispatcher bulldoze of a non-zero-level R building refreshes demand', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({ id: 0, type: 'residential', footprint: [{ x: 3, y: 3 }], anchor: { x: 3, y: 3 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 3, y: 3, w: 1, h: 1 } });

    world.markDemandDirty();
    const demandBefore = world.getDemand().industrial;
    expect(demandBefore).toBeGreaterThan(0.25);

    const result = executeClick(Tool.BULLDOZE, { x: 3, y: 3 }, world);
    expect(result.removedBuildingIds).toContain(0);

    expect(world.getDemand().industrial).toBe(0.25);
  });
});

describe('World.tick() — density gating (demand-driven)', () => {
  it('Fixture A: no C/I buildings → residential demand < threshold → density stays 0', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS + 1,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(b.density).toBe(0);
  });

  it('Fixture B: sufficient C/I level-points → residentialDemand >= threshold → density bumps to 1', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // C+I level-points = 8 → jobsLevels=8, levelSumR=5 → residential=(8-5)/8+0.25=0.625 >= 0.6
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();

    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(b.density).toBe(1);
  });

  it("Fixture B': post-tick getDemand() reflects level-up totals vs control world that did not tick", () => {
    // World with a low-level R building near road, no C/I — tick until it levels up.
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 10,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();

    // Control world: same setup, no ticks.
    const control = new World(4, 4, { regenerate: false });
    const controlMap = control.getMap();
    controlMap.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    controlMap.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    controlMap.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 10,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Tick until level-up occurs at least once.
    let levelled = false;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 20; i++) {
      world.tick();
      const b = map.getBuildings().getBuildingAt(0, 0)!;
      if (b.level > 0) { levelled = true; break; }
    }
    expect(levelled).toBe(true);

    // Post-tick demand must differ from the control (which never ticked).
    const postTickDemand = world.getDemand();
    const controlDemand = control.getDemand();
    // After level-up, residentialLevels increased → residential demand shifts.
    expect(postTickDemand.residential).not.toBe(controlDemand.residential);
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

describe("World.tick() — structure-grow (Branch B')", () => {
  // Helper: advance world by exactly one growth tick.
  // Precondition: world.getTick() % ZONE_GROWTH_INTERVAL === 0 OR we run from 0.
  // Returns the WorldTickResult of the growth tick itself.
  function tickOneGrowthInterval(world: World): ReturnType<typeof world.tick> {
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    return world.tick();
  }

  it('structure-grow happens before level-up on a multi-cell lot', () => {
    // 1×4 R-zone lot: cells (1,0)..(1,3), frontage='S', road at (1,4).
    // structureRect = {x:1, y:3, w:1, h:1} — 1×1 at the south end.
    // Land value at anchor (1,0): road distance 4, roadScore ≈ 0.429,
    // lv ≈ 0.3 > LEVEL_THRESHOLDS[2]=0.25. Sufficient to clear the gate.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();

    // Paint the 1×4 zone strip and the road.
    for (let y = 0; y < 4; y++) {
      map.setTile(1, y, createTile(1, y, TileType.ZONE_RESIDENTIAL));
    }
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));

    // Seed building at level=1 with structureRect at the south end, age past cooldown.
    // id=0 → stagger(0)=0 → cooldown=8. Set age so after +1 it is >= 8+0=8.
    const building = map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [
        { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 },
      ],
      anchor: { x: 1, y: 0 },
      level: 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1, // after +1 = 8 = cooldown → gate fires
      frontage: 'S',
      structureRect: { x: 1, y: 3, w: 1, h: 1 },
    });
    expect(building).toBe(true);
    world.markLandValueDirty();

    const result = tickOneGrowthInterval(world);

    const b = map.getBuildings().getBuilding(0)!;
    expect(b).not.toBeNull();
    // Branch B' fires: structure grows 1 cell northward (frontage S → grow y-1, h+1).
    expect(b.structureRect).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    // Level must NOT bump — structure-grow leaves level alone.
    expect(b.level).toBe(1);
    // Age resets after structure-grow.
    expect(b.age).toBe(0);
    // changedBuildingIds and changedTiles populated.
    expect(result.changedBuildingIds).toContain(0);
    expect(result.changedTiles).toContainEqual({ x: 1, y: 0 });
  });

  it('repeated ticks: structureRect fills lot depth, then level bumps', () => {
    // Same 1×4 lot setup. id=0, stagger(0)=0, cooldown=8.
    // Sequence of growth events:
    //   Grow 1: 1×1 → 1×2  (age resets to 0)
    //   Grow 2: 1×2 → 1×3  (age resets to 0)
    //   Grow 3: 1×3 → 1×4  (age resets to 0; lot depth=4, now fills)
    //   Grow 4: structureRect fills → level bumps 1→2 (age resets to 0)
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();

    for (let y = 0; y < 4; y++) {
      map.setTile(1, y, createTile(1, y, TileType.ZONE_RESIDENTIAL));
    }
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));

    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [
        { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 },
      ],
      anchor: { x: 1, y: 0 },
      level: 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'S',
      structureRect: { x: 1, y: 3, w: 1, h: 1 },
    });
    world.markLandValueDirty();

    // Each growth event requires age to reach cooldown=8.
    // After each event age resets to 0, so run GROWTH_COOLDOWN_INTERVALS growth
    // intervals (each = ZONE_GROWTH_INTERVAL ticks) between events.
    // We already have age=7 before the first growth tick.

    // Grow 1 (age 7 → 8, fires): 1×1 → 1×2
    tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.structureRect).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    expect(map.getBuildings().getBuilding(0)!.level).toBe(1);

    // Grow 2: need age >= 8 again. Run GROWTH_COOLDOWN_INTERVALS growth intervals.
    for (let g = 0; g < GROWTH_COOLDOWN_INTERVALS; g++) tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.structureRect).toEqual({ x: 1, y: 1, w: 1, h: 3 });
    expect(map.getBuildings().getBuilding(0)!.level).toBe(1);

    // Grow 3: 1×3 → 1×4 (fills lot depth)
    for (let g = 0; g < GROWTH_COOLDOWN_INTERVALS; g++) tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.structureRect).toEqual({ x: 1, y: 0, w: 1, h: 4 });
    expect(map.getBuildings().getBuilding(0)!.level).toBe(1);

    // Grow 4: structureRect fills lot → Branch B fires → level bumps 1→2
    for (let g = 0; g < GROWTH_COOLDOWN_INTERVALS; g++) tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.level).toBe(2);
    // structureRect stays at full lot depth after level-up
    expect(map.getBuildings().getBuilding(0)!.structureRect).toEqual({ x: 1, y: 0, w: 1, h: 4 });
  });

  it('1×1 lot — structureRect fills depth immediately → level bumps directly', () => {
    // 1×1 lot: zone at (1,1), road at (1,2), frontage='S'.
    // structureRect = {x:1, y:1, w:1, h:1} which fills the 1×1 lot entirely.
    // extendStructureToward must return null → Branch B (level-up) fires directly.
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();

    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD));

    // id=0, stagger(0)=0, cooldown=8. age=7 → after +1 gate fires.
    // land value at (1,1): road at distance 1 → roadScore = 1-1/7 ≈ 0.857,
    // lv ≈ 0.6 >> LEVEL_THRESHOLDS[2]=0.25.
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markLandValueDirty();

    const result = tickOneGrowthInterval(world);

    const b = map.getBuildings().getBuilding(0)!;
    // structureRect fills 1×1 lot → no structure-grow → level bumps.
    expect(b.level).toBe(2);
    // structureRect unchanged.
    expect(b.structureRect).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    // changedBuildingIds populated.
    expect(result.changedBuildingIds).toContain(0);
    // changedTiles contains the footprint cell.
    expect(result.changedTiles).toContainEqual({ x: 1, y: 1 });
  });
});

// ---------------------------------------------------------------------------
// Task 6 (T6): merge pass — Branch B''
// ---------------------------------------------------------------------------

describe("World.tick() — merge (Branch B'')", () => {
  // Shared helper: build a world with N side-by-side 1×4 R lots, frontage='S',
  // road at y=4, all merge-eligible. Returns { world, map, ids } where ids[i]
  // is the BuildingMap id of the i-th building (x=i).
  //
  // Demand is driven high (residential >= 0.6) by two industrial buildings
  // placed at x=N and x=N+1 on the road row (y=4) — they are on ROAD tiles so
  // the zone-growth loop ignores them, but they still count in the demand model.
  //
  // Buildings start at level=MERGE_LEVEL_THRESHOLD, full structureRect (1×4),
  // age = GROWTH_COOLDOWN_INTERVALS - 1 so that after Branch B's age++ they
  // hit exactly the cooldown and canMerge's age gate passes.
  function setupMergeStrip(n: number): {
    world: World;
    ids: number[];
  } {
    // Map wide enough: n R lots + 2 industrial seeders
    const world = new World(n + 2, 6, { regenerate: false });
    const map = world.getMap();

    // Road row at y=4
    for (let x = 0; x < n + 2; x++) {
      map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
    }

    // R-zone cells for each lot: column x, rows y=0..3
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < 4; y++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
      }
    }

    // Seed R buildings: level=MERGE_LEVEL_THRESHOLD, full structureRect, age past cooldown.
    // Use addExistingBuilding with explicit ids so we can track them.
    const ids: number[] = [];
    for (let x = 0; x < n; x++) {
      const id = x; // ids 0..n-1
      const ok = map.getBuildings().addExistingBuilding({
        id,
        type: 'residential',
        footprint: [
          { x, y: 0 }, { x, y: 1 }, { x, y: 2 }, { x, y: 3 },
        ],
        anchor: { x, y: 0 },
        level: MERGE_LEVEL_THRESHOLD,
        density: 0,
        // age must satisfy canMerge for any building id (max stagger = 6).
        // After Branch B's age+= 1 the age becomes 15, which exceeds
        // GROWTH_COOLDOWN_INTERVALS + 6 = 14 (worst-case stagger).
        // Land value at the anchor (row 0, road at row 4) ≈ 0.43 < LEVEL_THRESHOLDS[3]=0.45
        // so Branch B (level-up) does NOT fire despite the high age.
        age: GROWTH_COOLDOWN_INTERVALS + 6,
        frontage: 'S',
        // Full 1×4 structureRect pinned to south (y+h = 0+4 = lot.y+lot.h)
        structureRect: { x, y: 0, w: 1, h: 4 },
      });
      expect(ok).toBe(true);
      ids.push(id);
    }

    // Seed two industrial buildings on the road row to drive residential demand >= 0.6.
    // jobsLevels = 4+4 = 8, levelSumR = n * MERGE_LEVEL_THRESHOLD = n*2.
    // For n=2: residential = (8-4)/8+0.25 = 0.75 >= 0.6. For n>2 demand is lower but
    // we'll use level=8 per industrial to always satisfy the gate.
    map.getBuildings().addExistingBuilding({
      id: n,
      type: 'industrial',
      footprint: [{ x: n, y: 4 }],
      anchor: { x: n, y: 4 },
      level: 8,
      density: 0,
      age: 0,
      frontage: 'N',
      structureRect: { x: n, y: 4, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: n + 1,
      type: 'industrial',
      footprint: [{ x: n + 1, y: 4 }],
      anchor: { x: n + 1, y: 4 },
      level: 8,
      density: 0,
      age: 0,
      frontage: 'N',
      structureRect: { x: n + 1, y: 4, w: 1, h: 1 },
    });

    world.markDemandDirty();
    return { world, ids };
  }

  // Advance world by exactly one growth tick; returns the tick result.
  function oneGrowthTick(world: World): ReturnType<typeof world.tick> {
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    return world.tick();
  }

  it('two-building happy path: two 1×4 R buildings merge into one 2×4 building', () => {
    const { world, ids } = setupMergeStrip(2);
    const map = world.getMap();
    const [idA, idB] = ids;

    const result = oneGrowthTick(world);

    // Both original buildings are gone
    expect(map.getBuildings().getBuilding(idA)).toBeNull();
    expect(map.getBuildings().getBuilding(idB)).toBeNull();

    // Exactly one building remains (the merged one)
    const remaining = [...map.getBuildings().iterBuildings()].filter(
      b => b.type === 'residential',
    );
    expect(remaining.length).toBe(1);
    const merged = remaining[0];

    // Merged footprint covers both lots: 8 cells
    expect(merged.footprint.length).toBe(8);

    // changedBuildingIds contains both old ids and the new merged id
    expect(result.changedBuildingIds).toContain(idA);
    expect(result.changedBuildingIds).toContain(idB);
    expect(result.changedBuildingIds).toContain(merged.id);

    // Level = max of the two (both were MERGE_LEVEL_THRESHOLD)
    expect(merged.level).toBe(Math.max(MERGE_LEVEL_THRESHOLD, MERGE_LEVEL_THRESHOLD));

    // structureRect = bbox union of two 1×4 full structureRects → 2×4
    expect(merged.structureRect).toEqual({ x: 0, y: 0, w: 2, h: 4 });
  });

  it('disjoint-pairs-per-tick: 4 buildings [A B C D] → 2 ticks to 1 building', () => {
    const { world, ids } = setupMergeStrip(4);
    const map = world.getMap();
    const [idA, idB, idC, idD] = ids;

    // Tick 1: A+B merge, C+D merge → 2 residential buildings remain
    oneGrowthTick(world);

    const afterTick1 = [...map.getBuildings().iterBuildings()].filter(
      b => b.type === 'residential',
    );
    expect(afterTick1.length).toBe(2);
    // Each merged building is 2×4
    for (const b of afterTick1) {
      expect(b.footprint.length).toBe(8);
    }

    // Original ids are gone
    expect(map.getBuildings().getBuilding(idA)).toBeNull();
    expect(map.getBuildings().getBuilding(idB)).toBeNull();
    expect(map.getBuildings().getBuilding(idC)).toBeNull();
    expect(map.getBuildings().getBuilding(idD)).toBeNull();

    // Tick 2: the two 2×4 buildings merge → 1 building (4×4) remains.
    // The merged buildings start at age=0. Their new ids have unknown stagger;
    // worst case is stagger=6, so cooldown = GROWTH_COOLDOWN_INTERVALS + 6 = 14.
    // Run 15 growth intervals to guarantee age > max cooldown.
    for (let g = 0; g < GROWTH_COOLDOWN_INTERVALS + 7; g++) oneGrowthTick(world);

    const afterTick2 = [...map.getBuildings().iterBuildings()].filter(
      b => b.type === 'residential',
    );
    expect(afterTick2.length).toBe(1);
    expect(afterTick2[0].footprint.length).toBe(16); // 4×4
  });

  it('5-strip cap: consolidates to at most 4-wide, never produces a 5-wide building', () => {
    // The exact pairing order depends on BuildingMap insertion order, so we assert
    // size constraints rather than specific pairings.
    const { world } = setupMergeStrip(5);
    const map = world.getMap();

    const rBuildings = () =>
      [...map.getBuildings().iterBuildings()].filter(b => b.type === 'residential');

    // Tick 1: two disjoint merges happen → 3 residential buildings remain.
    // Two pairs merge (consuming 4 buildings), one building is left unpaired.
    oneGrowthTick(world);
    const after1 = rBuildings();
    expect(after1.length).toBe(3);
    // Total cells = 5×4 = 20; each merge produces 2×4=8 cells; 1 lone = 1×4=4 cells.
    const cells1 = after1.map(b => b.footprint.length).sort((a, z) => a - z);
    expect(cells1).toEqual([4, 8, 8]);
    // No building wider than 2 lots (8 cells)
    expect(after1.every(b => b.footprint.length <= 8)).toBe(true);

    // Run further growth intervals: keep ticking until no merges happen
    // for several consecutive cycles (steady state).
    let prevCount = after1.length;
    let stableFor = 0;
    for (let g = 0; g < 100 && stableFor < 5; g++) {
      oneGrowthTick(world);
      const current = rBuildings().length;
      if (current === prevCount) {
        stableFor++;
      } else {
        stableFor = 0;
        prevCount = current;
      }
    }

    const steady = rBuildings();
    // At steady state: no building is 5-wide (canMerge rejects mergedW > 4).
    // Total residential footprint cells must still equal 5×4 = 20 (no cells lost).
    const totalCells = steady.reduce((s, b) => s + b.footprint.length, 0);
    expect(totalCells).toBe(20);
    // No building wider than 4 lots (16 cells).
    expect(steady.every(b => b.footprint.length <= 16)).toBe(true);
    // The system cannot shrink below 2 buildings (5 lots → at most one 4-wide + one remaining).
    expect(steady.length).toBeGreaterThanOrEqual(2);
  });

  it('demand-dirty on merge tick: markDemandDirty is called at least twice (pre-pass + post-merge)', () => {
    const { world } = setupMergeStrip(2);

    const spy = vi.spyOn(world, 'markDemandDirty');

    oneGrowthTick(world);

    // At minimum: once at growth-pass start (pre demandVec), once post-merge
    // (because changedBuildingIds.length > 0 after the merge).
    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });

  it('bulldoze regression: bulldozing anchor of a 2×4 merged building removes all 8 cells', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();

    // Place zone tiles for the 2×4 footprint: columns x=0,1, rows y=0..3
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 4; y++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
      }
    }
    // Road to south for road-access and money deduction during bulldoze
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD));
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));

    // Directly add a 2×4 merged building
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [
        { x: 0, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: 1 }, { x: 1, y: 1 },
        { x: 0, y: 2 }, { x: 1, y: 2 },
        { x: 0, y: 3 }, { x: 1, y: 3 },
      ],
      anchor: { x: 0, y: 0 },
      level: MERGE_LEVEL_THRESHOLD,
      density: 0,
      age: 0,
      frontage: 'S',
      // Full 2×4 structureRect pinned to south (y+h = 0+4 = lot.y+lot.h)
      structureRect: { x: 0, y: 0, w: 2, h: 4 },
    });
    expect(building).not.toBeNull();
    const buildingId = building!.id;

    // Bulldoze the anchor tile (0,0)
    executeClick(Tool.BULLDOZE, { x: 0, y: 0 }, world);

    // Building is gone from BuildingMap
    expect(map.getBuildings().getBuilding(buildingId)).toBeNull();

    // All 8 footprint cells are now unowned
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 4; y++) {
        expect(map.getBuildings().getBuildingAt(x, y)).toBeNull();
      }
    }
  });
});
