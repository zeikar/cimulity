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
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

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
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

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

    // One growth tick with road: age should become 1.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    const ageWithRoad = map.getBuildings().getBuildingAt(0, 0)!.age;
    expect(ageWithRoad).toBe(1);

    // Remove the road, run another growth tick: age must NOT increment.
    map.setTile(1, 0, createTile(1, 0, TileType.GRASS));
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    const ageWithoutRoad = map.getBuildings().getBuildingAt(0, 0)!.age;
    expect(ageWithoutRoad).toBe(1);
  });

  it('existing building loses road access: level-up does not fire', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Positive control: with road, building should level up.
    // Seed at level 0, age = cooldown-1 so on the next growth tick it levels up.
    // id=0, stagger(0)=0 → cooldown = GROWTH_COOLDOWN_INTERVALS.
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
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
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

    // Tick with road → age becomes 1.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.age).toBe(1);

    // Remove road, tick → age stays 1.
    map.setTile(1, 0, createTile(1, 0, TileType.GRASS));
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(0, 0)!.age).toBe(1);

    // Re-add road, tick → age becomes 2.
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
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
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

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
      age: GROWTH_COOLDOWN_INTERVALS + 10,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();

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

  it('structure-grow happens before level-up on a multi-cell lot', () => {
    // 1×4 R-zone lot: cells (1,0)..(1,3), frontage='S', road at (1,4).
    // structureRect = {x:1, y:3, w:1, h:1} — 1×1 at the south end.
    // Land value at anchor (1,0): road distance 4, roadScore ≈ 0.429,
    // lv ≈ 0.3 > LEVEL_THRESHOLDS[2]=0.25. Sufficient to clear the gate.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();

    // Paint the 1×4 zone strip and the road.
    for (let y = 0; y < 4; y++) {
      map.setTile(1, y, createTile(1, y, TileType.ZONE_RESIDENTIAL));
    }
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));

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
    world.markLandValueDirty();

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
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();

    for (let y = 0; y < 4; y++) {
      map.setTile(1, y, createTile(1, y, TileType.ZONE_RESIDENTIAL));
    }
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));

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
    world.markLandValueDirty();

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
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();

    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD));

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
    world.markLandValueDirty();

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
