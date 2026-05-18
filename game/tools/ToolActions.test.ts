import { describe, it, expect, beforeEach } from 'vitest';
import { buildToolCommands } from './ToolActions';
import { Tool } from './Tool';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';

const MAP_SIZE = 10;

let world: World;

beforeEach(() => {
  world = new World(MAP_SIZE, MAP_SIZE);
});

describe('buildToolCommands - Tool.BUILDING', () => {
  it('(a) returns one BUILDING command for a GRASS tile', () => {
    const commands = buildToolCommands(Tool.BUILDING, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ x: 2, y: 3, tile: createTile(2, 3, TileType.BUILDING) });
  });

  it('(b) returns one BUILDING command for a DIRT tile', () => {
    world.getMap().setTile(4, 4, createTile(4, 4, TileType.DIRT));
    const commands = buildToolCommands(Tool.BUILDING, [{ x: 4, y: 4 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ x: 4, y: 4, tile: createTile(4, 4, TileType.BUILDING) });
  });

  it('(c) returns empty for a WATER tile (allowlist rejects)', () => {
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.WATER));
    const commands = buildToolCommands(Tool.BUILDING, [{ x: 1, y: 1 }], world);
    expect(commands).toHaveLength(0);
  });

  it('(d) returns empty for a ROAD tile (allowlist rejects)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const commands = buildToolCommands(Tool.BUILDING, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  it('(e) returns empty for an existing BUILDING tile (no re-place)', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.BUILDING));
    const commands = buildToolCommands(Tool.BUILDING, [{ x: 3, y: 3 }], world);
    expect(commands).toHaveLength(0);
  });

  it('(f) returns empty for an out-of-bounds coord', () => {
    const commands = buildToolCommands(Tool.BUILDING, [{ x: 99, y: 99 }], world);
    expect(commands).toHaveLength(0);
  });

  it('(g) only eligible tiles yield commands, input order preserved', () => {
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.WATER));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // tile at (2,0) is default GRASS
    world.getMap().setTile(3, 0, createTile(3, 0, TileType.DIRT));
    const commands = buildToolCommands(
      Tool.BUILDING,
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }],
      world
    );
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({ x: 2, y: 0, tile: createTile(2, 0, TileType.BUILDING) });
    expect(commands[1]).toEqual({ x: 3, y: 0, tile: createTile(3, 0, TileType.BUILDING) });
  });
});

describe('buildToolCommands - Tool.ROAD', () => {
  it('skips a BUILDING tile and leaves GRASS neighbour intact', () => {
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.BUILDING));
    // tile at (2,0) is default GRASS
    const commands = buildToolCommands(
      Tool.ROAD,
      [{ x: 1, y: 0 }, { x: 2, y: 0 }],
      world
    );
    // BUILDING coord must produce no command; GRASS coord must produce a road command
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ x: 2, y: 0, tile: createTile(2, 0, TileType.ROAD) });
  });
});

describe('buildToolCommands - no-op tools still return []', () => {
  it('Tool.SELECT returns empty', () => {
    const commands = buildToolCommands(Tool.SELECT, [{ x: 0, y: 0 }], world);
    expect(commands).toHaveLength(0);
  });

  it('Tool.ZONE_RESIDENTIAL returns empty', () => {
    const commands = buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 0, y: 0 }], world);
    expect(commands).toHaveLength(0);
  });
});
