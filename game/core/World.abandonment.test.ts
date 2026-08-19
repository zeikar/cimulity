import { describe, it, expect } from 'vitest';
import { World, ZONE_GROWTH_INTERVAL } from './World';
import { LEVEL_THRESHOLDS } from './growthConstants';
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

describe('World.tick() — congestion-driven abandonment', () => {
  /**
   * 1×1 building placed straight onto the (grass) tile that is already there: the
   * abandonment sweep iterates BUILDINGS, not zone tiles, so no zoning is needed —
   * and leaving the corridor unzoned keeps the zone-mix diversity term at 0, which
   * is what makes the land-value arithmetic below exact.
   */
  function addUnitBuilding(
    world: World,
    id: number,
    x: number,
    y: number,
    type: 'residential' | 'commercial',
    level: number,
    frontage: 'N' | 'S',
  ): void {
    const added = world.getMap().getBuildings().addExistingBuilding({
      id,
      type,
      footprint: [{ x, y }],
      anchor: { x, y },
      level,
      density: 0,
      age: 0,
      abandoned: false,
      frontage,
      structureRect: { x, y, w: 1, h: 1 },
    });
    expect(added).toBe(true);
  }

  it('congestion from real commute flows abandons an L2 probe, keeps it derelict while the jam persists, and recovers it when the jam clears', () => {
    // Corridor fixture: ONE road row (y=2) across a 48×6 world, residential feeders
    // west, commercial feeders east, and the L2 probe in the middle — so every matched
    // commute is forced across the probe's own frontage tile (24,2).
    //
    // Arithmetic, all derived from source:
    //   - Land value at the probe anchor (24,1) is ROAD proximity ONLY: no stations, no
    //     parks, and no zone tiles in the 3×3 → 0.40 · (1 − 1/(ROAD_RADIUS+1)) = 0.40 · 6/7
    //     ≈ 0.3429 (ROAD_WEIGHT / ROAD_RADIUS in LandValueMap.ts). That clears
    //     LEVEL_THRESHOLDS[2] = 0.25 with only 0.0929 of margin.
    //   - 40 workers ⇄ 40 jobs, and every one of the 40 matched flows crosses (24,2), so
    //     that tile carries load 40 → byte round(255 · 40 / TRAFFIC_CAPACITY) with
    //     TRAFFIC_CAPACITY = 64 (trafficAssignment.ts) → round(159.375) = 159.
    //   - Penalty at the anchor = CONGESTION_PENALTY_MAX(0.20) · (159/255) · 6/7 ≈ 0.1069,
    //     which is MORE than the 0.0929 margin → congested land value ≈ 0.2360 < 0.25 →
    //     maxSupportedLevel = 1 → the L2 probe is under-supported → abandoned.
    //   - The feeders are all level 1, and maxSupportedLevel floors at 1 (zoneGrowth.ts), so
    //     the load SOURCE can never abandon itself: the jam cannot self-clear (phase B).
    //   - No power plant is seeded: the abandonment sweep needs none, and the merge pass is
    //     fully blocked by its isBuildingPowered gate, so the contiguous L1 feeders that sit
    //     side by side never merge away underneath the fixture.
    const world = new World(48, 6, { regenerate: false });
    const map = world.getMap();
    const buildings = map.getBuildings();
    for (let x = 0; x < 48; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));

    // 40 L1 residential feeders → 40 workers, all west of the probe.
    let nextId = 0;
    for (let x = 2; x <= 21; x++) {
      addUnitBuilding(world, nextId++, x, 1, 'residential', 1, 'S');
      addUnitBuilding(world, nextId++, x, 3, 'residential', 1, 'N');
    }
    // 40 L1 commercial feeders → exactly 40 jobs, all east of the probe. Capacity is
    // consumed in ascending access-node order (laborMarket.ts), and the probe's access
    // node (24,2) is east of every feeder's, so the feeders take all 40 jobs and the
    // probe's own 2 workers stay unemployed — the probe adds no load of its own.
    const commercialIds: number[] = [];
    for (let x = 27; x <= 46; x++) {
      commercialIds.push(nextId);
      addUnitBuilding(world, nextId++, x, 1, 'commercial', 1, 'S');
      commercialIds.push(nextId);
      addUnitBuilding(world, nextId++, x, 3, 'commercial', 1, 'N');
    }
    const PROBE_ID = nextId;
    addUnitBuilding(world, PROBE_ID, 24, 1, 'residential', 2, 'S');

    // Phase A — congestion abandons the probe.
    world.markLaborDirty(); // labor → traffic → land value cascade
    tickOneGrowthInterval(world);

    // getTrafficMap() DRAINS, and the abandonment flip dirtied labor at the end of the
    // growth tick, so this read recomputes rather than returning the snapshot that drove
    // the decision. Invariant either way: the probe's workers are unemployed and add no
    // load, so abandoning it cannot change a single flow.
    expect(world.getTrafficMap().getCongestion(24, 2)).toBe(159); // 40 trips over capacity 64
    expect(world.getLandValue().getValue(24, 1)).toBeLessThan(LEVEL_THRESHOLDS[2]);
    expect(buildings.getBuilding(PROBE_ID)!.abandoned).toBe(true);
    // The easternmost feeder (21,1) fronts the same fully loaded stretch of corridor, so
    // its land value is suppressed below LEVEL_THRESHOLDS[2] exactly like the probe's —
    // yet it stays occupied, because maxSupportedLevel floors at 1.
    expect(world.getLandValue().getValue(21, 1)).toBeLessThan(LEVEL_THRESHOLDS[2]);
    expect(buildings.getBuildingAt(21, 1)!.abandoned).toBe(false);

    // Phase B — nothing changes, so the jam persists and the probe stays derelict.
    tickOneGrowthInterval(world);

    expect(world.getTrafficMap().getCongestion(24, 2)).toBe(159); // still jammed, not inferred
    expect(world.getLandValue().getValue(24, 1)).toBeLessThan(LEVEL_THRESHOLDS[2]);
    expect(buildings.getBuilding(PROBE_ID)!.abandoned).toBe(true);

    // Phase C — remove the job destinations: no jobs → no commutes → no congestion.
    for (const id of commercialIds) expect(buildings.removeBuilding(id)).toBe(true);
    world.markLaborDirty();
    tickOneGrowthInterval(world);

    expect(world.getTrafficMap().getCongestion(24, 2)).toBe(0);
    expect(world.getLandValue().getValue(24, 1)).toBeCloseTo(0.40 * (6 / 7), 6);
    expect(buildings.getBuilding(PROBE_ID)!.abandoned).toBe(false);
  });
});
