import { describe, it, expect } from 'vitest';
import { World, ZONE_GROWTH_INTERVAL } from './World';
import { LEVEL_THRESHOLDS, POPULATION_PER_LEVEL, POPULATION_PER_TILE_LEVEL } from './growthConstants';
import { TRAFFIC_CAPACITY } from './trafficAssignment';
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
    expect(world.getPopulation()).toBe(2 * POPULATION_PER_TILE_LEVEL);

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
    expect(world.getPopulation()).toBe(2 * POPULATION_PER_TILE_LEVEL); // restored
  });

  it('same-tick re-occupation freeze: a recovering building ages but does not level-up on the recovery tick, and keeps aging the next growth tick', () => {
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
    // Power plant adjacent to where the recovery road will go. Power reaches a building only
    // through an orthogonally adjacent powered ROAD cell (PowerMap.ts), so the plant does
    // nothing until that road exists — after which the building is both road-accessed and
    // powered, leaving the freeze as the only thing still gating its GROWTH.
    seedPower(world, 2, 0); // plant (2,0)-(3,1); (2,0) adj to the future road (1,0)

    // No road → abandoned, and the ROAD gate (not the freeze) is what holds age at 0: it
    // runs before the age++ and rejects first. The power gate would reject too — with no
    // road anywhere the plant cannot reach this building.
    tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.abandoned).toBe(true);
    const ageWhileAbandoned = map.getBuildings().getBuilding(0)!.age;

    // Add road → recovery tick. The building flips abandoned:false in the sweep but is in
    // frozenThisTick, so it must NOT level-up on this same tick. It DOES age: the freeze
    // check sits after the age++ (World.ts), and road + power are both present here.
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.markPowerDirty();
    world.markLandValueDirty();
    tickOneGrowthInterval(world);
    const recoverB = map.getBuildings().getBuilding(0)!;
    expect(recoverB.abandoned).toBe(false);
    expect(recoverB.age).toBe(ageWhileAbandoned + 1); // aging is not a growth mutation
    expect(recoverB.level).toBe(2); // frozen this tick — no level-up

    // Next growth tick: no longer frozen, and still short of the cooldown → ages again.
    tickOneGrowthInterval(world);
    expect(map.getBuildings().getBuilding(0)!.age).toBe(ageWhileAbandoned + 2);
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

describe('World.tick() — congestion freezes growth, it never condemns', () => {
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
    // Modal 1x2 structureRect, extended AWAY from the road (opposite the frontage edge) so
    // the south/north access-node distance is unchanged: buildingCapacity = 1*2*level*5 =
    // 10*level, i.e. exactly `level * POPULATION_PER_LEVEL` — the identity every worker,
    // job and crossing-load figure below is written in.
    const lotY = frontage === 'S' ? y - 1 : y;
    const added = world.getMap().getBuildings().addExistingBuilding({
      id,
      type,
      footprint: [{ x, y: lotY }, { x, y: lotY + 1 }],
      anchor: { x, y: lotY },
      level,
      density: 0,
      age: 0,
      abandoned: false,
      frontage,
      structureRect: { x, y: lotY, w: 1, h: 2 },
    });
    expect(added).toBe(true);
  }

  // Corridor fixture with an EMPLOYED probe: ONE road row (y=2) across a 48×6 world, a short
  // block of residential feeders far WEST, the whole job block far EAST, and the L2 probe
  // alone in the middle. Jobs exactly equal workers, so the probe's OWN commuters are part of
  // the jam that suppresses its OWN anchor — which is what closes the loop this test exists
  // to pin shut: abandon the probe → its trips vanish → the byte over its anchor drops → the
  // anchor recovers → re-occupy → the trips come back → abandon again.
  //
  // Arithmetic, all derived from source:
  //   - Land value at the probe ANCHOR is ROAD proximity ONLY: no stations, no parks, and no
  //     zone tiles anywhere, so the diversity, service and park terms are all 0. A south-
  //     fronted modal lot spans y ∈ {0,1} with its anchor at (PROBE_X, 0) — the far corner
  //     from the road at y=2 — so the anchor sits at Chebyshev distance 2, NOT at the frontage
  //     cell's distance 1. Hence ROAD_WEIGHT · (1 − 2/(ROAD_RADIUS+1)) = 0.40 · 5/7 ≈ 0.28571
  //     (LandValueMap.ts), clearing LEVEL_THRESHOLDS[2] = 0.25 with only 0.03571 of margin.
  //   - Workers: RES_COLUMNS · 2 modal L1 buildings · 10 = 120, plus the L2 probe's own
  //     1·2·2·5 = 20. Jobs: COM_COLUMNS · 2 · 10 = 140 — exactly those 140 workers, so nobody
  //     is unemployed and the probe's 20 commuters really are out on the road.
  //   - Job capacity is consumed in ascending access-node order (laborMarket.ts) and every
  //     feeder node (x = RES_X0..RES_X0+5) sorts below the probe's (PROBE_X), so the feeders
  //     fill job nodes x=27..32 and the probe is left the farthest one, x=33. Every one of the
  //     140 trips therefore crosses the corridor just east of the probe: load at (25,2) = 140
  //     → byte round(255 · 140 / TRAFFIC_CAPACITY) = round(71.4) = 71, well inside the 255
  //     clamp so the byte still measures the load.
  //   - Penalty at the anchor = CONGESTION_PENALTY_MAX(0.20) · (71/255) · 5/7 ≈ 0.03978. The
  //     strongest weighted road contribution is the Chebyshev-2 stretch x=24..26, all at byte
  //     71 (max, not sum — LandValueMap.ts). 0.03978 exceeds the 0.03571 margin, so the
  //     CONGESTED anchor reads ≈ 0.24594 < 0.25 while the UNCONGESTED one still reads 0.28571.
  //   - Take the probe's own 20 trips off the road and those same tiles carry 120 → byte 61 →
  //     penalty ≈ 0.03417, which no longer exceeds the margin: the congested anchor climbs
  //     back to ≈ 0.25154 ≥ 0.25. Those two lines ARE the oscillation — byte 71 condemns, byte
  //     61 pardons, and the condemnation is what produces byte 61.
  //   - The feeders are all level 1 and maxSupportedLevel floors at 1 (zoneGrowth.ts), so the
  //     load SOURCE can never abandon itself and the jam never self-clears.
  //   - No power plant and no zoning, deliberately: with no zone tile the growth loop's spawn
  //     and per-building branches never run at all, and the merge pass is blocked by its
  //     isBuildingPowered gate. The probe cannot age, grow or merge, so the sweep is the only
  //     thing in this fixture that can move and the arithmetic stays road-proximity-only.
  const WORLD_W = 48;
  const WORLD_H = 6;
  const RES_X0 = 2;
  const RES_COLUMNS = 6;
  const COM_X0 = 27;
  const COM_COLUMNS = 7;
  const PROBE_X = 24;
  const FEEDER_WORKERS = 2 * RES_COLUMNS * POPULATION_PER_LEVEL; // 12 modal L1 buildings
  const PROBE_WORKERS = 2 * POPULATION_PER_LEVEL;                // the single modal L2 probe
  const JOBS = 2 * COM_COLUMNS * POPULATION_PER_LEVEL;           // 14 modal L1 buildings
  const CROSSING_BYTE = Math.round((255 * (FEEDER_WORKERS + PROBE_WORKERS)) / TRAFFIC_CAPACITY);
  const TOTAL_POPULATION = FEEDER_WORKERS + PROBE_WORKERS + JOBS;

  /** Seed the fixture above. Returns the probe id and the feeder ids in creation order. */
  function buildEmployedProbeCorridor(): { world: World; probeId: number; feederIds: number[] } {
    const world = new World(WORLD_W, WORLD_H, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < WORLD_W; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));

    let nextId = 0;
    const feederIds: number[] = [];
    for (let x = RES_X0; x < RES_X0 + RES_COLUMNS; x++) {
      feederIds.push(nextId);
      addUnitBuilding(world, nextId++, x, 1, 'residential', 1, 'S');
      feederIds.push(nextId);
      addUnitBuilding(world, nextId++, x, 3, 'residential', 1, 'N');
    }
    for (let x = COM_X0; x < COM_X0 + COM_COLUMNS; x++) {
      addUnitBuilding(world, nextId++, x, 1, 'commercial', 1, 'S');
      addUnitBuilding(world, nextId++, x, 3, 'commercial', 1, 'N');
    }
    const probeId = nextId;
    addUnitBuilding(world, probeId, PROBE_X, 1, 'residential', 2, 'S');
    return { world, probeId, feederIds };
  }

  /** Every tile's congestion-free land value, row-major — the sweep's whole input surface. */
  function snapshotUncongested(world: World): number[] {
    const lv = world.getLandValue();
    const out: number[] = [];
    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) out.push(lv.getUncongestedValue(x, y));
    }
    return out;
  }

  it('an employed L2 probe whose own commuters jam its anchor is never abandoned', () => {
    // Jobs exactly absorb the workers — the premise the whole fixture rests on.
    expect(JOBS).toBe(FEEDER_WORKERS + PROBE_WORKERS);

    const { world, probeId } = buildEmployedProbeCorridor();
    const buildings = world.getMap().getBuildings();
    // The sweep gates on the ANCHOR, and a south-fronted modal lot anchors on the far side
    // from the road, so every land-value assertion reads this coordinate — never the
    // frontage cell (PROBE_X, 1), which is a different Chebyshev distance.
    const probeAnchor = buildings.getBuilding(probeId)!.anchor;

    // Preconditions, ALL read before the first tick. Traffic, labor and demand all drain on
    // read, so once a sweep has flipped the probe every one of them reports the flipped
    // city — this is the only moment the loop's starting state is observable. Land value is
    // the exception that needs the opposite handling: it does NOT drain on read, so force it.
    world.markLaborDirty(); // labor → traffic → land value cascade
    world.recomputeLandValueIfDirty();

    expect(world.getLaborMarket().getUnemployed()).toBe(0);
    expect(world.getTrafficMap().getCongestion(25, 2)).toBe(CROSSING_BYTE);
    expect(CROSSING_BYTE).toBeLessThan(255); // un-clamped: the byte still measures the load
    const lv = world.getLandValue();
    // The gap between these two lines is the whole defect: the growth input says "too
    // congested to be a level 2 here", the verdict input says "this land supports a level 2".
    expect(lv.getUncongestedValue(probeAnchor.x, probeAnchor.y)).toBeGreaterThanOrEqual(LEVEL_THRESHOLDS[2]);
    expect(lv.getValue(probeAnchor.x, probeAnchor.y)).toBeLessThan(LEVEL_THRESHOLDS[2]);
    expect(world.getPopulation()).toBe(TOTAL_POPULATION);

    // Five consecutive growth intervals with nothing else in the fixture able to move.
    // While the sweep read the CONGESTED value these samples ran
    // [true, false, true, false, true] — abandon at byte 71, recover at byte 61, period 2 on
    // the growth interval, because the verdict deleted the commuters that caused it.
    const abandonedSamples: boolean[] = [];
    const populationSamples: number[] = [];
    for (let i = 0; i < 5; i++) {
      tickOneGrowthInterval(world);
      abandonedSamples.push(buildings.getBuilding(probeId)!.abandoned);
      populationSamples.push(world.getPopulation());
    }

    expect(abandonedSamples).toEqual([false, false, false, false, false]);
    expect(populationSamples).toEqual([
      TOTAL_POPULATION, TOTAL_POPULATION, TOTAL_POPULATION, TOTAL_POPULATION, TOTAL_POPULATION,
    ]);
  });

  it('acyclicity: flipping `abandoned` by hand moves congestion but not one bit of the uncongested value', () => {
    const { world, probeId, feederIds } = buildEmployedProbeCorridor();
    const buildings = world.getMap().getBuildings();

    world.markLaborDirty();
    world.recomputeLandValueIfDirty();
    const before = snapshotUncongested(world);
    const populationBefore = world.getPopulation();
    const employedBefore = world.getLaborMarket().getEmployed();
    const congestionBefore = world.getTrafficMap().getCongestion(25, 2);
    expect(populationBefore).toBe(TOTAL_POPULATION);
    expect(employedBefore).toBe(FEEDER_WORKERS + PROBE_WORKERS);
    expect(congestionBefore).toBe(CROSSING_BYTE);

    // Simulate the sweep's OUTPUT by hand — there is deliberately no tick() in this test, so
    // the sweep never runs and what is under test is the downstream half of the loop alone:
    // set the flag on the probe and on one feeder per column (the even entries are each
    // column's y=1 building), then re-resolve labor → traffic → land value directly. The
    // sweep's own reading of that chain is covered by the regression test above.
    buildings.getBuilding(probeId)!.abandoned = true;
    for (let i = 0; i < feederIds.length; i += 2) {
      buildings.getBuilding(feederIds[i])!.abandoned = true;
    }
    world.markLaborDirty();
    world.recomputeLandValueIfDirty();

    // One feeder per column is gone along with the probe. The RES_COLUMNS survivors (10
    // workers each) are still absorbed by the 140 jobs, so employment is exactly that
    // surviving headcount and their 6 flows all still cross (25,2).
    const LOST_FEEDER_WORKERS = RES_COLUMNS * POPULATION_PER_LEVEL;
    const SURVIVING_WORKERS = FEEDER_WORKERS - LOST_FEEDER_WORKERS;
    const populationAfter = world.getPopulation();
    const employedAfter = world.getLaborMarket().getEmployed();
    const congestionAfter = world.getTrafficMap().getCongestion(25, 2);
    expect(populationAfter).toBe(TOTAL_POPULATION - PROBE_WORKERS - LOST_FEEDER_WORKERS);
    expect(employedAfter).toBe(SURVIVING_WORKERS);
    expect(congestionAfter).toBe(Math.round((255 * SURVIVING_WORKERS) / TRAFFIC_CAPACITY));
    // Pinned as CHANGES too, not just as values: if a future constant made the two sides
    // coincide, the invariant below would hold vacuously and this test would stop testing.
    expect(populationAfter).not.toBe(populationBefore);
    expect(employedAfter).not.toBe(employedBefore);
    expect(congestionAfter).not.toBe(congestionBefore);

    // Every one of those numbers moved, and the sweep's input did not move at all. `abandoned`
    // reaches land value ONLY through the congestion term, so removing that term makes the
    // verdict independent of its own past verdicts. toBe, not toBeCloseTo: the guarantee is
    // bit-identity, which is why the value has its own Float32Array (LandValueMap.ts).
    const after = snapshotUncongested(world);
    expect(after.length).toBe(before.length);
    // Report the offending TILE, not just a bare pair of floats: a row-major index alone
    // gives a reader nothing to go on across 288 cells.
    const drifted = after.findIndex((v, i) => v !== before[i]);
    expect(drifted === -1 ? null : {
      x: drifted % WORLD_W,
      y: Math.floor(drifted / WORLD_W),
      before: before[drifted],
      after: after[drifted],
    }).toBeNull();
  });
});
