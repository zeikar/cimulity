import { describe, it, expect, beforeEach } from 'vitest';
import { buildToolCommands } from './ToolActions';
import { Tool } from './Tool';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { SEA_LEVEL, MIN_LAND_ELEVATION } from '../core/Terrain';
import type { Building } from '../core/Building';

const MAP_SIZE = 10;

let world: World;

beforeEach(() => {
  world = new World(MAP_SIZE, MAP_SIZE, { regenerate: false });
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
        expect(commands[0]).toEqual({ kind: 'tile', x: 2, y: 3, tile: createTile(2, 3, zoneType) });
      });

      it('(b) emits one command on a DIRT tile', () => {
        world.getMap().setTile(4, 4, createTile(4, 4, TileType.DIRT));
        const commands = buildToolCommands(tool, [{ x: 4, y: 4 }], world);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toEqual({ kind: 'tile', x: 4, y: 4, tile: createTile(4, 4, zoneType) });
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
        expect(commands[0]).toEqual({ kind: 'tile', x: 2, y: 0, tile: createTile(2, 0, zoneType) });
        expect(commands[1]).toEqual({ kind: 'tile', x: 3, y: 0, tile: createTile(3, 0, zoneType) });
      });
    });
  }

  describe('cross-zone repaint (R/C/I overwrite each other)', () => {
    it('a ZONE_RESIDENTIAL tile is overwritten when Tool.ZONE_COMMERCIAL runs on it', () => {
      world.getMap().setTile(5, 5, createTile(5, 5, TileType.ZONE_RESIDENTIAL));
      const commands = buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 5, y: 5 }], world);
      expect(commands).toEqual([
        { kind: 'tile', x: 5, y: 5, tile: createTile(5, 5, TileType.ZONE_COMMERCIAL) },
      ]);
    });

    it('a ZONE_INDUSTRIAL tile is overwritten when Tool.ZONE_RESIDENTIAL runs on it', () => {
      world.getMap().setTile(6, 6, createTile(6, 6, TileType.ZONE_INDUSTRIAL));
      const commands = buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 6, y: 6 }], world);
      expect(commands).toEqual([
        { kind: 'tile', x: 6, y: 6, tile: createTile(6, 6, TileType.ZONE_RESIDENTIAL) },
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
      expect(commands[0]).toEqual({ kind: 'tile', x: 2, y: 0, tile: createTile(2, 0, TileType.ROAD) });
    });
  }
});

describe('buildToolCommands - Tool.BULLDOZE', () => {
  it('emits DIRT command on a ROAD tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const commands = buildToolCommands(Tool.BULLDOZE, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.DIRT) });
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
      expect(commands[0]).toEqual({ kind: 'tile', x: 3, y: 3, tile: createTile(3, 3, TileType.DIRT) });
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
    expect(commands[0]).toEqual({ kind: 'tile', x: 0, y: 0, tile: createTile(0, 0, TileType.DIRT) });
    expect(commands[1]).toEqual({ kind: 'tile', x: 1, y: 0, tile: createTile(1, 0, TileType.DIRT) });
  });
});

describe('buildToolCommands - PAINT_WATER emitted-command shapes', () => {
  it('GRASS above sea level: emits one elevation command to SEA_LEVEL', () => {
    // Default world has all tiles GRASS at MIN_LAND_ELEVATION (elev 1) — above sea level
    const commands = buildToolCommands(Tool.PAINT_WATER, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: SEA_LEVEL });
  });

  it('rejected — ROAD tile: zero commands', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const commands = buildToolCommands(Tool.PAINT_WATER, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  it('rejected — DIRT tile: zero commands', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    const commands = buildToolCommands(Tool.PAINT_WATER, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  it('rejected — zone tiles (R/C/I): zero commands each', () => {
    const zoneTypes: TileType[] = [
      TileType.ZONE_RESIDENTIAL,
      TileType.ZONE_COMMERCIAL,
      TileType.ZONE_INDUSTRIAL,
    ];
    for (const zoneType of zoneTypes) {
      world.getMap().setTile(3, 3, createTile(3, 3, zoneType));
      const commands = buildToolCommands(Tool.PAINT_WATER, [{ x: 3, y: 3 }], world);
      expect(commands).toHaveLength(0);
    }
  });

  it('rejected — building footprint over GRASS: zero commands', () => {
    // The underlying tile stays GRASS, but a building occupies the cell
    const building: Building = {
      id: 0,
      type: 'residential',
      footprint: [{ x: 4, y: 4 }],
      anchor: { x: 4, y: 4 },
      level: 0,
      density: 0,
      age: 0,
    };
    world.getMap().getBuildings().addExistingBuilding(building);
    // Confirm tile is still GRASS
    expect(world.getMap().getTile(4, 4)?.type).toBe(TileType.GRASS);
    const commands = buildToolCommands(Tool.PAINT_WATER, [{ x: 4, y: 4 }], world);
    expect(commands).toHaveLength(0);
  });

  it('no-op — already water (GRASS at SEA_LEVEL): zero commands', () => {
    // Lower elevation to SEA_LEVEL so world.isWater returns true
    world.getTerrain().unsafeSetElevation(1, 1, SEA_LEVEL);
    // Tile type stays GRASS (water is now derived from elevation)
    const commands = buildToolCommands(Tool.PAINT_WATER, [{ x: 1, y: 1 }], world);
    expect(commands).toHaveLength(0);
  });

  it('out-of-bounds {x:99,y:99}: zero commands', () => {
    const commands = buildToolCommands(Tool.PAINT_WATER, [{ x: 99, y: 99 }], world);
    expect(commands).toHaveLength(0);
  });
});

describe('buildToolCommands - PAINT_GRASS emitted-command shapes', () => {
  it('DIRT above sea level: emits one tile command to GRASS, no elevation command', () => {
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.DIRT));
    world.getTerrain().unsafeSetElevation(2, 3, 5);
    const commands = buildToolCommands(Tool.PAINT_GRASS, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0].kind).toBe('tile');
    if (commands[0].kind === 'tile') {
      expect(commands[0].x).toBe(2);
      expect(commands[0].y).toBe(3);
      expect(commands[0].tile.type).toBe(TileType.GRASS);
    }
  });

  it('GRASS at SEA_LEVEL (water): emits one elevation command to MIN_LAND_ELEVATION', () => {
    world.getTerrain().unsafeSetElevation(2, 3, SEA_LEVEL);
    // Tile type is already GRASS by default
    const commands = buildToolCommands(Tool.PAINT_GRASS, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: MIN_LAND_ELEVATION });
  });

  it('GRASS above sea level: zero commands (no-op)', () => {
    // Default world: all tiles GRASS at MIN_LAND_ELEVATION (1) — above sea level
    const commands = buildToolCommands(Tool.PAINT_GRASS, [{ x: 1, y: 1 }], world);
    expect(commands).toHaveLength(0);
  });

  it('ROAD tile: zero commands', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const commands = buildToolCommands(Tool.PAINT_GRASS, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  it('zone tiles (R/C/I): zero commands each', () => {
    const zoneTypes: TileType[] = [
      TileType.ZONE_RESIDENTIAL,
      TileType.ZONE_COMMERCIAL,
      TileType.ZONE_INDUSTRIAL,
    ];
    for (const zoneType of zoneTypes) {
      world.getMap().setTile(3, 3, createTile(3, 3, zoneType));
      const commands = buildToolCommands(Tool.PAINT_GRASS, [{ x: 3, y: 3 }], world);
      expect(commands).toHaveLength(0);
    }
  });

  it('out-of-bounds {x:99,y:99}: zero commands', () => {
    const commands = buildToolCommands(Tool.PAINT_GRASS, [{ x: 99, y: 99 }], world);
    expect(commands).toHaveLength(0);
  });
});

describe('buildToolCommands - no-op tools still return []', () => {
  it('Tool.SELECT returns empty', () => {
    const commands = buildToolCommands(Tool.SELECT, [{ x: 0, y: 0 }], world);
    expect(commands).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Terrain buildability gates (Task 7)
// ---------------------------------------------------------------------------

describe('buildToolCommands — terrain buildability gates', () => {
  describe('raised single tile (cliff): 2×2 map with (1,1) at elevation 2 above baseline', () => {
    it('road at raised (1,1) is REJECTED; road at flat (0,0) is ACCEPTED', () => {
      // (1,1) raised to 2: its flat neighbors are at MIN_LAND_ELEVATION=1 → slope mask non-zero → canBuildRoadAt = false
      world.getTerrain().unsafeSetElevation(1, 1, 2);
      const commands = buildToolCommands(
        Tool.ROAD,
        [{ x: 1, y: 1 }, { x: 0, y: 0 }],
        world
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'tile', x: 0, y: 0, tile: createTile(0, 0, TileType.ROAD) });
    });

    it('zone at raised (1,1) is REJECTED; zone at flat (0,0) is ACCEPTED', () => {
      world.getTerrain().unsafeSetElevation(1, 1, 2);
      const commands = buildToolCommands(
        Tool.ZONE_RESIDENTIAL,
        [{ x: 1, y: 1 }, { x: 0, y: 0 }],
        world
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'tile', x: 0, y: 0, tile: createTile(0, 0, TileType.ZONE_RESIDENTIAL) });
    });
  });

  describe('3×3 plateau: interior tile flat, edge tile on slope rejected', () => {
    beforeEach(() => {
      // Raise a 3×3 block at (2,2)-(4,4) to elevation 2 above the MIN_LAND_ELEVATION=1 baseline.
      // Interior tile (3,3): all 4 orthogonal neighbors inside plateau → same elevation → flat.
      // Edge tile (2,2): neighbor (1,2) at MIN_LAND_ELEVATION=1 < 2 → slope mask non-zero → not flat.
      for (let py = 2; py < 5; py++) {
        for (let px = 2; px < 5; px++) {
          world.getTerrain().unsafeSetElevation(px, py, 2);
        }
      }
    });

    it('road tool ACCEPTS interior plateau tile (3,3)', () => {
      const commands = buildToolCommands(Tool.ROAD, [{ x: 3, y: 3 }], world);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'tile', x: 3, y: 3, tile: createTile(3, 3, TileType.ROAD) });
    });

    it('road tool REJECTS edge plateau tile (2,2) which has a lower neighbor at (1,2)', () => {
      const commands = buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world);
      expect(commands).toHaveLength(0);
    });

    it('road tool ACCEPTS flat surrounding tile (0,0)', () => {
      const commands = buildToolCommands(Tool.ROAD, [{ x: 0, y: 0 }], world);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'tile', x: 0, y: 0, tile: createTile(0, 0, TileType.ROAD) });
    });
  });

  describe('elevation-derived water rejects road and zone', () => {
    beforeEach(() => {
      // Water is now elevation-derived: drop (5,5) to SEA_LEVEL so world.isWater returns true.
      world.getTerrain().unsafeSetElevation(5, 5, SEA_LEVEL);
    });

    it('road at water elevation (5,5) is REJECTED', () => {
      const commands = buildToolCommands(Tool.ROAD, [{ x: 5, y: 5 }], world);
      expect(commands).toHaveLength(0);
    });

    it('zone at water elevation (5,5) is REJECTED', () => {
      const commands = buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 5, y: 5 }], world);
      expect(commands).toHaveLength(0);
    });
  });
});
