import { describe, it, expect } from 'vitest';
import { executeClick, executeDrag, previewDrag } from './CommandDispatcher';
import { Tool } from '../tools/Tool';
import { World } from '../core/World';
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

  it('previewDrag returns rectangle tiles for terrain tools without mutating', () => {
    const world = makeWorld();
    const path = previewDrag(Tool.TERRAIN_UP, { x: 0, y: 0 }, { x: 1, y: 1 }, world);
    expect(path).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
    expect(world.getTerrain().getVertexHeight(0, 0)).toBe(1);
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
