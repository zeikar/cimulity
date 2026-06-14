import { describe, it, expect } from 'vitest';
import { World, ZONE_GROWTH_INTERVAL } from './World';
import { TileType, createTile } from './Tile';

/** Seed a 2×2 power plant at (ax,ay) and recompute power. */
function seedPower(world: World, ax: number, ay: number): void {
  world.getStructureMap().addStructure({
    type: 'power_plant',
    anchor: { x: ax, y: ay },
    footprint: [
      { x: ax, y: ay }, { x: ax + 1, y: ay },
      { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 },
    ],
  });
  world.markPowerDirty();
  world.recomputePower();
}

/** Advance the world by exactly one growth interval (ending on a growth tick). */
function tickOneGrowthInterval(world: World): ReturnType<World['tick']> {
  for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
  return world.tick();
}

describe('World.tick() — abandonment / dilapidation', () => {
  it('a high-level building on under-supported land is abandoned and excluded from population', () => {
    // Level-2 building with NO road near its anchor → land value 0 →
    // maxSupportedLevel = 1 → level 2 is under-supported → abandoned.
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 2,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();
    expect(world.getPopulation()).toBe(2 * 10);

    tickOneGrowthInterval(world);

    const b = map.getBuildings().getBuilding(0)!;
    expect(b.abandoned).toBe(true);
    expect(b.level).toBe(2); // level unchanged by abandonment
    expect(world.getPopulation()).toBe(0); // abandoned excluded
  });

  it('restoring land value recovers the building; level is remembered and population returns', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 2,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();

    // No road → abandoned.
    tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.abandoned).toBe(true);
    expect(world.getPopulation()).toBe(0);

    // Add a road adjacent to the anchor → land value clears LEVEL_THRESHOLDS[2]=0.25
    // (roadScore ≈ 0.857 × 0.40 + diversity term) so maxSupportedLevel >= 2 → recovers.
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.markLandValueDirty();
    tickOneGrowthInterval(world);

    const b = map.getBuildings().getBuilding(0)!;
    expect(b.abandoned).toBe(false);
    expect(b.level).toBe(2); // remembered, never reset
    expect(world.getPopulation()).toBe(2 * 10); // restored
  });

  it('same-tick re-occupation freeze: a recovering building does not age or level-up on the recovery tick, but resumes the next growth tick', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 2,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();
    // Power plant adjacent to where the recovery road will go, so once the road is
    // added the building is powered and aging is gated only by abandonment.
    seedPower(world, 2, 0); // plant (2,0)-(3,1); (2,0) adj to the future road (1,0)

    // No road → abandoned. (Power present but the abandonment freeze stops aging.)
    tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.abandoned).toBe(true);
    const ageWhileAbandoned = map.getBuildings().getBuilding(0)!.age;

    // Add road → recovery tick. The building flips abandoned:false in the sweep but
    // is in frozenThisTick, so it must NOT age or level-up on this same tick.
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.markPowerDirty();
    world.markLandValueDirty();
    tickOneGrowthInterval(world);
    const recoverB = map.getBuildings().getBuilding(0)!;
    expect(recoverB.abandoned).toBe(false);
    expect(recoverB.age).toBe(ageWhileAbandoned); // frozen this tick — no age++
    expect(recoverB.level).toBe(2); // frozen this tick — no level-up

    // Next growth tick: no longer frozen → resumes aging.
    tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.age).toBe(ageWhileAbandoned + 1);
  });

  it('an abandoned building does not age or level-up across several growth ticks', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 3,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();
    seedPower(world, 4, 4);

    for (let i = 0; i < 5; i++) tickOneGrowthInterval(world);

    const b = map.getBuildings().getBuilding(0)!;
    expect(b.abandoned).toBe(true);
    expect(b.age).toBe(0); // never aged while abandoned
    expect(b.level).toBe(3); // never levelled
  });

  it('a level-1 building on zero-value land is NOT abandoned (level-1 floor)', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();

    tickOneGrowthInterval(world);

    expect(map.getBuildings().getBuilding(0)!.abandoned).toBe(false);
  });

  it('the abandonment flip pushes the building id into changedBuildingIds and its cells into changedTiles', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
      anchor: { x: 0, y: 0 },
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    world.markLandValueDirty();

    const result = tickOneGrowthInterval(world);

    expect(map.getBuildings().getBuilding(0)!.abandoned).toBe(true);
    expect(result.changedBuildingIds).toContain(0);
    expect(result.changedTiles).toContainEqual({ x: 0, y: 0 });
    expect(result.changedTiles).toContainEqual({ x: 0, y: 1 });
  });
});
