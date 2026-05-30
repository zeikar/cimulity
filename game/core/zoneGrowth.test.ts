import { describe, it, expect } from 'vitest';
import { World } from './World';
import { TileType, createTile } from './Tile';
import {
  depthAxisFromFrontage,
  pickSeedFrontage,
  greedyDepthLot,
  classifyEmptyZoneSpawnBlock,
  initialStructureRect,
  extendStructureToward,
  structureRectFillsLotDepth,
  canExtendStructure,
} from './zoneGrowth';
import { isStructureRectInLot } from './buildingFootprint';

/** Set all 4 corner vertices of tile (x,y) to height h. */
function setTileFlat(world: World, x: number, y: number, h: number): void {
  const terrain = world.getTerrain();
  terrain.unsafeSetVertexHeight(x, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y + 1, h);
  terrain.unsafeSetVertexHeight(x, y + 1, h);
}

/** Seed a zone tile (resid by default) with flat terrain at h=1. */
function seedZone(world: World, x: number, y: number, type = TileType.ZONE_RESIDENTIAL): void {
  world.getMap().setTile(x, y, createTile(x, y, type));
  setTileFlat(world, x, y, 1);
}

describe('depthAxisFromFrontage', () => {
  it("N → { dx: 0, dy: 1 }", () => {
    expect(depthAxisFromFrontage('N')).toEqual({ dx: 0, dy: 1 });
  });
  it("S → { dx: 0, dy: -1 }", () => {
    expect(depthAxisFromFrontage('S')).toEqual({ dx: 0, dy: -1 });
  });
  it("W → { dx: 1, dy: 0 }", () => {
    expect(depthAxisFromFrontage('W')).toEqual({ dx: 1, dy: 0 });
  });
  it("E → { dx: -1, dy: 0 }", () => {
    expect(depthAxisFromFrontage('E')).toEqual({ dx: -1, dy: 0 });
  });
});

describe('pickSeedFrontage', () => {
  it('road directly south of seed → returns S', () => {
    const world = new World(5, 5, { regenerate: false });
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ROAD));
    expect(pickSeedFrontage({ x: 2, y: 2 }, world)).toBe('S');
  });

  it('road at distance 2 south, no road at distance 1 → returns S', () => {
    const world = new World(6, 6, { regenerate: false });
    world.getMap().setTile(2, 4, createTile(2, 4, TileType.ROAD)); // distance 2 south
    expect(pickSeedFrontage({ x: 2, y: 2 }, world)).toBe('S');
  });

  it('road south AND east at same distance → S wins (tie-break S > E)', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(2, 3, createTile(2, 3, TileType.ROAD)); // distance 1 south
    map.setTile(3, 2, createTile(3, 2, TileType.ROAD)); // distance 1 east
    expect(pickSeedFrontage({ x: 2, y: 2 }, world)).toBe('S');
  });

  it('no road within distance 4 → returns null', () => {
    const world = new World(10, 10, { regenerate: false });
    // Road at distance 5 south — outside the 4-cell radius
    world.getMap().setTile(2, 7, createTile(2, 7, TileType.ROAD));
    expect(pickSeedFrontage({ x: 2, y: 2 }, world)).toBeNull();
  });

  it('out-of-bounds neighbor treated as non-road — does not crash', () => {
    // Seed at (0,0): north neighbor is out of bounds
    const world = new World(5, 5, { regenerate: false });
    expect(pickSeedFrontage({ x: 0, y: 0 }, world)).toBeNull();
  });
});

describe('greedyDepthLot', () => {
  // Helper: build an N×N R-zone block with a 1-cell road row on the specified side.
  // Returns seed coordinates at the zone cell adjacent to the road.
  function setup4x4Zone(world: World, roadSide: 'N' | 'S' | 'W' | 'E'): { x: number; y: number } {
    const map = world.getMap();
    const terrain = world.getTerrain();
    // Zone block occupies columns 0-3, rows 0-3
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
      }
    }
    // Flat terrain for entire 4×4 zone (set all vertices to h=1)
    for (let vy = 0; vy <= 4; vy++) {
      for (let vx = 0; vx <= 4; vx++) {
        terrain.unsafeSetVertexHeight(vx, vy, 1);
      }
    }
    // Place road row and return the seed cell adjacent to it
    switch (roadSide) {
      case 'S':
        for (let x = 0; x < 4; x++) map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
        return { x: 0, y: 3 }; // southernmost zone row, col 0
      case 'N':
        // Road above row 0 → at y=-1 which is out of bounds; use a 10×10 world with zone offset
        // For N: road is at y = -1 from the zone; we need the zone to start at y>0.
        // We re-layout: zone rows 1-4, road at y=0.
        map.reset();
        for (let y = 1; y <= 4; y++) {
          for (let x = 0; x < 4; x++) {
            map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
          }
        }
        for (let vy = 1; vy <= 5; vy++) {
          for (let vx = 0; vx <= 4; vx++) {
            terrain.unsafeSetVertexHeight(vx, vy, 1);
          }
        }
        for (let x = 0; x < 4; x++) map.setTile(x, 0, createTile(x, 0, TileType.ROAD));
        return { x: 0, y: 1 }; // northernmost zone row adjacent to road, col 0
      case 'W':
        for (let y = 0; y < 4; y++) map.setTile(4, y, createTile(4, y, TileType.ROAD));
        return { x: 3, y: 0 }; // easternmost zone col adjacent to road (W frontage walks toward x=0)
      case 'E':
        // Road to the east of the block: place zone at cols 1-4, road at col 0
        map.reset();
        for (let y = 0; y < 4; y++) {
          for (let x = 1; x <= 4; x++) {
            map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
          }
        }
        for (let vy = 0; vy <= 4; vy++) {
          for (let vx = 1; vx <= 5; vx++) {
            terrain.unsafeSetVertexHeight(vx, vy, 1);
          }
        }
        for (let y = 0; y < 4; y++) map.setTile(0, y, createTile(0, y, TileType.ROAD));
        return { x: 1, y: 0 }; // westernmost zone col adjacent to road (E frontage walks toward x=4)
    }
  }

  it('4×4 R-zone with road south → seed at southernmost row produces 1×4 lot, frontage S', () => {
    const world = new World(6, 6, { regenerate: false });
    const seed = setup4x4Zone(world, 'S');
    const lot = greedyDepthLot(seed, 'S', TileType.ZONE_RESIDENTIAL, world);
    expect(lot).not.toBeNull();
    // Depth axis for S is (0,-1): walks from y=3 down to y=0 → bbox y=0..3, h=4
    expect(lot).toEqual({ x: 0, y: 0, w: 1, h: 4 });
  });

  it('4×4 R-zone with road north → seed at northernmost row produces 1×4 lot, frontage N', () => {
    const world = new World(10, 6, { regenerate: false });
    const seed = setup4x4Zone(world, 'N');
    const lot = greedyDepthLot(seed, 'N', TileType.ZONE_RESIDENTIAL, world);
    expect(lot).not.toBeNull();
    // Depth axis for N is (0,+1): walks from y=1 down to y=4 → bbox y=1..4, h=4
    expect(lot).toEqual({ x: 0, y: 1, w: 1, h: 4 });
  });

  it('4×4 R-zone with road on west side → seed at westernmost col produces 1×4 lot, frontage W', () => {
    // frontage W = road to the WEST. depth axis = (+1,0) walks eastward into the lot.
    // Zone at cols 1-4, road at col 0.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    const terrain = world.getTerrain();
    for (let y = 0; y < 4; y++) {
      for (let x = 1; x <= 4; x++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
      }
    }
    for (let vy = 0; vy <= 4; vy++) {
      for (let vx = 1; vx <= 5; vx++) {
        terrain.unsafeSetVertexHeight(vx, vy, 1);
      }
    }
    for (let y = 0; y < 4; y++) map.setTile(0, y, createTile(0, y, TileType.ROAD));
    // Seed at x=1 (westernmost zone col adjacent to road at x=0), row 0.
    const seed = { x: 1, y: 0 };
    const lot = greedyDepthLot(seed, 'W', TileType.ZONE_RESIDENTIAL, world);
    expect(lot).not.toBeNull();
    // Depth axis (+1,0): walks from x=1 to x=4 → bbox x=1..4, w=4
    expect(lot).toEqual({ x: 1, y: 0, w: 4, h: 1 });
  });

  it('4×4 R-zone with road on east side → seed at easternmost col produces 1×4 lot, frontage E', () => {
    // frontage E = road to the EAST. depth axis = (-1,0) walks westward into the lot.
    // Zone at cols 0-3, road at col 4.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    const terrain = world.getTerrain();
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
      }
    }
    for (let vy = 0; vy <= 4; vy++) {
      for (let vx = 0; vx <= 4; vx++) {
        terrain.unsafeSetVertexHeight(vx, vy, 1);
      }
    }
    for (let y = 0; y < 4; y++) map.setTile(4, y, createTile(4, y, TileType.ROAD));
    // Seed at x=3 (easternmost zone col adjacent to road at x=4), row 0.
    const seed = { x: 3, y: 0 };
    const lot = greedyDepthLot(seed, 'E', TileType.ZONE_RESIDENTIAL, world);
    expect(lot).not.toBeNull();
    // Depth axis (-1,0): walks from x=3 to x=0 → bbox x=0..3, w=4
    expect(lot).toEqual({ x: 0, y: 0, w: 4, h: 1 });
  });

  it('greedy stops at non-matching zone tile', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    // R-zone at (0,0), C-zone at (0,1), road at (0,4)
    seedZone(world, 0, 0, TileType.ZONE_RESIDENTIAL);
    seedZone(world, 0, 1, TileType.ZONE_COMMERCIAL);
    // Road adjacent to south of (0,0) ... but C-zone blocks the path
    // Actually greedy walks S (toward decreasing y) from seed, so we need road below
    // Let's instead set up: R-zone at y=3, C-zone at y=2, road at y=4
    seedZone(world, 0, 3, TileType.ZONE_RESIDENTIAL);
    seedZone(world, 0, 2, TileType.ZONE_COMMERCIAL);
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD));
    // Seed at (0,3), frontage S (road at y=4). Greedy walks south from (0,3): next cell (0,2) is C-zone → stop.
    const lot = greedyDepthLot({ x: 0, y: 3 }, 'S', TileType.ZONE_RESIDENTIAL, world);
    expect(lot).not.toBeNull();
    expect(lot).toEqual({ x: 0, y: 3, w: 1, h: 1 });
  });

  it('greedy stops at already-owned cell', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    // Two R-zone cells stacked, seed at bottom (y=3), road at y=4
    seedZone(world, 0, 3, TileType.ZONE_RESIDENTIAL);
    seedZone(world, 0, 2, TileType.ZONE_RESIDENTIAL);
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD));
    // Place a building occupying (0,2)
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 2 }],
      anchor: { x: 0, y: 2 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 2, w: 1, h: 1 },
    });
    const lot = greedyDepthLot({ x: 0, y: 3 }, 'S', TileType.ZONE_RESIDENTIAL, world);
    expect(lot).not.toBeNull();
    expect(lot).toEqual({ x: 0, y: 3, w: 1, h: 1 });
  });

  it('greedy stops at non-flat terrain', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    const terrain = world.getTerrain();
    // Seed at (0,3): flat at h=1.
    seedZone(world, 0, 3, TileType.ZONE_RESIDENTIAL); // sets all 4 corners of tile (0,3) to h=1
    // Tile (0,2): zone tile but with sloped terrain — make it non-flat by setting
    // the top-row vertices (0,2) and (1,2) (which are NOT shared with tile (0,3)) to h=2,
    // while keeping shared vertices (0,3) and (1,3) at h=1.
    map.setTile(0, 2, createTile(0, 2, TileType.ZONE_RESIDENTIAL));
    terrain.unsafeSetVertexHeight(0, 2, 2); // top-left of tile (0,2) — unique to this tile
    terrain.unsafeSetVertexHeight(1, 2, 2); // top-right of tile (0,2) — unique to this tile
    // Shared bottom vertices (0,3) and (1,3) remain at h=1 from seedZone call.
    // → tile (0,2): corners [h=2, h=2, h=1, h=1] → non-flat; renderHeight = max = 2 ≠ 1
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD));
    // Greedy from (0,3) S: next cell (0,2) has renderHeight=2 ≠ anchorHeight=1 → stops.
    const lot = greedyDepthLot({ x: 0, y: 3 }, 'S', TileType.ZONE_RESIDENTIAL, world);
    expect(lot).not.toBeNull();
    expect(lot).toEqual({ x: 0, y: 3, w: 1, h: 1 });
  });

  it('CRITICAL: chosen-frontage validation — rejects when chosen face has no road', () => {
    // 1×3 R-zone strip (x=0, y=0..2) with road on EAST side (x=1, y=0..2),
    // but NO road on the SOUTH side (y=3). Call with frontage='S'.
    // validateFootprintRect would pass (E-side road satisfies road-access predicate),
    // but countRoadsOnFace(rect, 'S', world) === 0 → return null.
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    const terrain = world.getTerrain();
    for (let y = 0; y < 3; y++) {
      map.setTile(0, y, createTile(0, y, TileType.ZONE_RESIDENTIAL));
    }
    for (let vy = 0; vy <= 3; vy++) {
      terrain.unsafeSetVertexHeight(0, vy, 1);
      terrain.unsafeSetVertexHeight(1, vy, 1);
    }
    // Road on east side (x=1)
    for (let y = 0; y < 3; y++) {
      map.setTile(1, y, createTile(1, y, TileType.ROAD));
    }
    // No road at south (y=3) — so frontage 'S' face has no road
    const lot = greedyDepthLot({ x: 0, y: 2 }, 'S', TileType.ZONE_RESIDENTIAL, world);
    expect(lot).toBeNull();
  });
});

describe('classifyEmptyZoneSpawnBlock', () => {
  /** Seed a vertical 1×N R-zone strip at column x, rows y0..y0+n-1, all flat at h=1. */
  function seedStrip(world: World, x: number, y0: number, n: number): void {
    for (let y = y0; y < y0 + n; y++) seedZone(world, x, y, TileType.ZONE_RESIDENTIAL);
  }

  const NONE_POWERED = () => false;
  const ALL_POWERED = () => true;
  /** isPowered predicate that reports only cell (sx,sy) as powered. */
  const onlyPowered = (sx: number, sy: number) => (x: number, y: number) => x === sx && y === sy;

  it('road-adjacent seed, frontage powered → null (will spawn)', () => {
    const world = new World(8, 8, { regenerate: false });
    seedZone(world, 2, 2, TileType.ZONE_RESIDENTIAL);
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ROAD)); // adjacent south
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 2 }, world, onlyPowered(2, 2))).toBeNull();
  });

  it('road-adjacent seed, unpowered → power (bolt)', () => {
    const world = new World(8, 8, { regenerate: false });
    seedZone(world, 2, 2, TileType.ZONE_RESIDENTIAL);
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ROAD)); // adjacent south
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 2 }, world, NONE_POWERED)).toBe('power');
  });

  it('no road within reach → road (even if power is everywhere — road > power)', () => {
    const world = new World(8, 8, { regenerate: false });
    seedZone(world, 2, 2, TileType.ZONE_RESIDENTIAL);
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 2 }, world, ALL_POWERED)).toBe('road');
  });

  it('deep interior cell with a powered frontage seed → null (no false bolt, no false road)', () => {
    // Strip (2,0)..(2,3), road at (2,4). The frontage seed (2,3) is the only powered cell (power
    // reaches road-adjacent cells only). It spawns a 1×4 lot covering the whole strip, so the
    // deepest interior cell (2,0) needs no power/road of its own. A per-tile power or face test
    // would paint a false bolt / road glyph here; coverage must report null.
    const world = new World(8, 8, { regenerate: false });
    seedStrip(world, 2, 0, 4);
    world.getMap().setTile(2, 4, createTile(2, 4, TileType.ROAD));
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 0 }, world, onlyPowered(2, 3))).toBeNull(); // depth 3
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 2 }, world, onlyPowered(2, 3))).toBeNull(); // depth 1
  });

  it('deep interior cell, frontage seed unpowered → power (whole strip awaits power)', () => {
    const world = new World(8, 8, { regenerate: false });
    seedStrip(world, 2, 0, 4);
    world.getMap().setTile(2, 4, createTile(2, 4, TileType.ROAD));
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 0 }, world, NONE_POWERED)).toBe('power');
  });

  it('road across UNZONED land → road (contiguity required, unlike pickSeedFrontage)', () => {
    // Road 4 tiles south of a lone zone tile, nothing zoned between. pickSeedFrontage returns 'S'
    // (a road is within the 4-cell radius), but no contiguous same-type lot reaches it, so the tile
    // is genuinely road-blocked. Gating on pickSeedFrontage alone would wrongly suppress the cue.
    const world = new World(8, 8, { regenerate: false });
    seedZone(world, 2, 2, TileType.ZONE_RESIDENTIAL);
    world.getMap().setTile(2, 6, createTile(2, 6, TileType.ROAD)); // distance 4, unzoned gap
    expect(pickSeedFrontage({ x: 2, y: 2 }, world)).toBe('S'); // nearby-road test passes...
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 2 }, world, ALL_POWERED)).toBe('road'); // ...coverage does not
  });

  it('cell beyond the lot depth cap → road', () => {
    // 1×5 strip (2,0)..(2,4), road at (2,5). The frontage seed (2,4) covers only depth 0..3
    // (cells 2,4..2,1); the 5th cell (2,0) is one past LOT_MAX_DEPTH, so no lot reaches it.
    const world = new World(8, 8, { regenerate: false });
    seedStrip(world, 2, 0, 5);
    world.getMap().setTile(2, 5, createTile(2, 5, TileType.ROAD));
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 1 }, world, onlyPowered(2, 4))).toBeNull(); // depth 3 — covered
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 0 }, world, ALL_POWERED)).toBe('road');     // depth 4 — beyond cap
  });

  it('walled off from the road by an already-spawned building → road (mirrors spawn occupancy)', () => {
    // Strip (2,0)..(2,3) with road at (2,4), but a building already occupies the road-front cell
    // (2,3) (it spawned with a 1×1 lot, then the player zoned behind it). greedyDepthLot stops at
    // the occupied cell, so no lot can reach the empty back cell (2,2) — it IS road-blocked.
    // Skipping occupancy would walk through the building to the road and wrongly hide the cue.
    const world = new World(8, 8, { regenerate: false });
    seedStrip(world, 2, 0, 4);
    world.getMap().setTile(2, 4, createTile(2, 4, TileType.ROAD));
    world.getMap().getBuildings().addBuilding({
      type: 'residential', footprint: [{ x: 2, y: 3 }], anchor: { x: 2, y: 3 },
      level: 1, density: 0, age: 0, frontage: 'S', structureRect: { x: 2, y: 3, w: 1, h: 1 },
    });
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 2 }, world, ALL_POWERED)).toBe('road');
  });

  it('decoupled from terrain: road-adjacent slope tile is NOT road-blocked', () => {
    // A zone on a coplanar ramp (allowed by the zone tool) with a road directly south. The strict-
    // flat spawn check rejects it (greedyDepthLot/validateFootprintRect → null), but the BLOCKER is
    // terrain, not road. The classifier must NOT report 'road' (a road can't fix it): with the
    // frontage seed powered it reports null (left unbadged), and unpowered it reports 'power'.
    const world = new World(8, 8, { regenerate: false });
    seedZone(world, 2, 2, TileType.ZONE_RESIDENTIAL); // flats tile (2,2) at h=1
    world.getTerrain().unsafeSetVertexHeight(2, 2, 2); // tilt one corner → tile (2,2) non-flat
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ROAD)); // adjacent south
    expect(greedyDepthLot({ x: 2, y: 2 }, 'S', TileType.ZONE_RESIDENTIAL, world)).toBeNull(); // terrain-blocked
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 2 }, world, onlyPowered(2, 2))).toBeNull(); // not 'road'
    expect(classifyEmptyZoneSpawnBlock({ x: 2, y: 2 }, world, NONE_POWERED)).toBe('power');   // not 'road'
  });
});

describe('initialStructureRect', () => {
  it('frontage N on 1×4 lot → structureRect = {x:0, y:0, w:1, h:1}', () => {
    const lot = { x: 0, y: 0, w: 1, h: 4 };
    const sr = initialStructureRect(lot, 'N');
    expect(sr).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(isStructureRectInLot(sr, lot, 'N')).toBe(true);
  });

  it('frontage S on 1×4 lot → structureRect = {x:0, y:3, w:1, h:1}', () => {
    const lot = { x: 0, y: 0, w: 1, h: 4 };
    const sr = initialStructureRect(lot, 'S');
    expect(sr).toEqual({ x: 0, y: 3, w: 1, h: 1 });
    expect(isStructureRectInLot(sr, lot, 'S')).toBe(true);
  });

  it('frontage W on 4×1 lot → structureRect = {x:0, y:0, w:1, h:1}', () => {
    const lot = { x: 0, y: 0, w: 4, h: 1 };
    const sr = initialStructureRect(lot, 'W');
    expect(sr).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(isStructureRectInLot(sr, lot, 'W')).toBe(true);
  });

  it('frontage E on 4×1 lot → structureRect = {x:3, y:0, w:1, h:1}', () => {
    const lot = { x: 0, y: 0, w: 4, h: 1 };
    const sr = initialStructureRect(lot, 'E');
    expect(sr).toEqual({ x: 3, y: 0, w: 1, h: 1 });
    expect(isStructureRectInLot(sr, lot, 'E')).toBe(true);
  });
});

describe('extendStructureToward', () => {
  it('frontage N: 1×1 sr in 1×4 lot → extends to 1×2', () => {
    const lot = { x: 0, y: 0, w: 1, h: 4 };
    const sr = { x: 0, y: 0, w: 1, h: 1 };
    const result = extendStructureToward(sr, lot, 'N');
    expect(result).toEqual({ x: 0, y: 0, w: 1, h: 2 });
    expect(isStructureRectInLot(result!, lot, 'N')).toBe(true);
  });

  it('frontage S: 1×1 sr at bottom of 1×4 lot → extends to 1×2 (grows upward)', () => {
    const lot = { x: 0, y: 0, w: 1, h: 4 };
    const sr = { x: 0, y: 3, w: 1, h: 1 };
    const result = extendStructureToward(sr, lot, 'S');
    expect(result).toEqual({ x: 0, y: 2, w: 1, h: 2 });
    expect(isStructureRectInLot(result!, lot, 'S')).toBe(true);
  });

  it('frontage W: 1×1 sr at left of 4×1 lot → extends to 2×1', () => {
    const lot = { x: 0, y: 0, w: 4, h: 1 };
    const sr = { x: 0, y: 0, w: 1, h: 1 };
    const result = extendStructureToward(sr, lot, 'W');
    expect(result).toEqual({ x: 0, y: 0, w: 2, h: 1 });
    expect(isStructureRectInLot(result!, lot, 'W')).toBe(true);
  });

  it('frontage E: 1×1 sr at right of 4×1 lot → extends to 2×1 (grows leftward)', () => {
    const lot = { x: 0, y: 0, w: 4, h: 1 };
    const sr = { x: 3, y: 0, w: 1, h: 1 };
    const result = extendStructureToward(sr, lot, 'E');
    expect(result).toEqual({ x: 2, y: 0, w: 2, h: 1 });
    expect(isStructureRectInLot(result!, lot, 'E')).toBe(true);
  });

  it('returns null when sr already fills lot depth (N/S)', () => {
    const lot = { x: 0, y: 0, w: 1, h: 4 };
    const sr = { x: 0, y: 0, w: 1, h: 4 }; // already full depth
    expect(extendStructureToward(sr, lot, 'N')).toBeNull();
    expect(extendStructureToward(sr, lot, 'S')).toBeNull();
  });

  it('returns null when sr already fills lot depth (W/E)', () => {
    const lot = { x: 0, y: 0, w: 4, h: 1 };
    const sr = { x: 0, y: 0, w: 4, h: 1 }; // already full depth
    expect(extendStructureToward(sr, lot, 'W')).toBeNull();
    expect(extendStructureToward(sr, lot, 'E')).toBeNull();
  });

  it('cap = max(MIN_STRUCTURE_DEPTH_CAP, lot width): 1×4 lot stops growing at depth 2', () => {
    // 1-wide lot: cap = max(2, 1) = 2. Structure 1×2 cannot extend further.
    const lot = { x: 0, y: 0, w: 1, h: 4 };
    const sr = { x: 0, y: 0, w: 1, h: 2 };
    expect(extendStructureToward(sr, lot, 'N')).toBeNull();
  });

  it('cap = max(MIN_STRUCTURE_DEPTH_CAP, lot width): 4×4 lot grows depth all the way to 4', () => {
    // 4-wide lot: cap = max(2, 4) = 4. Structure 4×3 still has room to grow.
    const lot = { x: 0, y: 0, w: 4, h: 4 };
    const sr = { x: 0, y: 0, w: 4, h: 3 };
    expect(extendStructureToward(sr, lot, 'N')).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });

  it('cap = max(MIN_STRUCTURE_DEPTH_CAP, lot width): 3×4 lot stops growing at depth 3', () => {
    // 3-wide lot: cap = max(2, 3) = 3. Structure 3×3 cannot extend further even though lot has depth 4.
    const lot = { x: 0, y: 0, w: 3, h: 4 };
    const sr = { x: 0, y: 0, w: 3, h: 3 };
    expect(extendStructureToward(sr, lot, 'N')).toBeNull();
  });
});

describe('canExtendStructure', () => {
  it('false when structure depth equals lot width-based cap', () => {
    // 1×4 lot (width=1, cap=2). 1×2 structure → at cap.
    expect(canExtendStructure({ x: 0, y: 0, w: 1, h: 2 }, { x: 0, y: 0, w: 1, h: 4 }, 'N')).toBe(false);
  });

  it('true when structure depth below lot width-based cap and lot has room', () => {
    // 4×4 lot (width=4, cap=4). 4×2 structure → cap allows growth.
    expect(canExtendStructure({ x: 0, y: 0, w: 4, h: 2 }, { x: 0, y: 0, w: 4, h: 4 }, 'N')).toBe(true);
  });

  it('false when structure already fills lot depth even if below cap', () => {
    // 4×4 lot, 4×4 structure → lot full overrides cap.
    expect(canExtendStructure({ x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 0, w: 4, h: 4 }, 'N')).toBe(false);
  });

  it('width-axis flipped for W/E frontage: cap derives from lot.h', () => {
    // 4×3 lot, frontage='W' (depth axis = x). Width axis = y, so width = lot.h = 3, cap = max(2, 3) = 3.
    // Structure 3×3 → at cap (sr.w = 3 = cap, lot.w=4 still has room but cap caps it).
    const lot = { x: 0, y: 0, w: 4, h: 3 };
    const sr = { x: 0, y: 0, w: 3, h: 3 };
    expect(canExtendStructure(sr, lot, 'W')).toBe(false);
  });
});

describe('structureRectFillsLotDepth', () => {
  it('N: true when sr.h === lot.h', () => {
    expect(structureRectFillsLotDepth({ x: 0, y: 0, w: 1, h: 4 }, { x: 0, y: 0, w: 1, h: 4 }, 'N')).toBe(true);
  });
  it('N: false when sr.h < lot.h', () => {
    expect(structureRectFillsLotDepth({ x: 0, y: 0, w: 1, h: 2 }, { x: 0, y: 0, w: 1, h: 4 }, 'N')).toBe(false);
  });
  it('S: true when sr.h === lot.h', () => {
    expect(structureRectFillsLotDepth({ x: 0, y: 0, w: 1, h: 4 }, { x: 0, y: 0, w: 1, h: 4 }, 'S')).toBe(true);
  });
  it('S: false when sr.h < lot.h', () => {
    expect(structureRectFillsLotDepth({ x: 0, y: 3, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 4 }, 'S')).toBe(false);
  });
  it('W: true when sr.w === lot.w', () => {
    expect(structureRectFillsLotDepth({ x: 0, y: 0, w: 4, h: 1 }, { x: 0, y: 0, w: 4, h: 1 }, 'W')).toBe(true);
  });
  it('W: false when sr.w < lot.w', () => {
    expect(structureRectFillsLotDepth({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 4, h: 1 }, 'W')).toBe(false);
  });
  it('E: true when sr.w === lot.w', () => {
    expect(structureRectFillsLotDepth({ x: 0, y: 0, w: 4, h: 1 }, { x: 0, y: 0, w: 4, h: 1 }, 'E')).toBe(true);
  });
  it('E: false when sr.w < lot.w', () => {
    expect(structureRectFillsLotDepth({ x: 3, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 4, h: 1 }, 'E')).toBe(false);
  });
});
