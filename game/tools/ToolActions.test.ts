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

describe('buildToolCommands - zone tools', () => {
  const zoneTable: [Tool, TileType, string][] = [
    [Tool.ZONE_RESIDENTIAL, TileType.ZONE_RESIDENTIAL, 'ZONE_RESIDENTIAL'],
    [Tool.ZONE_COMMERCIAL,  TileType.ZONE_COMMERCIAL,  'ZONE_COMMERCIAL'],
    [Tool.ZONE_INDUSTRIAL,  TileType.ZONE_INDUSTRIAL,  'ZONE_INDUSTRIAL'],
  ];

  for (const [tool, zoneType, label] of zoneTable) {
    describe(`Tool.${label}`, () => {
      it('(a) emits one command on a default GRASS tile', () => {
        const commands = buildToolCommands(tool, [{ x: 2, y: 3 }], world);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toEqual({ x: 2, y: 3, tile: createTile(2, 3, zoneType) });
      });

      it('(b) emits one command on a DIRT tile', () => {
        world.getMap().setTile(4, 4, createTile(4, 4, TileType.DIRT));
        const commands = buildToolCommands(tool, [{ x: 4, y: 4 }], world);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toEqual({ x: 4, y: 4, tile: createTile(4, 4, zoneType) });
      });

      it('(c) returns [] on a WATER tile', () => {
        world.getMap().setTile(1, 1, createTile(1, 1, TileType.WATER));
        const commands = buildToolCommands(tool, [{ x: 1, y: 1 }], world);
        expect(commands).toHaveLength(0);
      });

      it('(d) returns [] on a ROAD tile', () => {
        world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
        const commands = buildToolCommands(tool, [{ x: 2, y: 2 }], world);
        expect(commands).toHaveLength(0);
      });

      it('(e) returns [] on an already-zoned tile of the SAME zone type', () => {
        world.getMap().setTile(3, 3, createTile(3, 3, zoneType));
        const commands = buildToolCommands(tool, [{ x: 3, y: 3 }], world);
        expect(commands).toHaveLength(0);
      });

      it('(f) returns [] for out-of-bounds {x:99,y:99}', () => {
        const commands = buildToolCommands(tool, [{ x: 99, y: 99 }], world);
        expect(commands).toHaveLength(0);
      });

      it('(g) mixed batch [WATER, GRASS, ROAD, DIRT]: only GRASS+DIRT yield commands, input order preserved', () => {
        world.getMap().setTile(0, 0, createTile(0, 0, TileType.WATER));
        world.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
        // tile at (2,0) is default GRASS
        world.getMap().setTile(3, 0, createTile(3, 0, TileType.DIRT));
        const commands = buildToolCommands(
          tool,
          [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }],
          world
        );
        expect(commands).toHaveLength(2);
        expect(commands[0]).toEqual({ x: 2, y: 0, tile: createTile(2, 0, zoneType) });
        expect(commands[1]).toEqual({ x: 3, y: 0, tile: createTile(3, 0, zoneType) });
      });
    });
  }

  describe('cross-zone repaint (R/C/I overwrite each other)', () => {
    it('a ZONE_RESIDENTIAL tile is overwritten when Tool.ZONE_COMMERCIAL runs on it', () => {
      world.getMap().setTile(5, 5, createTile(5, 5, TileType.ZONE_RESIDENTIAL));
      const commands = buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 5, y: 5 }], world);
      expect(commands).toEqual([
        { x: 5, y: 5, tile: createTile(5, 5, TileType.ZONE_COMMERCIAL) },
      ]);
    });

    it('a ZONE_INDUSTRIAL tile is overwritten when Tool.ZONE_RESIDENTIAL runs on it', () => {
      world.getMap().setTile(6, 6, createTile(6, 6, TileType.ZONE_INDUSTRIAL));
      const commands = buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 6, y: 6 }], world);
      expect(commands).toEqual([
        { x: 6, y: 6, tile: createTile(6, 6, TileType.ZONE_RESIDENTIAL) },
      ]);
    });
  });
});

describe('buildToolCommands - Tool.ROAD', () => {
  const zoneSkipTable: [TileType, string][] = [
    [TileType.ZONE_RESIDENTIAL, 'ZONE_RESIDENTIAL'],
    [TileType.ZONE_COMMERCIAL,  'ZONE_COMMERCIAL'],
    [TileType.ZONE_INDUSTRIAL,  'ZONE_INDUSTRIAL'],
  ];

  for (const [zoneType, label] of zoneSkipTable) {
    it(`skips a ${label} tile and places road on adjacent GRASS`, () => {
      world.getMap().setTile(1, 0, createTile(1, 0, zoneType));
      // tile at (2,0) is default GRASS
      const commands = buildToolCommands(
        Tool.ROAD,
        [{ x: 1, y: 0 }, { x: 2, y: 0 }],
        world
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ x: 2, y: 0, tile: createTile(2, 0, TileType.ROAD) });
    });
  }
});

describe('buildToolCommands - Tool.BULLDOZE', () => {
  it('emits DIRT command on a ROAD tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const commands = buildToolCommands(Tool.BULLDOZE, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ x: 2, y: 2, tile: createTile(2, 2, TileType.DIRT) });
  });

  const zoneTypes: [TileType, string][] = [
    [TileType.ZONE_RESIDENTIAL, 'ZONE_RESIDENTIAL'],
    [TileType.ZONE_COMMERCIAL,  'ZONE_COMMERCIAL'],
    [TileType.ZONE_INDUSTRIAL,  'ZONE_INDUSTRIAL'],
  ];

  for (const [zoneType, label] of zoneTypes) {
    it(`emits DIRT command on a ${label} tile`, () => {
      world.getMap().setTile(3, 3, createTile(3, 3, zoneType));
      const commands = buildToolCommands(Tool.BULLDOZE, [{ x: 3, y: 3 }], world);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ x: 3, y: 3, tile: createTile(3, 3, TileType.DIRT) });
    });
  }

  it('returns [] on a GRASS tile', () => {
    // default tile is GRASS
    const commands = buildToolCommands(Tool.BULLDOZE, [{ x: 1, y: 1 }], world);
    expect(commands).toHaveLength(0);
  });

  it('returns [] on a WATER tile', () => {
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.WATER));
    const commands = buildToolCommands(Tool.BULLDOZE, [{ x: 1, y: 1 }], world);
    expect(commands).toHaveLength(0);
  });

  it('returns [] on a DIRT tile', () => {
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.DIRT));
    const commands = buildToolCommands(Tool.BULLDOZE, [{ x: 1, y: 1 }], world);
    expect(commands).toHaveLength(0);
  });

  it('mixed batch: only ROAD and zone tiles emit commands, others skipped', () => {
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    // (2,0) is default GRASS — should be skipped
    world.getMap().setTile(3, 0, createTile(3, 0, TileType.WATER));
    const commands = buildToolCommands(
      Tool.BULLDOZE,
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
      world
    );
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({ x: 0, y: 0, tile: createTile(0, 0, TileType.DIRT) });
    expect(commands[1]).toEqual({ x: 1, y: 0, tile: createTile(1, 0, TileType.DIRT) });
  });
});

describe('buildToolCommands - no-op tools still return []', () => {
  it('Tool.SELECT returns empty', () => {
    const commands = buildToolCommands(Tool.SELECT, [{ x: 0, y: 0 }], world);
    expect(commands).toHaveLength(0);
  });
});
