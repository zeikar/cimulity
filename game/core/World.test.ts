import { describe, it, expect } from 'vitest';
import {
  World,
  ZONE_GROWTH_INTERVAL,
  ZONE_MAX_LEVEL,
  POPULATION_PER_LEVEL,
  STARTING_FUNDS,
  TAX_PER_POP,
} from './World';
import { TileType, createTile } from './Tile';

describe('World', () => {
  it('builds a map of the requested size', () => {
    const world = new World(8, 6);
    const map = world.getMap();

    expect(map.getWidth()).toBe(8);
    expect(map.getHeight()).toBe(6);
  });

  it('returns the same map instance across calls', () => {
    const world = new World(4, 4);
    expect(world.getMap()).toBe(world.getMap());
  });

  it('starts at tick 0 and advances one tick at a time', () => {
    const world = new World(4, 4);

    expect(world.getTick()).toBe(0);
    world.tick();
    world.tick();
    expect(world.getTick()).toBe(2);
  });

  it('reset() clears the map and the tick counter', () => {
    const world = new World(4, 4);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    world.tick();

    world.reset();

    expect(world.getTick()).toBe(0);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });
});

describe('World.tick() — heal rule', () => {
  it('converts a DIRT tile to GRASS and returns { changed: 1 }', () => {
    const world = new World(4, 4);
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.DIRT));

    const result = world.tick();

    expect(result).toEqual({ changed: 1 });
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
  });

  it('returns { changed: 0 } and leaves map untouched when no DIRT present', () => {
    const world = new World(4, 4);

    const result = world.tick();

    expect(result).toEqual({ changed: 0 });
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('does not alter ROAD or WATER tiles during a tick', () => {
    const world = new World(4, 4);
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.WATER));

    const result = world.tick();

    expect(result.changed).toBe(0);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.WATER);
  });
});

describe('World.tick() — permanence guard', () => {
  it('leaves zone tiles unchanged and only heals the DIRT control tile', () => {
    const world = new World(4, 4);
    const map = world.getMap();

    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 0, createTile(3, 0, TileType.DIRT));

    const result = world.tick();

    expect(result).toEqual({ changed: 1 });
    expect(map.getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(map.getTile(1, 0)?.type).toBe(TileType.ZONE_COMMERCIAL);
    expect(map.getTile(2, 0)?.type).toBe(TileType.ZONE_INDUSTRIAL);
    expect(map.getTile(3, 0)?.type).toBe(TileType.GRASS);
  });
});

describe('World.countDirt()', () => {
  it('returns the number of DIRT tiles before a tick', () => {
    const world = new World(4, 4);
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.DIRT));

    expect(world.countDirt()).toBe(2);
  });

  it('returns 0 after a tick heals all DIRT', () => {
    const world = new World(4, 4);
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));

    world.tick();

    expect(world.countDirt()).toBe(0);
  });
});

describe('World.tick() — zone growth', () => {
  it('ROAD-adjacent zone does NOT grow before the Nth tick (ZONE_GROWTH_INTERVAL - 1 ticks)', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();

    expect(map.getTile(1, 0)?.level).toBe(0);
  });

  it('ROAD-adjacent zone grows 0→1 exactly on tick N; returned changed includes the level-up', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    const result = world.tick(); // tick N

    expect(map.getTile(1, 0)?.level).toBe(1);
    expect(result.changed).toBeGreaterThanOrEqual(1);
  });

  it('zone with no orthogonal ROAD neighbor stays level 0 across multiple growth intervals', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    // No road anywhere near

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();

    expect(map.getTile(1, 1)?.level).toBe(0);
  });

  it('diagonal-only ROAD adjacency does NOT cause growth (orthogonal only)', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    // Zone at (1,1), ROAD only at (2,2) — diagonal, not orthogonal
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(2, 2, createTile(2, 2, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 2; i++) world.tick();

    expect(map.getTile(1, 1)?.level).toBe(0);
  });

  it('zone level caps at ZONE_MAX_LEVEL and stops contributing to changed at cap', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Run enough intervals to exceed the cap
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * (ZONE_MAX_LEVEL + 2); i++) world.tick();

    expect(map.getTile(0, 0)?.level).toBe(ZONE_MAX_LEVEL);
  });

  it('at cap, zone no longer contributes to changed', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, ZONE_MAX_LEVEL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Run exactly one growth tick
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) {
      const result = world.tick();
      if (i === ZONE_GROWTH_INTERVAL - 1) {
        // On the growth tick, this zone is already capped — should not appear in changed
        expect(result.changed).toBe(0);
      }
    }
    expect(map.getTile(0, 0)?.level).toBe(ZONE_MAX_LEVEL);
  });
});

describe('World money — initial state', () => {
  it('new World starts with STARTING_FUNDS', () => {
    const world = new World(4, 4);
    expect(world.getMoney()).toBe(STARTING_FUNDS);
  });
});

describe('World.trySpend()', () => {
  it('returns true and decrements money when amount is within balance', () => {
    const world = new World(4, 4);
    const result = world.trySpend(100);
    expect(result).toBe(true);
    expect(world.getMoney()).toBe(STARTING_FUNDS - 100);
  });

  it('returns false and leaves money unchanged when amount exceeds balance', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    const result = world.trySpend(STARTING_FUNDS + 1);
    expect(result).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns true and leaves 0 when spending exactly the full balance', () => {
    const world = new World(4, 4);
    const result = world.trySpend(STARTING_FUNDS);
    expect(result).toBe(true);
    expect(world.getMoney()).toBe(0);
  });

  it('returns false and leaves money unchanged for negative amount', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    expect(world.trySpend(-1)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for Infinity', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    expect(world.trySpend(Infinity)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for NaN', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    expect(world.trySpend(NaN)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for fractional amount', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    expect(world.trySpend(12.5)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });
});

describe('World.earn()', () => {
  it('increases money by a valid whole amount', () => {
    const world = new World(4, 4);
    world.earn(50);
    expect(world.getMoney()).toBe(STARTING_FUNDS + 50);
  });

  it('earn(0) is a no-op that leaves money unchanged', () => {
    const world = new World(4, 4);
    world.earn(0);
    expect(world.getMoney()).toBe(STARTING_FUNDS);
  });

  it('earn(-1) is a no-op', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    world.earn(-1);
    expect(world.getMoney()).toBe(before);
  });

  it('earn(NaN) is a no-op', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    world.earn(NaN);
    expect(world.getMoney()).toBe(before);
  });

  it('earn(12.5) is a no-op', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    world.earn(12.5);
    expect(world.getMoney()).toBe(before);
  });
});

describe('World.setMoney()', () => {
  it('returns true and sets money to 500', () => {
    const world = new World(4, 4);
    expect(world.setMoney(500)).toBe(true);
    expect(world.getMoney()).toBe(500);
  });

  it('returns false and leaves money unchanged for -1', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    expect(world.setMoney(-1)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for Infinity', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    expect(world.setMoney(Infinity)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for NaN', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    expect(world.setMoney(NaN)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('returns false and leaves money unchanged for 12.5', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    expect(world.setMoney(12.5)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });
});

describe('World.tick() — tax accrual', () => {
  it('money is unchanged when population is 0', () => {
    const world = new World(4, 4);
    const before = world.getMoney();
    world.tick();
    expect(world.getMoney()).toBe(before);
  });

  it('money increases by Math.floor(population * TAX_PER_POP) on a growth tick with road-adjacent zones', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Advance to the growth tick so the zone reaches level 1
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();

    const moneyBeforeGrowthTick = world.getMoney();
    world.tick(); // this is the growth tick: zone grows to level 1, then tax is collected
    const popAfterGrowth = world.getPopulation(); // level 1 * POPULATION_PER_LEVEL
    const expectedTax = Math.floor(popAfterGrowth * TAX_PER_POP);
    expect(world.getMoney()).toBe(moneyBeforeGrowthTick + expectedTax);
  });
});

describe('World.reset() — treasury', () => {
  it('restores money to STARTING_FUNDS after spending', () => {
    const world = new World(4, 4);
    world.trySpend(5000);
    world.reset();
    expect(world.getMoney()).toBe(STARTING_FUNDS);
  });
});

describe('World.getPopulation()', () => {
  it('returns 0 for a default map with no zone tiles', () => {
    const world = new World(4, 4);
    expect(world.getPopulation()).toBe(0);
  });

  it('returns 0 when zone tiles are all at level 0', () => {
    const world = new World(4, 4);
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 0));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL, 0));
    expect(world.getPopulation()).toBe(0);
  });

  it('sums levels across all zone tiles and multiplies by POPULATION_PER_LEVEL', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 3));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL, 2));
    map.setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL, 1));
    // sum = 3+2+1 = 6; population = 6 * POPULATION_PER_LEVEL
    expect(world.getPopulation()).toBe(6 * POPULATION_PER_LEVEL);
  });

  it('non-zone tiles (ROAD, GRASS, etc.) contribute 0 to population', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ROAD));
    map.setTile(1, 0, createTile(1, 0, TileType.WATER));
    map.setTile(2, 0, createTile(2, 0, TileType.DIRT));
    map.setTile(3, 0, createTile(3, 0, TileType.ZONE_RESIDENTIAL, 2));
    expect(world.getPopulation()).toBe(2 * POPULATION_PER_LEVEL);
  });

  it('reset() zeroes tick and population returns 0 after reset', () => {
    const world = new World(4, 4);
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 3));
    world.tick();

    world.reset();

    expect(world.getTick()).toBe(0);
    expect(world.getPopulation()).toBe(0);
  });
});
