import { describe, it, expect } from 'vitest';
import { World } from './World';
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
