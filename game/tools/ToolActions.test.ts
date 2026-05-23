import { describe, it, expect, beforeEach } from 'vitest';
import { buildToolCommands } from './ToolActions';
import { Tool } from './Tool';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { SEA_LEVEL, MAX_ELEVATION } from '../core/Terrain';
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

      it('(c) returns [] on a water-elevation tile', () => {
        // Water is elevation-derived: drop (1, 1) to SEA_LEVEL so world.isWater is true.
        world.getTerrain().unsafeSetElevation(1, 1, SEA_LEVEL);
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

      it('(g) mixed batch [water-elev GRASS, GRASS, ROAD, DIRT]: only land GRASS+DIRT yield commands, input order preserved', () => {
        // (0, 0) is a water-elevation cell (GRASS at SEA_LEVEL).
        world.getTerrain().unsafeSetElevation(0, 0, SEA_LEVEL);
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

  it('returns [] on a water-elevation tile', () => {
    // Water is elevation-derived: tile stays GRASS at SEA_LEVEL.
    world.getTerrain().unsafeSetElevation(1, 1, SEA_LEVEL);
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
    // (3,0) is GRASS at water elevation — should be skipped
    world.getTerrain().unsafeSetElevation(3, 0, SEA_LEVEL);
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

describe('buildToolCommands - no-op tools still return []', () => {
  it('Tool.SELECT returns empty', () => {
    const commands = buildToolCommands(Tool.SELECT, [{ x: 0, y: 0 }], world);
    expect(commands).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TERRAIN_UP
// ---------------------------------------------------------------------------

describe('buildToolCommands - TERRAIN_UP', () => {
  // (a) GRASS at MIN_LAND_ELEVATION: emits one elevation command to current+1
  it('(a) GRASS at MIN_LAND_ELEVATION: emits elevation command to 2', () => {
    // Default world: all GRASS at MIN_LAND_ELEVATION (1); neighbors also at 1 → slope OK
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: 2 });
  });

  // (b) GRASS at MAX_ELEVATION: next would exceed MAX_ELEVATION — clamped, zero commands
  it('(b) GRASS at MAX_ELEVATION: zero commands (clamped at top)', () => {
    // Seed (2,3) and its 3×3 neighborhood to MAX_ELEVATION so canSetElevation passes,
    // but next=MAX_ELEVATION+1 > MAX_ELEVATION → early exit before the slope check
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.getTerrain().unsafeSetElevation(2 + dx, 3 + dy, MAX_ELEVATION);
      }
    }
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(0);
  });

  // (c) GRASS at MAX_ELEVATION-1, slope-safe: one elevation command to MAX_ELEVATION
  it('(c) GRASS at MAX_ELEVATION-1 with slope-safe neighborhood: one elevation command to MAX_ELEVATION', () => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.getTerrain().unsafeSetElevation(2 + dx, 3 + dy, MAX_ELEVATION - 1);
      }
    }
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: MAX_ELEVATION });
  });

  // (d) Slope-blocked raise: neighbor at 4, target at 1, raising to 2 → delta vs neighbor is 2 → blocked
  it('(d) slope-blocked raise: neighbor at 4 blocks 1→2, zero commands', () => {
    // World uniform at 1; raise (1,2) to 4 bypassing slope check
    world.getTerrain().unsafeSetElevation(1, 2, 4);
    // Click at (2,2): would raise 1→2; canSetElevation(2,2,2): neighbor (1,2) at 4, |4-2|=2 → blocked
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  // (e) ROAD reject: structured cell → zero commands
  it('(e) ROAD tile: zero commands', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  // (f) Zone reject: R/C/I all return zero commands
  it('(f) zone tiles (R/C/I): zero commands each', () => {
    const zoneTypes: TileType[] = [
      TileType.ZONE_RESIDENTIAL,
      TileType.ZONE_COMMERCIAL,
      TileType.ZONE_INDUSTRIAL,
    ];
    for (const zoneType of zoneTypes) {
      world.getMap().setTile(3, 3, createTile(3, 3, zoneType));
      const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 3, y: 3 }], world);
      expect(commands).toHaveLength(0);
    }
  });

  // (g) Building footprint reject: tile stays GRASS but footprint blocks
  it('(g) building footprint over GRASS: zero commands', () => {
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
    expect(world.getMap().getTile(4, 4)?.type).toBe(TileType.GRASS);
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 4, y: 4 }], world);
    expect(commands).toHaveLength(0);
  });

  // (h) DIRT, slope-safe raise: emits one elevation command, no tile write
  it('(h) DIRT tile, slope-safe: emits elevation command only (no tile write)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    // Default elevation is 1 (MIN_LAND_ELEVATION); neighborhood at 1 → slope OK
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 2, elevation: 2 });
  });

  // (i) OOB: zero commands
  it('(i) out-of-bounds {x:99,y:99}: zero commands', () => {
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 99, y: 99 }], world);
    expect(commands).toHaveLength(0);
  });

  // (j) Mixed batch [OOB, GRASS, ROAD, GRASS]: exactly two elevation commands in input order
  it('(j) mixed batch [OOB, GRASS, ROAD, GRASS]: exactly two elevation commands in input order', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    // (2,2) and (4,4) are default GRASS at elevation 1
    const commands = buildToolCommands(
      Tool.TERRAIN_UP,
      [{ x: 99, y: 99 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }],
      world
    );
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 2, elevation: 2 });
    expect(commands[1]).toEqual({ kind: 'elevation', x: 4, y: 4, elevation: 2 });
  });
});

// ---------------------------------------------------------------------------
// TERRAIN_DOWN
// ---------------------------------------------------------------------------

describe('buildToolCommands - TERRAIN_DOWN', () => {
  // (a) GRASS at MIN_LAND_ELEVATION+1: one elevation command to 1
  it('(a) GRASS at MIN_LAND_ELEVATION+1: one elevation command to MIN_LAND_ELEVATION', () => {
    // Seed all cells to 2 so slope is uniform and canSetElevation(x,y,1) passes
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        world.getTerrain().unsafeSetElevation(x, y, 2);
      }
    }
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: 1 });
  });

  // (b) GRASS at SEA_LEVEL: next would be <SEA_LEVEL — clamped, zero commands
  it('(b) GRASS at SEA_LEVEL: zero commands (clamped)', () => {
    world.getTerrain().unsafeSetElevation(2, 3, SEA_LEVEL);
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(0);
  });

  // (c) GRASS at MIN_LAND_ELEVATION → SEA_LEVEL (slope-safe): one elevation command to SEA_LEVEL
  it('(c) GRASS at MIN_LAND_ELEVATION: one elevation command to SEA_LEVEL', () => {
    // Default world: all GRASS at 1; neighbors at 1 → canSetElevation(2,3,0): |1-0|=1 → OK
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: SEA_LEVEL });
  });

  // (d) Slope-blocked DOWN: all cells at 5, neighbor (1,2) at 8; lower (2,2) from 5→4 vs neighbor 8: delta=4 → blocked
  it('(d) slope-blocked lower: neighbor at 8 blocks 5→4, zero commands', () => {
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        world.getTerrain().unsafeSetElevation(x, y, 5);
      }
    }
    world.getTerrain().unsafeSetElevation(1, 2, 8);
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  // (e) DIRT above SEA_LEVEL: one elevation command to current-1, no tile write
  it('(e) DIRT at elevation 5, slope-safe: one elevation command to 4 (no tile write)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    // Seed (2,2) and 3×3 neighborhood to 5 so slope is uniform
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.getTerrain().unsafeSetElevation(2 + dx, 2 + dy, 5);
      }
    }
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 2, elevation: 4 });
  });

  // (f) DIRT → SEA_LEVEL coherence (Blocker fix): tile first, elevation second
  it('(f) DIRT at MIN_LAND_ELEVATION (1) → SEA_LEVEL: emits tile (GRASS) then elevation command, in that order', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    // Default world all at 1; canSetElevation(2,2,0): |1-0|=1 → OK
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(2);
    // Command 0: tile write DIRT→GRASS
    expect(commands[0].kind).toBe('tile');
    if (commands[0].kind === 'tile') {
      expect(commands[0].x).toBe(2);
      expect(commands[0].y).toBe(2);
      expect(commands[0].tile.type).toBe(TileType.GRASS);
    }
    // Command 1: elevation to SEA_LEVEL
    expect(commands[1]).toEqual({ kind: 'elevation', x: 2, y: 2, elevation: SEA_LEVEL });
  });

  // (g) DIRT → SEA_LEVEL slope-blocked: neighbor at 3 prevents lowering 1→0
  it('(g) DIRT at elevation 1, slope-blocked by neighbor at 3: zero commands', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    // Raise neighbor (1,2) to 3; lowering (2,2) from 1→0: |3-0|=3 > 1 → blocked
    world.getTerrain().unsafeSetElevation(1, 2, 3);
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  // (h) ROAD/zone/building reject DOWN: zero commands each
  it('(h) ROAD tile: zero commands', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(0);
  });

  it('(h) zone tiles (R/C/I): zero commands each', () => {
    const zoneTypes: TileType[] = [
      TileType.ZONE_RESIDENTIAL,
      TileType.ZONE_COMMERCIAL,
      TileType.ZONE_INDUSTRIAL,
    ];
    for (const zoneType of zoneTypes) {
      world.getMap().setTile(3, 3, createTile(3, 3, zoneType));
      const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 3, y: 3 }], world);
      expect(commands).toHaveLength(0);
    }
  });

  it('(h) building footprint over GRASS: zero commands', () => {
    const building: Building = {
      id: 1,
      type: 'residential',
      footprint: [{ x: 4, y: 4 }],
      anchor: { x: 4, y: 4 },
      level: 0,
      density: 0,
      age: 0,
    };
    world.getMap().getBuildings().addExistingBuilding(building);
    expect(world.getMap().getTile(4, 4)?.type).toBe(TileType.GRASS);
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 4, y: 4 }], world);
    expect(commands).toHaveLength(0);
  });

  // (i) OOB: zero commands
  it('(i) out-of-bounds {x:99,y:99}: zero commands', () => {
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 99, y: 99 }], world);
    expect(commands).toHaveLength(0);
  });

  // (j) Mixed batch: [GRASS at (0,0), DIRT at (0,1)] on default world (all at MIN_LAND_ELEVATION=1)
  // Expects THREE commands: elevation(0,0), tile(0,1,GRASS), elevation(0,1) — DIRT pair contiguous at [1] and [2]
  it('(j) mixed batch [GRASS(0,0), DIRT(0,1)] at MIN_LAND_ELEVATION: three commands in order, DIRT pair contiguous', () => {
    world.getMap().setTile(0, 1, createTile(0, 1, TileType.DIRT));
    // Default world: all elevation 1; all neighbors in-bounds at 1 or OOB-skipped
    // (0,0) GRASS: 1→0=SEA_LEVEL, not DIRT → one elevation command
    // (0,1) DIRT: 1→0=SEA_LEVEL → paired tile+elevation
    const commands = buildToolCommands(
      Tool.TERRAIN_DOWN,
      [{ x: 0, y: 0 }, { x: 0, y: 1 }],
      world
    );
    expect(commands).toHaveLength(3);
    // Command 0: elevation for (0,0) GRASS
    expect(commands[0]).toEqual({ kind: 'elevation', x: 0, y: 0, elevation: SEA_LEVEL });
    // Commands 1 and 2: contiguous DIRT pair for (0,1)
    expect(commands[1].kind).toBe('tile');
    if (commands[1].kind === 'tile') {
      expect(commands[1].x).toBe(0);
      expect(commands[1].y).toBe(1);
      expect(commands[1].tile.type).toBe(TileType.GRASS);
    }
    expect(commands[2]).toEqual({ kind: 'elevation', x: 0, y: 1, elevation: SEA_LEVEL });
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

// ---------------------------------------------------------------------------
// Structured-neighbor flatness protection (Finding: terrain edits must not
// silently invalidate adjacent road/zone/building flatness invariant)
// ---------------------------------------------------------------------------

describe('buildToolCommands — structured-neighbor flatness guard', () => {
  describe('TERRAIN_UP and structured neighbors', () => {
    // Raising a cell makes it HIGHER than the structured neighbor, not lower.
    // getSlopeMask only marks neighbors that are LOWER than center, so a structured
    // cell's mask stays 0 when its neighbor is raised — flatness invariant is not broken.
    it('raise next to a ROAD tile at same elevation is ACCEPTED (raising does not lower the road neighbor)', () => {
      // Default world: all elevation 1. Road at (3,3). Raising (2,3) to 2: road's west
      // neighbor becomes 2 > road_nc=1 → not lower → slope mask unchanged → still flat.
      world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
      const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 3 }], world);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: 2 });
    });

    it('raise next to an empty zone is ACCEPTED (raising does not break flatness of the zone)', () => {
      world.getMap().setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
      const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 3 }], world);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: 2 });
    });

    it('raise next to a building footprint is ACCEPTED (raising does not break flatness)', () => {
      const building: Building = {
        id: 2,
        type: 'residential',
        footprint: [{ x: 3, y: 3 }],
        anchor: { x: 3, y: 3 },
        level: 0,
        density: 0,
        age: 0,
      };
      world.getMap().getBuildings().addExistingBuilding(building);
      const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 3 }], world);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'elevation', x: 2, y: 3, elevation: 2 });
    });
  });

  describe('TERRAIN_DOWN rejects edits that break a structured neighbor', () => {
    it('lower next to a ROAD tile is rejected', () => {
      // Seed whole map to elevation 2 so lowering 2→1 is slope-legal, then place road at (3,3).
      // Lowering (2,3) from 2→1: road at (3,3) has nc=2, its west cardinal would be 1 → delta=1 from nc=2 → actually that's fine...
      // Need delta > 0 to matter: lower (2,3) to 1, road stays at 2 → road's west is 1, nc=2 → mask bit set → non-flat → reject.
      for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
          world.getTerrain().unsafeSetElevation(x, y, 2);
        }
      }
      world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
      const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world);
      expect(commands).toHaveLength(0);
    });

    it('lower next to an empty zone is rejected', () => {
      for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
          world.getTerrain().unsafeSetElevation(x, y, 2);
        }
      }
      world.getMap().setTile(3, 3, createTile(3, 3, TileType.ZONE_COMMERCIAL));
      const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world);
      expect(commands).toHaveLength(0);
    });

    it('lower next to a building footprint cell is rejected', () => {
      for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
          world.getTerrain().unsafeSetElevation(x, y, 2);
        }
      }
      const building: Building = {
        id: 3,
        type: 'residential',
        footprint: [{ x: 3, y: 3 }],
        anchor: { x: 3, y: 3 },
        level: 0,
        density: 0,
        age: 0,
      };
      world.getMap().getBuildings().addExistingBuilding(building);
      const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world);
      expect(commands).toHaveLength(0);
    });

    it('lower far from any structured cell is accepted', () => {
      // All at elevation 2, road at (0,0), lower (5,5) — no structured neighbors
      for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
          world.getTerrain().unsafeSetElevation(x, y, 2);
        }
      }
      world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
      const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 5, y: 5 }], world);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'elevation', x: 5, y: 5, elevation: 1 });
    });
  });
});
