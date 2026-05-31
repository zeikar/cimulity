import { describe, it, expect } from 'vitest';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { inspectTile } from './inspectTile';

function makeWorld(size = 6): World {
  return new World(size, size, { regenerate: false });
}

describe('inspectTile', () => {
  it('returns null for out-of-bounds coordinates', () => {
    const world = makeWorld();
    expect(inspectTile(world, { x: -1, y: 0 })).toBeNull();
    expect(inspectTile(world, { x: 0, y: 99 })).toBeNull();
  });

  it('reports tile type and zone level', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL, 3));
    const info = inspectTile(world, { x: 2, y: 2 });
    expect(info).not.toBeNull();
    expect(info!.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(info!.level).toBe(3);
    expect(info!.x).toBe(2);
    expect(info!.y).toBe(2);
  });

  it('reports power state from the power map', () => {
    const world = makeWorld();
    const info = inspectTile(world, { x: 1, y: 1 });
    // A fresh flat world has no power source, so no tile is powered.
    expect(info!.powered).toBe(false);
  });

  it('reports a power plant as powered even though its cells are never raw-powered', () => {
    const world = makeWorld();
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ],
      anchor: { x: 1, y: 1 },
    });
    world.recomputePower();
    // The plant is a SOURCE: its footprint cells are never raw-powered...
    expect(world.getPowerMap().isPowered(2, 2)).toBe(false);
    // ...but the panel reports it powered since it's an active supplier.
    expect(inspectTile(world, { x: 2, y: 2 })!.powered).toBe(true);
  });

  it('reports a building as powered when any footprint cell is powered', () => {
    const world = makeWorld();
    // A 2x1 residential building spanning (2,2)-(3,2).
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      anchor: { x: 2, y: 2 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 2, h: 1 },
    });
    // Power only the first footprint cell; the second stays raw-unpowered.
    const size = 6;
    world.getPowerMap().getRaw()[2 * size + 2] = 1;
    expect(world.getPowerMap().isPowered(3, 2)).toBe(false);

    // Clicking the raw-unpowered cell still reports the building powered,
    // matching isBuildingPowered (the predicate growth uses).
    expect(inspectTile(world, { x: 3, y: 2 })!.powered).toBe(true);
  });

  it('reports water state from the water map', () => {
    const world = makeWorld();
    const info = inspectTile(world, { x: 1, y: 1 });
    // A fresh flat world has no water source, so no tile is watered.
    expect(info!.watered).toBe(false);
  });

  it('reports a water tower as watered (source) and not powered; a power plant is the mirror', () => {
    const towerWorld = makeWorld();
    towerWorld.getStructureMap().addStructure({
      type: 'water_tower',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
    });
    towerWorld.recomputeWater();
    towerWorld.recomputePower();
    // The tower is a water SOURCE: its cell is never raw-watered...
    expect(towerWorld.getWaterMap().isWatered(1, 1)).toBe(false);
    // ...but the panel reports it watered (active supplier), and not powered (not on the grid).
    const tower = inspectTile(towerWorld, { x: 1, y: 1 })!;
    expect(tower.watered).toBe(true);
    expect(tower.powered).toBe(false);

    // A power plant is the inverse: powered (its own source utility) but not watered.
    const plantWorld = makeWorld();
    plantWorld.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ],
      anchor: { x: 1, y: 1 },
    });
    plantWorld.recomputePower();
    plantWorld.recomputeWater();
    const plant = inspectTile(plantWorld, { x: 2, y: 2 })!;
    expect(plant.powered).toBe(true);
    expect(plant.watered).toBe(false);
  });

  it('reports a building as watered when any footprint cell is watered', () => {
    const world = makeWorld();
    // A 2x1 residential building spanning (2,2)-(3,2).
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      anchor: { x: 2, y: 2 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 2, h: 1 },
    });
    // Water only the first footprint cell; the second stays raw-unwatered.
    const size = 6;
    world.getWaterMap().getRaw()[2 * size + 2] = 1;
    expect(world.getWaterMap().isWatered(3, 2)).toBe(false);

    // Clicking the raw-unwatered cell still reports the building watered,
    // matching isBuildingWatered (the predicate growth uses).
    expect(inspectTile(world, { x: 3, y: 2 })!.watered).toBe(true);
  });

  it('reports land value in [0, 1]', () => {
    const world = makeWorld();
    const info = inspectTile(world, { x: 1, y: 1 });
    expect(info!.landValue).toBeGreaterThanOrEqual(0);
    expect(info!.landValue).toBeLessThanOrEqual(1);
  });

  it('drains the dirty land-value cache so a fresh edit is not reported stale', () => {
    const world = makeWorld();
    // Establish a baseline cache (flat grass → 0) with the dirty flag cleared.
    world.recomputeLandValue();
    expect(world.getLandValue().getValue(2, 2)).toBe(0);

    // Place a road and mark dirty WITHOUT recomputing — simulates building
    // while paused, before the next tick drains land value.
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    world.markLandValueDirty();

    // A road raises its own tile's land value; inspecting must reflect it.
    const info = inspectTile(world, { x: 2, y: 2 });
    expect(info!.landValue).toBeGreaterThan(0);
  });

  it('surfaces a grown building occupying the tile', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 1,
      density: 2,
      age: 5,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });
    const info = inspectTile(world, { x: 2, y: 2 });
    expect(info!.building).toEqual({ type: 'residential', level: 1, density: 2, age: 5 });
    expect(info!.structure).toBeNull();
  });

  it('surfaces a placed structure occupying the tile', () => {
    const world = makeWorld();
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ],
      anchor: { x: 1, y: 1 },
    });
    const info = inspectTile(world, { x: 2, y: 2 });
    expect(info!.structure).toEqual({ type: 'power_plant' });
    expect(info!.building).toBeNull();
  });

  it('reports no building or structure on empty terrain', () => {
    const world = makeWorld();
    const info = inspectTile(world, { x: 0, y: 0 });
    expect(info!.building).toBeNull();
    expect(info!.structure).toBeNull();
  });
});
