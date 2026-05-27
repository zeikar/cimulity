import { describe, it, expect } from 'vitest';
import { World, DEFAULT_NEWCITY_SEED } from './World';
import { TileType, createTile } from './Tile';
import { Terrain, MIN_LAND_ELEVATION, SEA_LEVEL } from './Terrain';

function setTileCorners(world: World, x: number, y: number, h: number): void {
  const terrain = world.getTerrain();
  terrain.unsafeSetVertexHeight(x, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y + 1, h);
  terrain.unsafeSetVertexHeight(x, y + 1, h);
}

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

  it('returns false for a non-coplanar vertex tile (triangle wedge)', () => {
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
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    expect(map.getBuildings().getBuildingAt(0, 0)).not.toBeNull();

    world.regenerateTerrain(DEFAULT_NEWCITY_SEED);

    expect(map.getBuildings().getBuildingAt(0, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T1 Task 5 tests — frontage spawn + Branch B road-access gate
// ---------------------------------------------------------------------------
