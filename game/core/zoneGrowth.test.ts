import { describe, it, expect } from 'vitest';
import { World } from './World';
import { TileType, createTile } from './Tile';
import {
  depthAxisFromFrontage,
  pickSeedFrontage,
  greedyDepthLot,
  initialStructureRect,
  extendStructureToward,
  structureRectFillsLotDepth,
  pickFrontage,
  hasRoadAccess,
  validateFootprintRect,
  footprintCells,
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

describe('pickFrontage', () => {
  it('returns S when road is only to the south of a 1×1', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    // Tile at (2,2) is the footprint; road at (2,3) = south neighbor
    map.setTile(2, 3, createTile(2, 3, TileType.ROAD));
    expect(pickFrontage({ x: 2, y: 2, w: 1, h: 1 }, world)).toBe('S');
  });

  it('tie-break: road N and S → S wins', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    map.setTile(2, 1, createTile(2, 1, TileType.ROAD)); // N neighbor
    map.setTile(2, 3, createTile(2, 3, TileType.ROAD)); // S neighbor
    expect(pickFrontage({ x: 2, y: 2, w: 1, h: 1 }, world)).toBe('S');
  });

  it('tie-break: road N, E, W (no S) → E wins', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    map.setTile(2, 1, createTile(2, 1, TileType.ROAD)); // N
    map.setTile(3, 2, createTile(3, 2, TileType.ROAD)); // E
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD)); // W
    expect(pickFrontage({ x: 2, y: 2, w: 1, h: 1 }, world)).toBe('E');
  });

  it('tie-break: road N and W only → W wins', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    map.setTile(2, 1, createTile(2, 1, TileType.ROAD)); // N
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD)); // W
    expect(pickFrontage({ x: 2, y: 2, w: 1, h: 1 }, world)).toBe('W');
  });

  it('2×2 with 2 roads on N edge and 1 on E edge → N wins (count > count)', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    // Rect at (1,1), w=2, h=2 → N neighbors at (1,0) and (2,0); E neighbors at (3,1) and (3,2)
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));
    map.setTile(3, 1, createTile(3, 1, TileType.ROAD));
    expect(pickFrontage({ x: 1, y: 1, w: 2, h: 2 }, world)).toBe('N');
  });

  it('returns null when no perimeter cell touches a road', () => {
    const world = new World(5, 5, { regenerate: false });
    expect(pickFrontage({ x: 2, y: 2, w: 1, h: 1 }, world)).toBeNull();
  });
});

describe('hasRoadAccess', () => {
  it('returns true for a 1×1 building next to a road', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    seedZone(world, 2, 2);
    map.setTile(2, 3, createTile(2, 3, TileType.ROAD));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    })!;
    expect(hasRoadAccess(building, world)).toBe(true);
  });

  it('returns false for a 1×1 building with no road neighbors', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    seedZone(world, 2, 2);
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    })!;
    expect(hasRoadAccess(building, world)).toBe(false);
  });

  it('returns true for a 2×1 building where only one perimeter cell touches a road', () => {
    // Verifies footprint-level check, not seed-tile precheck
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    seedZone(world, 1, 2);
    seedZone(world, 2, 2);
    // Road only adjacent to right side of the 2×1 building (x=3, y=2) → E face
    map.setTile(3, 2, createTile(3, 2, TileType.ROAD));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 1, y: 2 }, { x: 2, y: 2 }],
      anchor: { x: 1, y: 2 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 2, w: 2, h: 1 },
    })!;
    expect(hasRoadAccess(building, world)).toBe(true);
  });

  it('returns false after the adjacent road tile is replaced with grass', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    seedZone(world, 2, 2);
    map.setTile(2, 3, createTile(2, 3, TileType.ROAD));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    })!;
    expect(hasRoadAccess(building, world)).toBe(true);
    // Now remove the road
    map.setTile(2, 3, createTile(2, 3, TileType.GRASS));
    expect(hasRoadAccess(building, world)).toBe(false);
  });
});

describe('validateFootprintRect', () => {
  it('accepts happy-path 1×1 zone tile next to road on flat terrain', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    seedZone(world, 2, 2);
    map.setTile(2, 3, createTile(2, 3, TileType.ROAD));
    expect(
      validateFootprintRect({ x: 2, y: 2, w: 1, h: 1 }, TileType.ZONE_RESIDENTIAL, world)
    ).toBe(true);
  });

  it('accepts happy-path 2×2 zone block next to road on uniformly-flat same-height terrain', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    // Set up 2×2 zone block at (1,1)...(2,2)
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 2; x++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
      }
    }
    // Make entire 2×2 area flat at height 1 — share ALL vertices uniformly
    const terrain = world.getTerrain();
    for (let vy = 1; vy <= 3; vy++) {
      for (let vx = 1; vx <= 3; vx++) {
        terrain.unsafeSetVertexHeight(vx, vy, 1);
      }
    }
    // Road south of the block
    map.setTile(1, 3, createTile(1, 3, TileType.ROAD));
    expect(
      validateFootprintRect({ x: 1, y: 1, w: 2, h: 2 }, TileType.ZONE_RESIDENTIAL, world)
    ).toBe(true);
  });

  it('rejects rect.w === 5 (out of {1..4})', () => {
    const world = new World(10, 10, { regenerate: false });
    expect(
      validateFootprintRect({ x: 0, y: 0, w: 5, h: 1 }, TileType.ZONE_RESIDENTIAL, world)
    ).toBe(false);
  });

  it('rejects when a cell is out-of-bounds', () => {
    const world = new World(3, 3, { regenerate: false });
    // Rect extends beyond map edge
    expect(
      validateFootprintRect({ x: 2, y: 2, w: 2, h: 1 }, TileType.ZONE_RESIDENTIAL, world)
    ).toBe(false);
  });

  it('rejects when cells have mixed zone types', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_COMMERCIAL));
    setTileFlat(world, 1, 1, 1);
    setTileFlat(world, 2, 1, 1);
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD));
    expect(
      validateFootprintRect({ x: 1, y: 1, w: 2, h: 1 }, TileType.ZONE_RESIDENTIAL, world)
    ).toBe(false);
  });

  it('rejects when a cell is owned (has a building)', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    seedZone(world, 2, 2);
    map.setTile(2, 3, createTile(2, 3, TileType.ROAD));
    // Add a building that occupies (2,2)
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });
    expect(
      validateFootprintRect({ x: 2, y: 2, w: 1, h: 1 }, TileType.ZONE_RESIDENTIAL, world)
    ).toBe(false);
  });

  it('rejects when a cell is non-flat (sloped terrain)', () => {
    const world = new World(5, 5, { regenerate: false });
    const map = world.getMap();
    // Put zone tile at (2,2) but with sloped terrain (corners at different heights)
    map.setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    const terrain = world.getTerrain();
    terrain.unsafeSetVertexHeight(2, 2, 1);
    terrain.unsafeSetVertexHeight(3, 2, 2); // different → not flat
    terrain.unsafeSetVertexHeight(3, 3, 1);
    terrain.unsafeSetVertexHeight(2, 3, 1);
    map.setTile(2, 3, createTile(2, 3, TileType.ROAD));
    expect(
      validateFootprintRect({ x: 2, y: 2, w: 1, h: 1 }, TileType.ZONE_RESIDENTIAL, world)
    ).toBe(false);
  });

  it('rejects when no perimeter cell touches a road', () => {
    const world = new World(5, 5, { regenerate: false });
    seedZone(world, 2, 2);
    // No road placed anywhere
    expect(
      validateFootprintRect({ x: 2, y: 2, w: 1, h: 1 }, TileType.ZONE_RESIDENTIAL, world)
    ).toBe(false);
  });
});

describe('footprintCells', () => {
  it('returns cells in row-major order for {x:1,y:2,w:2,h:1}', () => {
    const cells = footprintCells({ x: 1, y: 2, w: 2, h: 1 });
    expect(cells).toEqual([{ x: 1, y: 2 }, { x: 2, y: 2 }]);
  });

  it('returns cells in y-major, x-minor order for a 2×2 rect', () => {
    const cells = footprintCells({ x: 0, y: 0, w: 2, h: 2 });
    expect(cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });
});
