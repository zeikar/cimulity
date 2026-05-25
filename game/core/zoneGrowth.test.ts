import { describe, it, expect } from 'vitest';
import { World } from './World';
import { TileType, createTile } from './Tile';
import {
  pickSpawnSize,
  enumerateFootprintsContaining,
  pickFrontage,
  hasRoadAccess,
  validateFootprintRect,
  footprintCells,
} from './zoneGrowth';

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

describe('pickSpawnSize', () => {
  it('always returns { w: 1, h: 1 } regardless of coordinates', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(pickSpawnSize(0, 0, world)).toEqual({ w: 1, h: 1 });
    expect(pickSpawnSize(3, 3, world)).toEqual({ w: 1, h: 1 });
    expect(pickSpawnSize(99, 99, world)).toEqual({ w: 1, h: 1 });
  });
});

describe('enumerateFootprintsContaining', () => {
  it('1×1 returns exactly one rect at the seed tile', () => {
    const rects = enumerateFootprintsContaining({ x: 2, y: 3 }, 1, 1, 10, 10);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x: 2, y: 3, w: 1, h: 1 });
  });

  it('2×1 at interior seed returns 2 rects', () => {
    // seed at x=3, y=3, w=2, h=1 → rects with NW corner at x=3 and x=2
    const rects = enumerateFootprintsContaining({ x: 3, y: 3 }, 2, 1, 10, 10);
    expect(rects).toHaveLength(2);
    // Both rects contain seed (3,3): [x=3,w=2] and [x=2,w=2]
    const xs = rects.map(r => r.x).sort((a, b) => a - b);
    expect(xs).toEqual([2, 3]);
    for (const r of rects) {
      expect(r.h).toBe(1);
      expect(r.w).toBe(2);
    }
  });

  it('clips rects that would fall off the map edge', () => {
    // seed at x=0, y=0 with w=2: only the rect with NW at x=0 is in-bounds (x=-1 is out)
    const rects = enumerateFootprintsContaining({ x: 0, y: 0 }, 2, 1, 10, 10);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 2, h: 1 });
  });

  it('clips rects that exceed the right map edge', () => {
    // seed at x=9 (last col), w=2, mapW=10: only rect with NW at x=8 fits (x+w=10 ≤ mapW)
    // NW at x=9 → x+w=11 > 10, so clipped
    const rects = enumerateFootprintsContaining({ x: 9, y: 0 }, 2, 1, 10, 10);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x: 8, y: 0, w: 2, h: 1 });
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
