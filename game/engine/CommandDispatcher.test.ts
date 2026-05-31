import { describe, it, expect } from 'vitest';
import { executeClick, executeDrag, previewDrag, previewClick, applyCommands } from './CommandDispatcher';
import { Tool } from '../tools/Tool';
import { World } from '../core/World';
import { POWER_PLANT_COST, WATER_TOWER_COST, BULLDOZE_COST, POLICE_STATION_COST } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { MAX_ELEVATION, SEA_LEVEL } from '../core/Terrain';

function makeWorld(size = 6): World {
  return new World(size, size, { regenerate: false });
}

describe('CommandDispatcher tile tools', () => {
  it('places roads on flat dry terrain and charges money', () => {
    const world = makeWorld();
    const before = world.getMoney();
    const result = executeClick(Tool.ROAD, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
    expect(world.getMoney()).toBeLessThan(before);
  });

  it('rejects building tools on any-corner water', () => {
    const world = makeWorld();
    world.getTerrain().unsafeSetVertexHeight(1, 1, SEA_LEVEL);
    expect(executeClick(Tool.ROAD, { x: 1, y: 1 }, world).changedTiles).toEqual([]);
    expect(executeClick(Tool.ZONE_RESIDENTIAL, { x: 1, y: 1 }, world).changedTiles).toEqual([]);
  });

  it('previewDrag returns ToolPreview struct for terrain tools without mutating', () => {
    const world = makeWorld();
    const preview = previewDrag(Tool.TERRAIN_UP, { x: 0, y: 0 }, { x: 1, y: 1 }, world);
    expect(preview.pathTiles).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
    expect(world.getTerrain().getVertexHeight(0, 0)).toBe(1);
  });

  it('previewDrag(ROAD) on a 3-tile path with one water tile flags allOrNothingBlocked and reports rejection without mutation', () => {
    const world = makeWorld(8);
    // Sink one corner of tile (1,0) to SEA_LEVEL so it becomes water; (0,0) and (2,0) remain dry.
    world.getTerrain().unsafeSetVertexHeight(1, 0, SEA_LEVEL);
    const heightBefore = world.getTerrain().getVertexHeight(1, 0);
    const preview = previewDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 2, y: 0 }, world);
    expect(preview.pathTiles).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(preview.rejected).toContainEqual({ x: 1, y: 0 });
    expect(preview.allOrNothingBlocked).toBe(true);
    // No mutation: vertex height unchanged.
    expect(world.getTerrain().getVertexHeight(1, 0)).toBe(heightBefore);
  });

  it('previewDrag(ZONE_RESIDENTIAL) on a 2x2 rect with one water tile reports rejection without all-or-nothing block', () => {
    const world = makeWorld(8);
    // Sink one corner of tile (1,1) to SEA_LEVEL → tile (1,1) is water, (0,0)/(1,0)/(0,1) remain dry.
    world.getTerrain().unsafeSetVertexHeight(2, 2, SEA_LEVEL);
    const heightBefore = world.getTerrain().getVertexHeight(2, 2);
    const preview = previewDrag(Tool.ZONE_RESIDENTIAL, { x: 0, y: 0 }, { x: 1, y: 1 }, world);
    expect(preview.pathTiles.length).toBe(4);
    expect(preview.rejected).toContainEqual({ x: 1, y: 1 });
    expect(preview.allOrNothingBlocked).toBe(false);
    expect(world.getTerrain().getVertexHeight(2, 2)).toBe(heightBefore);
  });

  it('returns empty changedTiles when player cannot afford the command cost', () => {
    // Drain the treasury so ROAD placement (ROAD_COST=10) fails.
    const world = makeWorld();
    world.trySpend(world.getMoney()); // drain to 0
    const result = executeClick(Tool.ROAD, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).not.toBe(TileType.ROAD);
  });

  it('executeDrag returns empty result when all drag tiles are out of bounds', () => {
    const world = makeWorld(4);
    // Drag to an entirely OOB tile coordinate; filter removes it, tiles=[].
    const result = executeDrag(Tool.ROAD, { x: 10, y: 10 }, { x: 11, y: 10 }, world);
    expect(result.changedTiles).toEqual([]);
  });
});

describe('CommandDispatcher terrain vertex edits', () => {
  it('TERRAIN_UP raises the clicked tile vertices and redraws touched tiles', () => {
    const world = makeWorld();
    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);
    expect(world.getTerrain().getTileCornerHeights(2, 2)).toEqual({
      topH: 2,
      rightH: 2,
      bottomH: 2,
      leftH: 2,
    });
    expect(result.changedTiles).toEqual(
      expect.arrayContaining([
        { x: 2, y: 2 },
        { x: 1, y: 1 },
        { x: 3, y: 3 },
      ])
    );
  });

  it('TERRAIN_DOWN converts touched DIRT tiles to GRASS when any corner reaches sea level', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(world.isWater(2, 2)).toBe(true);
    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
  });

  it('partial apply skips invalid vertices and still applies later valid vertices in row-major order', () => {
    const world = makeWorld();
    for (let vy = 1; vy <= 4; vy++) {
      for (let vx = 1; vx <= 4; vx++) {
        world.getTerrain().unsafeSetVertexHeight(vx, vy, 5);
      }
    }
    world.getTerrain().unsafeSetVertexHeight(2, 2, MAX_ELEVATION);
    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);
    expect(world.getTerrain().getVertexHeight(2, 2)).toBe(MAX_ELEVATION);
    expect(world.getTerrain().getVertexHeight(3, 2)).toBe(6);
    expect(world.getTerrain().getVertexHeight(2, 3)).toBe(6);
    expect(world.getTerrain().getVertexHeight(3, 3)).toBe(6);
    expect(result.changedTiles.length).toBeGreaterThan(0);
  });

  it('drag edits the deduped vertex rectangle once per vertex', () => {
    const world = makeWorld();
    const result = executeDrag(Tool.TERRAIN_UP, { x: 0, y: 0 }, { x: 1, y: 0 }, world);
    for (const [vx, vy] of [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] as const) {
      expect(world.getTerrain().getVertexHeight(vx, vy)).toBe(2);
    }
    expect(result.changedTiles).toContainEqual({ x: 0, y: 0 });
    expect(result.changedTiles).toContainEqual({ x: 1, y: 0 });
  });
});

describe('CommandDispatcher POWER_PLANT placement', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  it('places 4 POWER_PLANT tiles, registers structure, and deducts POWER_PLANT_COST', () => {
    const world = makeWorld8();
    const before = world.getMoney();
    const result = executeClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    // 4 tiles changed.
    expect(result.changedTiles).toHaveLength(4);
    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(result.changedTiles).toContainEqual({ x: 3, y: 2 });
    expect(result.changedTiles).toContainEqual({ x: 2, y: 3 });
    expect(result.changedTiles).toContainEqual({ x: 3, y: 3 });
    // All 4 cells are POWER_PLANT.
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        expect(world.getMap().getTile(2 + dx, 2 + dy)?.type).toBe(TileType.POWER_PLANT);
      }
    }
    // StructureMap registered.
    expect(world.getStructureMap().getStructureAt(2, 2)).not.toBeNull();
    expect(world.getStructureMap().getStructureAt(3, 3)).not.toBeNull();
    // Cost deducted.
    expect(world.getMoney()).toBe(before - POWER_PLANT_COST);
  });

  it('post-apply power recompute: a road connected to the plant is isPowered immediately (no tick)', () => {
    const world = makeWorld8();
    // Place the plant at (2,2).
    executeClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    // Place a road adjacent to the plant at (1,2) — orthogonally adjacent to plant cell (2,2).
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    // The road should be powered immediately without any tick.
    expect(world.getPowerMap().isPowered(1, 2)).toBe(true);
  });

  it('insufficient funds → no tile writes, no structure, no cost deducted', () => {
    const world = makeWorld8();
    world.trySpend(world.getMoney()); // drain to 0
    const before = world.getMoney();
    const result = executeClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(world.getStructureMap().getStructureAt(2, 2)).toBeNull();
    expect(world.getMoney()).toBe(before);
  });

  it('drag from (5,5) to (10,10) behaves identically to click at (5,5)', () => {
    const world = makeWorld8();
    const before = world.getMoney();
    // executeDrag collapses to [start] via pathForTool(POWER_PLANT).
    const result = executeDrag(Tool.POWER_PLANT, { x: 5, y: 5 }, { x: 10, y: 10 }, world);
    // (5,5) anchor — (6,6) is the SE corner; both must be in-bounds on 8×8.
    expect(result.changedTiles).toHaveLength(4);
    expect(world.getStructureMap().getStructureAt(5, 5)).not.toBeNull();
    expect(world.getMoney()).toBe(before - POWER_PLANT_COST);
  });

  it('placing a road adjacent to an existing plant makes that road isPowered immediately (no tick)', () => {
    const world = makeWorld8();
    // Plant at (2,2)–(3,3).
    executeClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    // Road adjacent to plant: (4,2) is orthogonally adjacent to plant cell (3,2).
    executeClick(Tool.ROAD, { x: 4, y: 2 }, world);
    expect(world.getPowerMap().isPowered(4, 2)).toBe(true);
  });
});

describe('CommandDispatcher POWER_PLANT removal (bulldoze)', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  function placePlant(world: World, ax: number, ay: number): void {
    executeClick(Tool.POWER_PLANT, { x: ax, y: ay }, world);
  }

  it('bulldozing NW cell writes 4 DIRT, removes structure, deducts BULLDOZE_COST once', () => {
    const world = makeWorld8();
    placePlant(world, 2, 2);
    const before = world.getMoney();
    const result = executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    // 4 tiles should change to DIRT.
    expect(result.changedTiles).toHaveLength(4);
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        expect(world.getMap().getTile(2 + dx, 2 + dy)?.type).toBe(TileType.DIRT);
      }
    }
    // Structure removed.
    expect(world.getStructureMap().getStructureAt(2, 2)).toBeNull();
    expect(world.getStructureMap().getStructureAt(3, 3)).toBeNull();
    // Cost deducted once.
    expect(world.getMoney()).toBe(before - BULLDOZE_COST);
  });

  it('bulldozing SE cell behaves identically (whole-footprint atomicity)', () => {
    const world = makeWorld8();
    placePlant(world, 2, 2);
    const before = world.getMoney();
    const result = executeClick(Tool.BULLDOZE, { x: 3, y: 3 }, world);
    expect(result.changedTiles).toHaveLength(4);
    expect(world.getStructureMap().getStructureAt(2, 2)).toBeNull();
    expect(world.getMoney()).toBe(before - BULLDOZE_COST);
  });

  it('bulldoze removal triggers post-apply recompute — powered road loses power immediately', () => {
    const world = makeWorld8();
    // Plant at (2,2). Road adjacent at (1,2).
    placePlant(world, 2, 2);
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    expect(world.getPowerMap().isPowered(1, 2)).toBe(true);
    // Remove the plant.
    executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    expect(world.getPowerMap().isPowered(1, 2)).toBe(false);
  });

  it('drag-rect covering 3 plant cells + 1 grass → 4 DIRT, structure removed, BULLDOZE_COST once', () => {
    const world = makeWorld8();
    placePlant(world, 2, 2);
    const before = world.getMoney();
    const result = executeDrag(Tool.BULLDOZE, { x: 2, y: 2 }, { x: 3, y: 3 }, world);
    // All 4 plant cells replaced with DIRT.
    expect(result.changedTiles).toHaveLength(4);
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        expect(world.getMap().getTile(2 + dx, 2 + dy)?.type).toBe(TileType.DIRT);
      }
    }
    expect(world.getStructureMap().getStructureAt(2, 2)).toBeNull();
    // Cost charged once for one plant.
    expect(world.getMoney()).toBe(before - BULLDOZE_COST);
  });

  it('drag-rect covering two adjacent plants → 8 DIRT, both structures removed, BULLDOZE_COST × 2', () => {
    const world = makeWorld8();
    placePlant(world, 0, 0);
    placePlant(world, 0, 2);
    const before = world.getMoney();
    const result = executeDrag(Tool.BULLDOZE, { x: 0, y: 0 }, { x: 1, y: 3 }, world);
    // 8 plant cells → 8 DIRT.
    expect(result.changedTiles).toHaveLength(8);
    expect(world.getStructureMap().getStructureAt(0, 0)).toBeNull();
    expect(world.getStructureMap().getStructureAt(0, 2)).toBeNull();
    expect(world.getMoney()).toBe(before - BULLDOZE_COST * 2);
  });

  it('bulldozing a road tile dirties power — orphan side loses power immediately (regression guard)', () => {
    const world = makeWorld8();
    // Plant at (0,0). Road chain: (2,0),(3,0),(4,0). Road at (2,0) bridges from plant.
    placePlant(world, 0, 0);
    executeClick(Tool.ROAD, { x: 2, y: 0 }, world);
    executeClick(Tool.ROAD, { x: 3, y: 0 }, world);
    executeClick(Tool.ROAD, { x: 4, y: 0 }, world);
    // (2,0) is adjacent to plant cell (1,0), so the whole chain is powered.
    expect(world.getPowerMap().isPowered(4, 0)).toBe(true);
    // Bulldoze the bridge road at (2,0) — (3,0) and (4,0) lose power.
    executeClick(Tool.BULLDOZE, { x: 2, y: 0 }, world);
    expect(world.getPowerMap().isPowered(4, 0)).toBe(false);
  });
});

describe('CommandDispatcher WATER_TOWER placement', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  it('places 1 WATER_TOWER tile, registers structure, and deducts WATER_TOWER_COST', () => {
    const world = makeWorld8();
    const before = world.getMoney();
    const result = executeClick(Tool.WATER_TOWER, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toHaveLength(1);
    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.WATER_TOWER);
    expect(world.getStructureMap().getStructureAt(2, 2)).not.toBeNull();
    expect(world.getMoney()).toBe(before - WATER_TOWER_COST);
  });

  it('post-apply water recompute: a road connected to the tower is isWatered immediately (no tick)', () => {
    const world = makeWorld8();
    executeClick(Tool.WATER_TOWER, { x: 2, y: 2 }, world);
    // Road adjacent to tower at (1,2) — orthogonally adjacent to tower cell (2,2).
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    expect(world.getWaterMap().isWatered(1, 2)).toBe(true);
  });

  it('insufficient funds → no tile writes, no structure, no cost deducted', () => {
    const world = makeWorld8();
    world.trySpend(world.getMoney()); // drain to 0
    const before = world.getMoney();
    const result = executeClick(Tool.WATER_TOWER, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(world.getStructureMap().getStructureAt(2, 2)).toBeNull();
    expect(world.getMoney()).toBe(before);
  });

  it('drag from (5,5) to (10,10) behaves identically to click at (5,5)', () => {
    const world = makeWorld8();
    const before = world.getMoney();
    const result = executeDrag(Tool.WATER_TOWER, { x: 5, y: 5 }, { x: 10, y: 10 }, world);
    expect(result.changedTiles).toHaveLength(1);
    expect(world.getStructureMap().getStructureAt(5, 5)).not.toBeNull();
    expect(world.getMoney()).toBe(before - WATER_TOWER_COST);
  });

  it('placing a road adjacent to an existing tower makes that road isWatered immediately (no tick)', () => {
    const world = makeWorld8();
    executeClick(Tool.WATER_TOWER, { x: 2, y: 2 }, world);
    // Road adjacent: (3,2) is orthogonally adjacent to tower cell (2,2).
    executeClick(Tool.ROAD, { x: 3, y: 2 }, world);
    expect(world.getWaterMap().isWatered(3, 2)).toBe(true);
  });

  it('INDEPENDENCE GUARD: placing a water tower does NOT change getPowerMap() — road adjacent only to tower is NOT isPowered', () => {
    const world = makeWorld8();
    executeClick(Tool.WATER_TOWER, { x: 2, y: 2 }, world);
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    // Road is watered (connected to tower via road network)
    expect(world.getWaterMap().isWatered(1, 2)).toBe(true);
    // But NOT powered — no power plant exists
    expect(world.getPowerMap().isPowered(1, 2)).toBe(false);
  });

  it('INDEPENDENCE GUARD: placing a power plant does NOT change getWaterMap() — road adjacent only to plant is NOT isWatered', () => {
    const world = makeWorld8();
    executeClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    expect(world.getPowerMap().isPowered(1, 2)).toBe(true);
    // NOT watered — no water tower exists
    expect(world.getWaterMap().isWatered(1, 2)).toBe(false);
  });
});

describe('CommandDispatcher WATER_TOWER removal (bulldoze)', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  function placeTower(world: World, ax: number, ay: number): void {
    executeClick(Tool.WATER_TOWER, { x: ax, y: ay }, world);
  }

  it('bulldozing the single cell writes 1 DIRT, removes structure, deducts BULLDOZE_COST once', () => {
    const world = makeWorld8();
    placeTower(world, 2, 2);
    const before = world.getMoney();
    const result = executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toHaveLength(1);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.DIRT);
    expect(world.getStructureMap().getStructureAt(2, 2)).toBeNull();
    expect(world.getMoney()).toBe(before - BULLDOZE_COST);
  });

  it('bulldoze removal triggers post-apply recompute — watered road loses water immediately', () => {
    const world = makeWorld8();
    placeTower(world, 2, 2);
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    expect(world.getWaterMap().isWatered(1, 2)).toBe(true);
    executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    expect(world.getWaterMap().isWatered(1, 2)).toBe(false);
  });

  it('SOURCE-SELECTION GUARD: bulldozing a tower does not deprive power from a road that was only connected to a plant', () => {
    const world = makeWorld8();
    // Plant at (4,0): cells (4,0),(5,0),(4,1),(5,1). Road at (3,0): adjacent to plant cell (4,0).
    executeClick(Tool.POWER_PLANT, { x: 4, y: 0 }, world);
    // Tower at (0,0): cells (0,0),(1,0),(0,1),(1,1). Road at (3,0) is NOT adjacent to tower.
    placeTower(world, 0, 0);
    executeClick(Tool.ROAD, { x: 3, y: 0 }, world);
    expect(world.getPowerMap().isPowered(3, 0)).toBe(true);
    // Bulldoze the tower — both maps are recomputed (shared exclusion-set coupling), but
    // source-selection is independent: the tower was never a power source, so the road
    // remains powered by the plant after both maps drain.
    executeClick(Tool.BULLDOZE, { x: 0, y: 0 }, world);
    expect(world.getPowerMap().isPowered(3, 0)).toBe(true);
  });
});

describe('CommandDispatcher POLICE_STATION placement + service dirty-marking', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  it('places a 2×2 POLICE_STATION, registers structure, and deducts POLICE_STATION_COST', () => {
    const world = makeWorld8();
    const before = world.getMoney();
    const result = executeClick(Tool.POLICE_STATION, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toHaveLength(4);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.POLICE_STATION);
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.POLICE_STATION);
    expect(world.getStructureMap().getStructureAt(2, 2)).not.toBeNull();
    expect(world.getMoney()).toBe(before - POLICE_STATION_COST);
  });

  it('placing a police station marks service dirty: an adjacent road has non-zero coverage immediately (no tick)', () => {
    const world = makeWorld8();
    executeClick(Tool.POLICE_STATION, { x: 2, y: 2 }, world);
    // Road at (1,2) is orthogonally adjacent to station footprint cell (2,2).
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    expect(world.getServiceCoverageMap().getCoverage(1, 2)).toBeGreaterThan(0);
  });

  it('placing AND removing a road marks service dirty: a previously-covered cell loses coverage', () => {
    const world = makeWorld8();
    executeClick(Tool.POLICE_STATION, { x: 2, y: 2 }, world);
    // Station footprint is (2,2)..(3,3). Road (1,2) is adjacent to station cell (2,2) → seeded.
    // Road (0,2) is NOT adjacent to any station cell — it is covered ONLY by reaching the
    // station through (1,2).
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    executeClick(Tool.ROAD, { x: 0, y: 2 }, world);
    expect(world.getServiceCoverageMap().getCoverage(0, 2)).toBeGreaterThan(0);
    // Bulldoze the connecting road (1,2): (0,2) is now disconnected from the station.
    executeClick(Tool.BULLDOZE, { x: 1, y: 2 }, world);
    expect(world.getServiceCoverageMap().getCoverage(0, 2)).toBe(0);
  });

  it('bulldozing a police station removes coverage from a previously-covered road immediately', () => {
    const world = makeWorld8();
    executeClick(Tool.POLICE_STATION, { x: 2, y: 2 }, world);
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    expect(world.getServiceCoverageMap().getCoverage(1, 2)).toBeGreaterThan(0);
    executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    expect(world.getServiceCoverageMap().getCoverage(1, 2)).toBe(0);
  });
});

describe('previewClick POLICE_STATION', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  it('POLICE_STATION over a valid flat area → pathTiles has the 2×2 footprint, rejected empty', () => {
    const world = makeWorld8();
    const preview = previewClick(Tool.POLICE_STATION, { x: 2, y: 2 }, world);
    expect(preview.pathTiles).toHaveLength(4);
    expect(preview.pathTiles).toContainEqual({ x: 2, y: 2 });
    expect(preview.pathTiles).toContainEqual({ x: 3, y: 3 });
    expect(preview.rejected).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });

  it('POLICE_STATION on non-flat ground → whole 2×2 footprint is rejected', () => {
    const world = makeWorld8();
    world.getTerrain().unsafeSetVertexHeight(3, 3, 0); // SEA_LEVEL — makes the footprint non-flat
    const preview = previewClick(Tool.POLICE_STATION, { x: 2, y: 2 }, world);
    expect(preview.pathTiles).toHaveLength(4);
    expect(preview.rejected).toHaveLength(4);
  });
});

describe('previewClick WATER_TOWER', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  it('WATER_TOWER over a valid flat cell → pathTiles has 1 footprint cell, rejected empty', () => {
    const world = makeWorld8();
    const preview = previewClick(Tool.WATER_TOWER, { x: 2, y: 2 }, world);
    expect(preview.pathTiles).toEqual([
      { x: 2, y: 2 },
    ]);
    expect(preview.rejected).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });

  it('WATER_TOWER on non-flat ground → pathTiles has 1 cell AND rejected equals that 1 cell', () => {
    const world = makeWorld8();
    world.getTerrain().unsafeSetVertexHeight(3, 3, 0); // SEA_LEVEL — makes cell (2,2) non-flat
    const preview = previewClick(Tool.WATER_TOWER, { x: 2, y: 2 }, world);
    const expectedFootprint = [
      { x: 2, y: 2 },
    ];
    expect(preview.pathTiles).toEqual(expectedFootprint);
    expect(preview.rejected).toEqual(expectedFootprint);
  });
});

describe('CommandDispatcher applyCommands invariant throws', () => {
  it('place-structure throws when addStructure returns null (footprint already occupied)', () => {
    // Place a plant via the normal tool path so the cells are occupied in StructureMap.
    const world = new World(8, 8, { regenerate: false });
    executeClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    // Confirm the structure is registered.
    expect(world.getStructureMap().getStructureAt(2, 2)).not.toBeNull();

    // Craft a place-structure command that overlaps the existing plant.
    // applyCommands will call addStructure on already-occupied cells → returns null → invariant throw.
    const cmd = { kind: 'place-structure' as const, x: 2, y: 2, structureType: 'power_plant' as const };
    expect(() => applyCommands([cmd], world)).toThrow(/invariant/i);
  });

  it('remove-structure throws when structureId does not exist in StructureMap', () => {
    // World with no structures at all — id 999 will not be found.
    const world = new World(8, 8, { regenerate: false });

    const cmd = { kind: 'remove-structure' as const, structureId: 999 };
    expect(() => applyCommands([cmd], world)).toThrow(/invariant/i);
  });
});

describe('previewClick', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  it('POWER_PLANT over a valid flat 2×2 → pathTiles has 4 footprint cells, rejected empty', () => {
    const world = makeWorld8();
    // Default world is flat grass — the structure-placement classifier accepts anchor (2,2).
    const preview = previewClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    expect(preview.pathTiles).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
    expect(preview.rejected).toEqual([]);
    // No mutation: tile remains GRASS.
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });

  it('POWER_PLANT on non-flat ground (classifier rejects) → pathTiles has 4 cells AND rejected equals all 4', () => {
    const world = makeWorld8();
    // Sink one corner of the footprint below SEA_LEVEL so the slab is not flat+dry.
    world.getTerrain().unsafeSetVertexHeight(3, 3, SEA_LEVEL);
    const preview = previewClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    const expectedFootprint = [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];
    expect(preview.pathTiles).toEqual(expectedFootprint);
    expect(preview.rejected).toEqual(expectedFootprint);
  });

  it('ROAD over a buildable tile → pathTiles length 1, rejected empty', () => {
    const world = makeWorld8();
    const preview = previewClick(Tool.ROAD, { x: 3, y: 3 }, world);
    expect(preview.pathTiles).toEqual([{ x: 3, y: 3 }]);
    expect(preview.rejected).toEqual([]);
  });

  it('ROAD over water (classifier rejects) → pathTiles [tile], rejected [tile]', () => {
    const world = makeWorld8();
    // Sink one corner of tile (3,3) to SEA_LEVEL so canBuildRoadAt rejects.
    world.getTerrain().unsafeSetVertexHeight(3, 3, SEA_LEVEL);
    const preview = previewClick(Tool.ROAD, { x: 3, y: 3 }, world);
    expect(preview.pathTiles).toEqual([{ x: 3, y: 3 }]);
    expect(preview.rejected).toEqual([{ x: 3, y: 3 }]);
  });

  it('ROAD over an existing ROAD tile (classifier returns skip, not reject) → pathTiles [tile], rejected EMPTY', () => {
    const world = makeWorld8();
    // Pre-place a road so classifyRoadTile returns 'skip' (not 'reject').
    executeClick(Tool.ROAD, { x: 3, y: 3 }, world);
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.ROAD);
    const preview = previewClick(Tool.ROAD, { x: 3, y: 3 }, world);
    expect(preview.pathTiles).toEqual([{ x: 3, y: 3 }]);
    expect(preview.rejected).toEqual([]);
  });

  it('SELECT → empty preview', () => {
    const world = makeWorld8();
    const preview = previewClick(Tool.SELECT, { x: 3, y: 3 }, world);
    expect(preview.pathTiles).toEqual([]);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
    expect(preview.affectedBuildingIds.size).toBe(0);
  });

  it('out-of-bounds tile → empty preview', () => {
    const world = makeWorld8();
    const preview = previewClick(Tool.ROAD, { x: 99, y: 99 }, world);
    expect(preview.pathTiles).toEqual([]);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
    expect(preview.affectedBuildingIds.size).toBe(0);
  });

  it('BULLDOZE hovering a power-plant cell → pathTiles equals the full 4-cell structure footprint', () => {
    const world = makeWorld8();
    // Place a plant at anchor (2,2): footprint cells (2,2),(3,2),(2,3),(3,3).
    executeClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    const expectedFootprint = [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];
    // Hover over the SE cell — should expand to the full footprint via buildToolPreview.
    const preview = previewClick(Tool.BULLDOZE, { x: 3, y: 3 }, world);
    expect(preview.pathTiles).toEqual(expect.arrayContaining(expectedFootprint));
    expect(preview.pathTiles).toHaveLength(4);
    // No mutation: structure still present.
    expect(world.getStructureMap().getStructureAt(2, 2)).not.toBeNull();
  });

  it('BULLDOZE over empty ground → pathTiles is [tile] (1 cell)', () => {
    const world = makeWorld8();
    const preview = previewClick(Tool.BULLDOZE, { x: 3, y: 3 }, world);
    expect(preview.pathTiles).toEqual([{ x: 3, y: 3 }]);
  });
});

describe('previewDrag BULLDOZE structure-footprint expansion', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  it('previewDrag BULLDOZE over a single plant cell → pathTiles equals the full 4-cell footprint', () => {
    const world = makeWorld8();
    executeClick(Tool.POWER_PLANT, { x: 2, y: 2 }, world);
    // Drag from one plant cell to itself (mirrors onDragPreview(tile,tile) on pointerdown).
    const preview = previewDrag(Tool.BULLDOZE, { x: 3, y: 3 }, { x: 3, y: 3 }, world);
    const expected = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }];
    expect(preview.pathTiles).toHaveLength(4);
    expect(preview.pathTiles).toEqual(expect.arrayContaining(expected));
    // No mutation.
    expect(world.getStructureMap().getStructureAt(2, 2)).not.toBeNull();
  });

  it('previewDrag BULLDOZE over empty ground → pathTiles is [tile]', () => {
    const world = makeWorld8();
    const preview = previewDrag(Tool.BULLDOZE, { x: 1, y: 1 }, { x: 1, y: 1 }, world);
    expect(preview.pathTiles).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('CommandDispatcher fire coverage dirty-fanout (non-placement regression)', () => {
  function makeWorld8(): World {
    return new World(8, 8, { regenerate: false });
  }

  /**
   * Seed a fire station directly via addStructure (no Tool.FIRE_STATION yet — Task 5).
   * This mirrors what a hydrated save would produce. After seeding we MUST call
   * markFireDirty + recomputeFire to establish a KNOWN-FRESH baseline, otherwise
   * the FireCoverageMap is still all-zeros and assertions pass vacuously.
   */
  function seedFireStation(world: World, ax: number, ay: number): void {
    const map = world.getMap();
    // Write the four FIRE_STATION tiles so the map has the correct tile types.
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        map.setTile(ax + dx, ay + dy, { x: ax + dx, y: ay + dy, type: TileType.FIRE_STATION, level: 0 });
      }
    }
    world.getStructureMap().addStructure({
      type: 'fire_station',
      anchor: { x: ax, y: ay },
      footprint: [
        { x: ax,     y: ay     },
        { x: ax + 1, y: ay     },
        { x: ax,     y: ay + 1 },
        { x: ax + 1, y: ay + 1 },
      ],
    });
    // Establish a KNOWN-FRESH fire map baseline before any assertions.
    world.markFireDirty();
    world.recomputeFire();
  }

  it('bulldozing a fire station drops coverage on a previously-covered road IMMEDIATELY (no tick)', () => {
    const world = makeWorld8();
    // Fire station at (2,2)–(3,3). Road at (1,2) adjacent to station cell (2,2).
    seedFireStation(world, 2, 2);
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);

    // KNOWN-FRESH baseline: road (1,2) is covered by the fire station.
    expect(world.getFireCoverageMap().getCoverage(1, 2)).toBeGreaterThan(0);

    // Bulldoze the station — coverage should drop IMMEDIATELY (no tick needed).
    executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    expect(world.getFireCoverageMap().getCoverage(1, 2)).toBe(0);
  });

  it('a road edit near the fire station updates fire coverage IMMEDIATELY (no tick)', () => {
    const world = makeWorld8();
    // Fire station at (2,2)–(3,3). Road at (1,2) bridges to (0,2).
    seedFireStation(world, 2, 2);
    executeClick(Tool.ROAD, { x: 1, y: 2 }, world);
    // (0,2) is reachable from the station through (1,2).
    executeClick(Tool.ROAD, { x: 0, y: 2 }, world);

    // KNOWN-FRESH baseline: (0,2) has coverage through the road chain.
    expect(world.getFireCoverageMap().getCoverage(0, 2)).toBeGreaterThan(0);

    // Bulldoze the connecting road (1,2) — (0,2) loses coverage IMMEDIATELY.
    executeClick(Tool.BULLDOZE, { x: 1, y: 2 }, world);
    expect(world.getFireCoverageMap().getCoverage(0, 2)).toBe(0);
  });
});

describe('CommandDispatcher TERRAIN_LEVEL', () => {
  it('Test 9: TERRAIN_LEVEL drag with dry DIRT tile — level write crosses SEA_LEVEL and reconciles DIRT→GRASS', () => {
    const world = new World(6, 6, { regenerate: false });

    // Install a DIRT tile at (3,3).
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.DIRT));

    // Set DIRT tile corners to 2 (dry: all corners > SEA_LEVEL=0).
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    world.getTerrain().unsafeSetVertexHeight(4, 3, 2);
    world.getTerrain().unsafeSetVertexHeight(3, 4, 2);
    world.getTerrain().unsafeSetVertexHeight(4, 4, 2);

    // Set dragStart tile (0,0) corners to 0 — this is the level target.
    world.getTerrain().unsafeSetVertexHeight(0, 0, 0);
    world.getTerrain().unsafeSetVertexHeight(1, 0, 0);
    world.getTerrain().unsafeSetVertexHeight(0, 1, 0);
    world.getTerrain().unsafeSetVertexHeight(1, 1, 0);

    // Pad rows 2–5, cols 2–5 to 0 (except the four DIRT corners already set to 2).
    // This ensures canPlayerSetVertexHeight admits writing DIRT corners to 0: |2-0|=2 ≤3.
    for (let vy = 2; vy <= 5; vy++) {
      for (let vx = 2; vx <= 5; vx++) {
        if ((vx === 3 || vx === 4) && (vy === 3 || vy === 4)) continue; // DIRT corners stay at 2
        world.getTerrain().unsafeSetVertexHeight(vx, vy, 0);
      }
    }

    // Pre-condition: DIRT tile is dry before the call.
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.DIRT);
    expect(world.isWater(3, 3)).toBe(false);

    // Execute TERRAIN_LEVEL drag from (0,0) to (4,4). dragStart=(0,0), target=0.
    // All 25 tiles (0,0)–(4,4) are in the rect; DIRT is not structured, so its corners are collected.
    // After writing DIRT corners to 0, min corner of (3,3) = 0 ≤ SEA_LEVEL → reconcile to GRASS.
    const result = executeDrag(Tool.TERRAIN_LEVEL, { x: 0, y: 0 }, { x: 4, y: 4 }, world);

    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.GRASS);
    expect(world.isWater(3, 3)).toBe(true);
    expect(result.changedTiles).toContainEqual({ x: 3, y: 3 });
  });
});
