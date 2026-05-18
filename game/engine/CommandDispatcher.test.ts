import { describe, it, expect } from 'vitest';
import { executeClick, executeDrag, previewDrag } from './CommandDispatcher';
import { Tool } from '../tools/Tool';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';

function makeWorld(size = 5): World {
  return new World(size, size);
}

describe('executeClick', () => {
  it('places a road on a grass tile and reports the change', () => {
    const world = makeWorld();
    const result = executeClick(Tool.ROAD, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
  });

  it('does not place a road on water', () => {
    const world = makeWorld();
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.WATER));

    const result = executeClick(Tool.ROAD, { x: 1, y: 1 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.WATER);
  });

  it('does not re-place a road on an existing road', () => {
    const world = makeWorld();
    executeClick(Tool.ROAD, { x: 0, y: 0 }, world);

    const result = executeClick(Tool.ROAD, { x: 0, y: 0 }, world);

    expect(result.changedTiles).toEqual([]);
  });

  it('reports no change when clicking out of bounds', () => {
    const world = makeWorld();
    const result = executeClick(Tool.ROAD, { x: 99, y: 99 }, world);

    expect(result.changedTiles).toEqual([]);
  });

  it('changes nothing for the SELECT tool', () => {
    const world = makeWorld();
    const result = executeClick(Tool.SELECT, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });

  it('treats not-yet-implemented tools as no-ops', () => {
    const world = makeWorld();

    expect(
      executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world).changedTiles
    ).toEqual([]);
    expect(
      executeClick(Tool.ZONE_RESIDENTIAL, { x: 2, y: 2 }, world).changedTiles
    ).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });
});

describe('executeDrag', () => {
  it('places roads along a bounds-filtered horizontal path', () => {
    const world = makeWorld(5);
    // Snapped path runs x=0..10,y=0; only x=0..4 are in bounds
    const result = executeDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 10, y: 0 }, world);

    expect(result.changedTiles).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('skips water tiles in the middle of a diagonal drag', () => {
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.WATER));

    const result = executeDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 4, y: 4 }, world);

    expect(result.changedTiles).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.WATER);
  });

  it('reports no change when the tool has no drag path', () => {
    const world = makeWorld();
    const result = executeDrag(Tool.SELECT, { x: 0, y: 0 }, { x: 3, y: 0 }, world);

    expect(result.changedTiles).toEqual([]);
  });
});

describe('previewDrag', () => {
  it('returns the bounds-filtered path without mutating core', () => {
    const world = makeWorld(5);
    const path = previewDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 10, y: 0 }, world);

    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
    // Nothing was written
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('returns an empty path for a tool with no drag rule', () => {
    const world = makeWorld();
    expect(previewDrag(Tool.SELECT, { x: 0, y: 0 }, { x: 3, y: 3 }, world)).toEqual([]);
  });
});
