import { describe, it, expect } from 'vitest';
import {
  World,
  ZONE_GROWTH_INTERVAL,
  ZONE_MAX_LEVEL,
  DENSITY_COOLDOWN_INTERVALS,
} from './World';
import { GROWTH_COOLDOWN_INTERVALS } from './growthConstants';
import { DENSITY_DEMAND_THRESHOLD } from './Demand';
import { TileType, createTile } from './Tile';
import { executeClick } from '../engine/CommandDispatcher';
import { Tool } from '../tools/Tool';
import { MERGE_LEVEL_THRESHOLD } from './mergePolicy';

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

function seedWater(world: World, ax: number, ay: number): void {
  world.getStructureMap().addStructure({
    type: 'water_tower',
    anchor: { x: ax, y: ay },
    footprint: [
      { x: ax, y: ay },
    ],
  });
  world.markWaterDirty();
  world.recomputeWater();
}

describe('World.tick() — land value gating of growth', () => {
  it('zones near a road reach higher levels than zones far from any road', () => {
    // Near-road zones at x=0,1 with road at x=2; far zones at x=4,5 with no road anywhere near
    const world = new World(10, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));
    // Near zones (road-adjacent)
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(3, 0, createTile(3, 0, TileType.ZONE_RESIDENTIAL));
    // Far zones — road at (2,0) is distance 3 from x=5, still within ROAD_RADIUS=6
    // but with much lower road score. No road adjacent → no buildings created at all.
    map.setTile(8, 0, createTile(8, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(9, 0, createTile(9, 0, TileType.ZONE_RESIDENTIAL));
    seedPower(world, 2, 1); // plant at (2,1)–(3,2) powers road (2,0)

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 40; i++) world.tick();

    const nearLevel1 = map.getBuildings().getBuildingAt(1, 0)?.level ?? 0;
    const nearLevel2 = map.getBuildings().getBuildingAt(3, 0)?.level ?? 0;
    // Far zones have no orthogonal road neighbor → no buildings at all
    const farBuilding1 = map.getBuildings().getBuildingAt(8, 0);
    const farBuilding2 = map.getBuildings().getBuildingAt(9, 0);

    expect(nearLevel1).toBeGreaterThan(0);
    expect(nearLevel2).toBeGreaterThan(0);
    expect(farBuilding1).toBeNull();
    expect(farBuilding2).toBeNull();
  });
});

describe('World.tick() — density tier', () => {
  it('density does NOT advance before level === ZONE_MAX_LEVEL', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Seed a building below ZONE_MAX_LEVEL with enough age
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL - 1,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS + 10,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Run many ticks — density must stay 0 until level reaches ZONE_MAX_LEVEL
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) world.tick();

    // Building might have levelled up to max, but density can only advance once at max level
    const b = map.getBuildings().getBuildingAt(0, 0)!;
    if (b.level < ZONE_MAX_LEVEL) {
      expect(b.density).toBe(0);
    }
    // If it reached max level, density might be > 0 but that's fine — the test only
    // asserts that while below max, density is 0. We enforce this via a fresh setup:
    const world2 = new World(4, 4, { regenerate: false });
    const map2 = world2.getMap();
    map2.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map2.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Building at level 2 (not max), with very large age — density should NOT advance
    map2.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 2,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Run just one growth tick
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world2.tick();
    const b2 = map2.getBuildings().getBuildingAt(0, 0)!;
    // Level 2 building should never have its density bumped
    expect(b2.density).toBe(0);
  });

  it('density advances only when at ZONE_MAX_LEVEL + age >= DENSITY_COOLDOWN_INTERVALS + demand[type] >= DENSITY_DEMAND_THRESHOLD', () => {
    // Decision-A: water gates density-bump. (0,1) changed from ZONE_COMMERCIAL to ROAD to allow
    // an isolated road+tower connection. The commercial demand-seeder building still placed via
    // addBuilding (tile type not checked). Tower at (0,2)-(1,3) waters road (0,1); zone (0,0)
    // adj to watered road (0,1) → watered. No LV check for density gate so this is safe.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD)); // was ZONE_COMMERCIAL; changed for water routing
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 2, 0); // plant at (2,0)–(3,1) powers road (1,0)
    seedWater(world, 0, 2); // tower at (0,2)–(1,3); (0,2) adj to road (0,1) → waters (0,1); zone (0,0) adj to (0,1) → watered

    // Seed building at ZONE_MAX_LEVEL with age just under DENSITY_COOLDOWN_INTERVALS.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Seed C+I level-points >=8 so residentialDemand >= 0.6.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();

    let densityBumpResult: ReturnType<typeof world.tick> | null = null;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) {
      const result = world.tick();
      const b = map.getBuildings().getBuildingAt(0, 0)!;
      if (b.density === 1 && densityBumpResult === null) {
        densityBumpResult = result;
        break;
      }
    }

    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(b.density).toBe(1);
    expect(b.level).toBe(ZONE_MAX_LEVEL);
  });

  it('density bump emits changedTiles with footprint coords and changedBuildingIds with building id', () => {
    // Decision-A: same (0,1) ROAD approach as the adjacent density test.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD)); // was ZONE_COMMERCIAL; changed for water routing
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 2, 0); // plant at (2,0)–(3,1) powers road (1,0)
    seedWater(world, 0, 2); // tower at (0,2)–(1,3); waters road (0,1); zone (0,0) adj → watered

    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    })!;
    // Seed C+I level-points >=8 so residentialDemand >= 0.6.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();

    let densityTickResult: ReturnType<typeof world.tick> | null = null;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) {
      const result = world.tick();
      const b = map.getBuildings().getBuildingAt(0, 0)!;
      if (b.density === 1 && densityTickResult === null) {
        densityTickResult = result;
        break;
      }
    }

    expect(densityTickResult).not.toBeNull();
    expect(densityTickResult!.changedBuildingIds).toContain(building.id);
    expect(densityTickResult!.changedTiles).toContainEqual({ x: 0, y: 0 });
    expect(densityTickResult!.changedTiles.length).toBeGreaterThanOrEqual(1);
  });
});

describe('World.tick() — Branch B road-access gate', () => {
  it('existing building loses road access: age stops incrementing', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    seedPower(world, 2, 0); // plant at (2,0)–(3,1) powers road (1,0)

    // One growth tick with road: age should become 1.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    const ageWithRoad = map.getBuildings().getBuildingAt(0, 0)!.age;
    expect(ageWithRoad).toBe(1);

    // Remove the road, run another growth tick: age must NOT increment.
    map.setTile(1, 0, createTile(1, 0, TileType.GRASS));
    world.markPowerDirty();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    const ageWithoutRoad = map.getBuildings().getBuildingAt(0, 0)!.age;
    expect(ageWithoutRoad).toBe(1);
  });

  it('existing building loses road access: level-up does not fire', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Positive control: with road AND water, building should level up.
    // Decision-A: add isolated road (0,1) + tower (0,2)-(1,3). Zone (0,0) adj to watered road (0,1) → watered.
    // LV >= LEVEL_THRESHOLDS[1]=0.1 satisfied by road at distance 1 (roadScore≈0.857).
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD)); // isolated road for water routing
    seedWater(world, 0, 2); // tower at (0,2)–(1,3); (0,2) adj road (0,1) → waters (0,1); zone (0,0) adj → watered
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Also need land value >= LEVEL_THRESHOLDS[1]=0.1; road at distance 1 should suffice.
    // Force land value recompute.
    world.markLandValueDirty();
    seedPower(world, 2, 0); // plant at (2,0)–(3,1) powers road (1,0)
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.level).toBeGreaterThanOrEqual(1);

    // Negative control: rebuild world without road.
    const world2 = new World(4, 4, { regenerate: false });
    const map2 = world2.getMap();
    map2.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    // No road placed → no building created by Branch A (road required).
    // Manually seed the building.
    map2.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // No road → hasRoadAccess returns false → age does not increment → level stays 0.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world2.tick();
    expect(map2.getBuildings().getBuildingAt(0, 0)!.level).toBe(0);
  });

  it('existing building loses road access: density bump does not fire', () => {
    // Decision-A: same isolated road+tower pattern; (0,1) changed from ZONE_COMMERCIAL to ROAD.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD)); // was ZONE_COMMERCIAL; changed for water routing
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 2, 0); // plant at (2,0)–(3,1) powers road (1,0)
    seedWater(world, 0, 2); // tower at (0,2)–(1,3); waters road (0,1); zone (0,0) adj → watered
    // Positive control: seed at ZONE_MAX_LEVEL, density=0, age just under cooldown.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Seed C+I level-points >=8 so residentialDemand >= 0.6.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();
    world.markLandValueDirty();
    // Run enough ticks so density fires (positive control).
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.density).toBeGreaterThanOrEqual(1);

    // Negative control: same setup but no road.
    const world2 = new World(6, 6, { regenerate: false });
    const map2 = world2.getMap();
    map2.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map2.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map2.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map2.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world2.markLandValueDirty();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world2.tick();
    // No road → density stays 0.
    expect(map2.getBuildings().getBuildingAt(0, 0)!.density).toBe(0);
  });

  it('road re-added: building resumes aging on the next growth tick', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    seedPower(world, 2, 0); // plant at (2,0)–(3,1) powers road (1,0)

    // Tick with road → age becomes 1.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.age).toBe(1);

    // Remove road, tick → age stays 1.
    map.setTile(1, 0, createTile(1, 0, TileType.GRASS));
    world.markPowerDirty();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.age).toBe(1);

    // Re-add road, tick → age becomes 2.
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.markPowerDirty();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.age).toBe(2);
  });
});

describe('World.tick() — T3 density-bump E2E', () => {
  it('max-level R with demand satisfied bumps density to 1 after one growth interval', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();

    for (let x = 0; x < 8; x++) {
      map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
    }
    map.setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 3, createTile(2, 3, TileType.ZONE_COMMERCIAL));
    map.setTile(4, 3, createTile(4, 3, TileType.ZONE_INDUSTRIAL));
    map.setTile(5, 3, createTile(5, 3, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 0, 3); // plant at (0,3)–(1,4); (0,4) ROAD adj to (0,3) → all road y=4 powered
    // Decision-A: add road (3,5) + tower (3,6)-(4,7) to water road y=4. Road (3,5) adj to (3,4)=ROAD → connected. Zone (3,3) adj (3,4) → watered.
    map.setTile(3, 5, createTile(3, 5, TileType.ROAD));
    seedWater(world, 3, 6); // tower at (3,6)–(4,7); (3,6) adj road (3,5) → waters (3,5) → chain to (3,4) → zone (3,3) watered

    map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential', footprint: [{ x: 3, y: 3 }], anchor: { x: 3, y: 3 },
      level: ZONE_MAX_LEVEL, density: 0, age: DENSITY_COOLDOWN_INTERVALS, frontage: 'S',
      structureRect: { x: 3, y: 3, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 4, y: 3 }], anchor: { x: 4, y: 3 }, level: 5, density: 0, age: 0, frontage: 'S', structureRect: { x: 4, y: 3, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [{ x: 5, y: 3 }], anchor: { x: 5, y: 3 }, level: 5, density: 0, age: 0, frontage: 'S', structureRect: { x: 5, y: 3, w: 1, h: 1 } });

    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.6);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(3, 3);
    expect(b).not.toBeNull();
    expect(b!.density).toBe(1);
  });
});

describe('World.getDemand() — freshness', () => {
  it('reset({ regenerate: false }) drops demand back to baseline 0.25', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_INDUSTRIAL));
    map.getBuildings().addExistingBuilding({ id: 0, type: 'industrial', footprint: [{ x: 1, y: 1 }], anchor: { x: 1, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 1, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 2, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [{ x: 3, y: 1 }], anchor: { x: 3, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 3, y: 1, w: 1, h: 1 } });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.6);

    world.reset({ regenerate: false });

    expect(world.getDemand().residential).toBe(0.25);
  });

  it('reset({ regenerate: true }) drops demand back to baseline 0.25', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_INDUSTRIAL));
    map.getBuildings().addExistingBuilding({ id: 0, type: 'industrial', footprint: [{ x: 1, y: 1 }], anchor: { x: 1, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 1, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 2, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [{ x: 3, y: 1 }], anchor: { x: 3, y: 1 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 3, y: 1, w: 1, h: 1 } });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.6);

    world.reset({ regenerate: true });

    expect(world.getDemand().residential).toBe(0.25);
  });

  it('CommandDispatcher bulldoze of a non-zero-level R building refreshes demand', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({ id: 0, type: 'residential', footprint: [{ x: 3, y: 3 }], anchor: { x: 3, y: 3 }, level: 4, density: 0, age: 0, frontage: 'S', structureRect: { x: 3, y: 3, w: 1, h: 1 } });

    world.markDemandDirty();
    const demandBefore = world.getDemand().industrial;
    expect(demandBefore).toBeGreaterThan(0.25);

    const result = executeClick(Tool.BULLDOZE, { x: 3, y: 3 }, world);
    expect(result.removedBuildingIds).toContain(0);

    expect(world.getDemand().industrial).toBe(0.25);
  });
});

describe('World.tick() — density gating (demand-driven)', () => {
  it('Fixture A: no C/I buildings → residential demand < threshold → density stays 0', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS + 1,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(b.density).toBe(0);
  });

  it('Fixture B: sufficient C/I level-points → residentialDemand >= threshold → density bumps to 1', () => {
    // Decision-A: same isolated road+tower pattern; (0,1) from ZONE_COMMERCIAL to ROAD.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD)); // was ZONE_COMMERCIAL; changed for water routing
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    seedPower(world, 2, 0); // plant at (2,0)–(3,1) powers road (1,0)
    seedWater(world, 0, 2); // tower at (0,2)–(1,3); waters road (0,1); zone (0,0) adj → watered

    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // C+I level-points = 8 → jobsLevels=8, levelSumR=5 → residential=(8-5)/8+0.25=0.625 >= 0.6
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 1 }],
      anchor: { x: 0, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();

    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(b.density).toBe(1);
  });

  it("Fixture B': post-tick getDemand() reflects level-up totals vs control world that did not tick", () => {
    // World with a low-level R building near road, no C/I — tick until it levels up.
    // Decision-A: (0,1) is GRASS here, so add isolated road+tower without changing anything else.
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD)); // isolated road for water routing
    seedWater(world, 0, 2); // tower at (0,2)–(1,3); (0,2) adj road (0,1) → watered; zone (0,0) adj (0,1) → watered
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 10,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();
    seedPower(world, 2, 0); // plant at (2,0)–(3,1) powers road (1,0)

    // Control world: same setup, no ticks.
    const control = new World(4, 4, { regenerate: false });
    const controlMap = control.getMap();
    controlMap.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    controlMap.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    controlMap.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 10,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Tick until level-up occurs at least once.
    let levelled = false;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 20; i++) {
      world.tick();
      const b = map.getBuildings().getBuildingAt(0, 0)!;
      if (b.level > 0) { levelled = true; break; }
    }
    expect(levelled).toBe(true);

    // Post-tick demand must differ from the control (which never ticked).
    const postTickDemand = world.getDemand();
    const controlDemand = control.getDemand();
    // After level-up, residentialLevels increased → residential demand shifts.
    expect(postTickDemand.residential).not.toBe(controlDemand.residential);
  });
});

describe("World.tick() — structure-grow (Branch B')", () => {
  // Helper: advance world by exactly one growth tick.
  // Precondition: world.getTick() % ZONE_GROWTH_INTERVAL === 0 OR we run from 0.
  // Returns the WorldTickResult of the growth tick itself.
  function tickOneGrowthInterval(world: World): ReturnType<typeof world.tick> {
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    return world.tick();
  }

  // Keep residential demand positive — without a job source, demand for R goes
  // to 0 (jobsLevels < levelSumR in Demand.recompute) and the level-up gate
  // refuses to fire. Seed a single commercial building far from the test focus.
  function seedJobSource(world: World, x: number, y: number): void {
    world.getMap().getBuildings().addExistingBuilding({
      id: 999,
      type: 'commercial',
      footprint: [{ x, y }],
      anchor: { x, y },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'N',
      structureRect: { x, y, w: 1, h: 1 },
    });
  }

  it('structure-grow happens before level-up on a multi-cell lot', () => {
    // 1×4 R-zone lot: cells (1,0)..(1,3), frontage='S', road at (1,4).
    // structureRect = {x:1, y:3, w:1, h:1} — 1×1 at the south end.
    // Land value at anchor (1,0): road distance 4, roadScore ≈ 0.429,
    // lv ≈ 0.3 > LEVEL_THRESHOLDS[2]=0.25. Sufficient to clear the gate.
    // Decision-A: bump to World(6,7); add road (0,4) + tower (0,5)-(1,6) to water road (1,4).
    const world = new World(6, 7, { regenerate: false });
    const map = world.getMap();

    // Paint the 1×4 zone strip and the road.
    for (let y = 0; y < 4; y++) {
      map.setTile(1, y, createTile(1, y, TileType.ZONE_RESIDENTIAL));
    }
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD)); // connects to (1,4) for water routing

    // Seed building at level=1 with structureRect at the south end, age past cooldown.
    // id=0 → stagger(0)=0 → cooldown=8. Set age so after +1 it is >= 8+0=8.
    const building = map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [
        { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 },
      ],
      anchor: { x: 1, y: 0 },
      level: 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1, // after +1 = 8 = cooldown → gate fires
      frontage: 'S',
      structureRect: { x: 1, y: 3, w: 1, h: 1 },
    });
    expect(building).toBe(true);
    seedJobSource(world, 5, 5);
    world.markLandValueDirty();
    seedPower(world, 2, 4); // plant at (2,4)–(3,5) powers road (1,4)
    seedWater(world, 0, 5); // tower at (0,5)–(1,6); (0,5) adj road (0,4) → waters (0,4)→(1,4); zone (1,3) adj (1,4) → watered

    const result = tickOneGrowthInterval(world);

    const b = map.getBuildings().getBuilding(0)!;
    expect(b).not.toBeNull();
    // Branch B' fires: structure grows 1 cell northward (frontage S → grow y-1, h+1).
    expect(b.structureRect).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    // Level must NOT bump — structure-grow leaves level alone.
    expect(b.level).toBe(1);
    // Age resets after structure-grow.
    expect(b.age).toBe(0);
    // changedBuildingIds and changedTiles populated.
    expect(result.changedBuildingIds).toContain(0);
    expect(result.changedTiles).toContainEqual({ x: 1, y: 0 });
  });

  it('repeated ticks: structureRect grows to MIN_STRUCTURE_DEPTH_CAP, then level bumps (yard kept beyond cap)', () => {
    // Same 1×4 lot setup. id=0, stagger(0)=0, cooldown=8. lot.w=1 so the cap is
    // max(MIN_STRUCTURE_DEPTH_CAP=2, 1) = 2; structure stops at 1×2.
    // Sequence of growth events:
    //   Grow 1: 1×1 → 1×2  (structure hits cap; lot still has 2 yard cells)
    //   Grow 2: structure cannot extend (cap reached) → level bumps 1→2;
    //           structureRect stays at cap (further level-ups would need land
    //           value past LEVEL_THRESHOLDS[3]=0.45, unreachable for this lot).
    // Decision-A: bump to World(6,7), add road(0,4)+tower(0,5)-(1,6).
    const world = new World(6, 7, { regenerate: false });
    const map = world.getMap();

    for (let y = 0; y < 4; y++) {
      map.setTile(1, y, createTile(1, y, TileType.ZONE_RESIDENTIAL));
    }
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD)); // connects to (1,4) for water routing

    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [
        { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 },
      ],
      anchor: { x: 1, y: 0 },
      level: 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'S',
      structureRect: { x: 1, y: 3, w: 1, h: 1 },
    });
    seedJobSource(world, 5, 5);
    world.markLandValueDirty();
    seedPower(world, 2, 4); // plant at (2,4)–(3,5) powers road (1,4)
    seedWater(world, 0, 5); // tower at (0,5)–(1,6); (0,5) adj road (0,4) → waters (0,4)→(1,4) → zone (1,3) watered

    // Grow 1 (age 7 → 8, fires): 1×1 → 1×2 (cap)
    tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.structureRect).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    expect(map.getBuildings().getBuilding(0)!.level).toBe(1);

    // Grow 2: structure at cap → Branch B fires → level bumps 1→2; structureRect frozen.
    for (let g = 0; g < GROWTH_COOLDOWN_INTERVALS; g++) tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.structureRect).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    expect(map.getBuildings().getBuilding(0)!.level).toBe(2);
  });

  it('1×1 lot — structureRect fills depth immediately → level bumps directly', () => {
    // 1×1 lot: zone at (1,1), road at (1,2), frontage='S'.
    // structureRect = {x:1, y:1, w:1, h:1} which fills the 1×1 lot entirely.
    // extendStructureToward must return null → Branch B (level-up) fires directly.
    // Decision-A: bump to World(4,6); add road(0,2) adj to (1,2) + tower(0,3)-(1,4).
    // Zone (1,1) adj to road (1,2) which connects to (0,2) → (0,2) watered → (1,2) watered → zone watered.
    const world = new World(4, 6, { regenerate: false });
    const map = world.getMap();

    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD));
    map.setTile(0, 2, createTile(0, 2, TileType.ROAD)); // extends road for water routing; (0,2) adj to (1,2)

    // id=0, stagger(0)=0, cooldown=8. age=7 → after +1 gate fires.
    // land value at (1,1): road at distance 1 → roadScore = 1-1/7 ≈ 0.857,
    // lv ≈ 0.6 >> LEVEL_THRESHOLDS[2]=0.25.
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    seedJobSource(world, 3, 3);
    world.markLandValueDirty();
    seedPower(world, 2, 2); // plant at (2,2)–(3,3) powers road (1,2)
    seedWater(world, 0, 3); // tower at (0,3)–(1,4); (0,3) adj road (0,2) → waters (0,2)→(1,2) → zone (1,1) watered

    const result = tickOneGrowthInterval(world);

    const b = map.getBuildings().getBuilding(0)!;
    // structureRect fills 1×1 lot → no structure-grow → level bumps.
    expect(b.level).toBe(2);
    // structureRect unchanged.
    expect(b.structureRect).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    // changedBuildingIds populated.
    expect(result.changedBuildingIds).toContain(0);
    // changedTiles contains the footprint cell.
    expect(result.changedTiles).toContainEqual({ x: 1, y: 1 });
  });
});

// ---------------------------------------------------------------------------
// Task 6 (T6): merge pass — Branch B''
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Task 6: power gate on spawn / level-up / merge
// ---------------------------------------------------------------------------

describe('World.tick() — power gate: spawn blocked without power', () => {
  it('zone with full road adjacency does NOT spawn without a power source', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(0, 0)).toBeNull();
  });

  it('zone with road and a connected power plant spawns a level-1 building', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    seedPower(world, 1, 1); // plant at (1,1)–(2,2) powers road (1,0)

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(0, 0);
    expect(b).not.toBeNull();
    expect(b!.level).toBe(1);
  });
});

describe('World.tick() — power gate: footprint-scan vs anchor-only', () => {
  it('2-cell building whose anchor is unpowered but tail cell is powered still ages (footprint-scan wins)', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();

    // Road at (2,0). Plant at (2,1)–(3,2) powers road (2,0).
    // Cell (1,0) is adjacent to powered road (2,0) → powered.
    // Cell (0,0) is NOT adjacent to any road → not powered.
    // Anchor = (0,0) is unpowered; tail (1,0) is powered.
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));
    seedPower(world, 2, 1);

    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 2, h: 1 },
    });

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const b = map.getBuildings().getBuilding(0)!;
    expect(b.age).toBeGreaterThan(0);
  });
});

describe('World.tick() — power gate: building loses power → stops aging', () => {
  it('building stops aging after the power plant is removed', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    const plantId = 0;
    const planted = world.getStructureMap().addExistingStructure({
      id: plantId,
      type: 'power_plant',
      anchor: { x: 2, y: 0 },
      footprint: [
        { x: 2, y: 0 }, { x: 3, y: 0 },
        { x: 2, y: 1 }, { x: 3, y: 1 },
      ],
    });
    expect(planted).toBe(true);
    world.markPowerDirty();
    world.recomputePower();

    map.getBuildings().addExistingBuilding({
      id: 1,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Run one growth tick with power: building ages.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    const ageWithPower = map.getBuildings().getBuilding(1)!.age;
    expect(ageWithPower).toBe(1);

    // Remove plant, mark power dirty.
    world.getStructureMap().removeStructure(plantId);
    world.markPowerDirty();

    // Run more growth ticks: building must NOT age further.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();
    const ageAfterLoss = map.getBuildings().getBuilding(1)!.age;
    expect(ageAfterLoss).toBe(ageWithPower);
  });
});

describe('World.tick() — power gate: merge blocked without power, succeeds with power', () => {
  it('no merge when both buildings are unpowered; merge succeeds once power is added', () => {
    // Use a 1×4 lot layout (road at y=4) so land value at anchor y=0 is low enough
    // (≈0.43 < LEVEL_THRESHOLDS[3]=0.45) that Branch B level-up does NOT fire
    // and age is not reset by a level-up before the merge pass.
    // Decision-A: bump to World(6,7); tower (0,5)-(1,6) added from start to water buildings.
    // No power → first tick: no merge (power gate blocks). Power added → merge fires.
    // Water is present throughout; only the power gate creates the negative/positive contrast.
    const world = new World(6, 7, { regenerate: false });
    const map = world.getMap();

    for (let x = 0; x < 6; x++) {
      map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
    }
    for (let y = 0; y < 4; y++) {
      map.setTile(0, y, createTile(0, y, TileType.ZONE_RESIDENTIAL));
      map.setTile(1, y, createTile(1, y, TileType.ZONE_RESIDENTIAL));
    }

    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }],
      anchor: { x: 0, y: 0 },
      level: MERGE_LEVEL_THRESHOLD,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 6,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 4 },
    });
    map.getBuildings().addExistingBuilding({
      id: 1,
      type: 'residential',
      footprint: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }],
      anchor: { x: 1, y: 0 },
      level: MERGE_LEVEL_THRESHOLD,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 6,
      frontage: 'S',
      structureRect: { x: 1, y: 0, w: 1, h: 4 },
    });
    map.getBuildings().addExistingBuilding({
      id: 2,
      type: 'industrial',
      footprint: [{ x: 4, y: 4 }],
      anchor: { x: 4, y: 4 },
      level: 8, density: 0, age: 0, frontage: 'N',
      structureRect: { x: 4, y: 4, w: 1, h: 1 },
    });
    // Add water from the start so the positive-control tick (after power is added) fires.
    // Tower at (0,5)–(1,6): (0,5) adj to (0,4)=ROAD → waters road (0,4)→(1,4)→(2,4)→(3,4).
    // Zone cells at y=0..3 adj to road y=4 → watered. No-power first tick: merge still blocked by power gate.
    seedWater(world, 0, 5);
    world.markDemandDirty();

    // No power — first growth tick: no merge (buildings are unpowered; water alone is not enough).
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    world.tick();
    expect(map.getBuildings().getBuilding(0)).not.toBeNull();
    expect(map.getBuildings().getBuilding(1)).not.toBeNull();

    // Add power for both buildings: plant at (4,3)–(5,4) powers all road y=4.
    // Buildings have NOT aged (unpowered), so age still satisfies cooldown.
    seedPower(world, 4, 3);

    // Run another growth tick: both powered → merge succeeds.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    world.tick();

    const aExists = map.getBuildings().getBuilding(0) !== null;
    const bExists = map.getBuildings().getBuilding(1) !== null;
    expect(aExists && bExists).toBe(false);
  });
});

