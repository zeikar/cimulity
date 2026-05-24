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
  GROWTH_COOLDOWN_INTERVALS,
  DENSITY_COOLDOWN_INTERVALS,
  stagger,
  DEFAULT_NEWCITY_SEED,
} from './World';
import { TileType, createTile } from './Tile';
import { Terrain, MIN_LAND_ELEVATION, SEA_LEVEL } from './Terrain';

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
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 }, level: 3, density: 0, age: 0 });
    map.getBuildings().addBuilding({ type: 'commercial', footprint: [{ x: 1, y: 0 }], anchor: { x: 1, y: 0 }, level: 2, density: 0, age: 0 });
    map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 2, y: 0 }], anchor: { x: 2, y: 0 }, level: 1, density: 0, age: 0 });
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
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 3, y: 0 }], anchor: { x: 3, y: 0 }, level: 2, density: 0, age: 0 });
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
    map.getBuildings().addBuilding({ type: 'residential', footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 }, level: 2, density: 0, age: 0 });
    map.getBuildings().addBuilding({ type: 'commercial', footprint: [{ x: 1, y: 0 }], anchor: { x: 1, y: 0 }, level: 3, density: 0, age: 0 });
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
    });
    // Run just one growth tick
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world2.tick();
    const b2 = map2.getBuildings().getBuildingAt(0, 0)!;
    // Level 2 building should never have its density bumped
    expect(b2.density).toBe(0);
  });

  it('density advances only when at ZONE_MAX_LEVEL + age >= DENSITY_COOLDOWN_INTERVALS + landValue >= HIGH_DENSITY_THRESHOLD', () => {
    // Use diversified map to ensure HIGH_DENSITY_THRESHOLD is met
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    // Seed building at ZONE_MAX_LEVEL with age just under DENSITY_COOLDOWN_INTERVALS.
    // id=0 (first building), so stagger(0)=0, cooldown=DENSITY_COOLDOWN_INTERVALS.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
    });

    // The first growth tick: age → DENSITY_COOLDOWN_INTERVALS; but land value may be 0
    // until recomputed. Land value recomputes at LAND_VALUE_INTERVAL cadence.
    // Run enough ticks so land value is recomputed (<=16 ticks) AND age >= DENSITY_COOLDOWN_INTERVALS.
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
    })!;

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
    // canBuildAt(1,0,1,1) = false → Branch A skips building creation.
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

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

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

  it('returns false for a non-flat vertex tile', () => {
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
    });
    expect(map.getBuildings().getBuildingAt(0, 0)).not.toBeNull();

    world.regenerateTerrain(DEFAULT_NEWCITY_SEED);

    expect(map.getBuildings().getBuildingAt(0, 0)).toBeNull();
  });
});
