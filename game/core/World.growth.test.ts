import { describe, it, expect } from 'vitest';
import {
  World,
  ZONE_GROWTH_INTERVAL,
  ZONE_MAX_LEVEL,
  DENSITY_COOLDOWN_INTERVALS,
} from './World';
import { GROWTH_COOLDOWN_INTERVALS, LEVEL_THRESHOLDS, POPULATION_PER_LEVEL } from './growthConstants';
import { DENSITY_DEMAND_THRESHOLD } from './Demand';
import { TRAFFIC_CAPACITY } from './trafficAssignment';
import { TileType, createTile } from './Tile';
import type { Frontage } from './buildingFootprint';
import { executeClick } from '../engine/CommandDispatcher';
import { Tool } from '../tools/Tool';
import { MERGE_LEVEL_THRESHOLD } from './mergePolicy';
import { buildingCapacity } from './buildingCapacity';
import { isAnchorCovered } from './ServiceCoverageMap';
import { isFireAnchorCovered } from './FireCoverageMap';
import { isHospitalAnchorCovered } from './HospitalCoverageMap';
import { isSchoolAnchorCovered } from './SchoolCoverageMap';

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

// Service coverage gates level-up (Task 5). A 2×2 police station seeds graded
// coverage along the road network; level-up fixtures that previously relied only
// on power+water now need a station whose coverage reaches the building anchor.
/** 2×2 footprint at (ax,ay); asserts every cell is GRASS before placing so a stray
 * station-on-zone reseed coord is caught (StructureMap only excludes structure-vs-structure). */
function station2x2(ax: number, ay: number): { x: number; y: number }[] {
  return [
    { x: ax, y: ay }, { x: ax + 1, y: ay },
    { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 },
  ];
}

function seedPolice(world: World, ax: number, ay: number): void {
  const footprint = station2x2(ax, ay);
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  const added = world.getStructureMap().addStructure({ type: 'police_station', anchor: { x: ax, y: ay }, footprint });
  expect(added).not.toBeNull();
  world.markServiceDirty();
  world.recomputeService();
}

function seedFire(world: World, ax: number, ay: number): void {
  const footprint = station2x2(ax, ay);
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  const added = world.getStructureMap().addStructure({ type: 'fire_station', anchor: { x: ax, y: ay }, footprint });
  expect(added).not.toBeNull();
  world.markFireDirty();
  world.recomputeFire();
}

function seedHospital(world: World, ax: number, ay: number): void {
  const footprint = station2x2(ax, ay);
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  const added = world.getStructureMap().addStructure({ type: 'hospital', anchor: { x: ax, y: ay }, footprint });
  expect(added).not.toBeNull();
  world.markHospitalDirty();
  world.recomputeHospital();
}

function seedSchool(world: World, ax: number, ay: number): void {
  const footprint = station2x2(ax, ay);
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  const added = world.getStructureMap().addStructure({ type: 'school', anchor: { x: ax, y: ay }, footprint });
  expect(added).not.toBeNull();
  world.markSchoolDirty();
  world.recomputeSchool();
}

/** Place a 1×1 park at (px,py) and refresh land value (parks feed land value as an additive boost). */
function seedPark(world: World, px: number, py: number): void {
  const added = world.getStructureMap().addStructure({ type: 'park', anchor: { x: px, y: py }, footprint: [{ x: px, y: py }] });
  expect(added).not.toBeNull();
  world.markLandValueDirty();
}

/** Fixed cluster anchors fully provisioned by seedServedCluster (R, C, I), see below. */
const SERVED_R = { x: 3, y: 1 };
const SERVED_C = { x: 4, y: 1 };
const SERVED_I = { x: 5, y: 1 };

/**
 * Fully provision a max-level test cluster: power, water, all four services, AND
 * high land value (lv ≈ 1.0 at every cluster anchor), so buildings seeded at
 * ZONE_MAX_LEVEL / level 4 are NOT flagged as abandoned by the abandonment sweep
 * (Task 4) — abandonment would otherwise freeze them and block the density/merge
 * behavior under test. Density/merge fixtures place their R/C/I at SERVED_R /
 * SERVED_C / SERVED_I (frontage 'S', road to the south at y=2) and leave all
 * gating to this single served layout.
 *
 * Layout on a ≥12×6 world: a road ROW at y=2; a power plant and water tower
 * hung off road spurs; all four 2×2 stations one row below the road (y=3); a
 * park at (3,0) directly north of the R anchor for the final land-value boost.
 * Recomputes power/water/coverage/land value before returning, and asserts the
 * cluster is powered, watered, covered, and supports level 5.
 */
function seedServedCluster(world: World): void {
  const map = world.getMap();
  const W = map.getWidth();
  // Cluster zone tiles — the growth loop only visits zone-typed tiles.
  map.setTile(SERVED_R.x, SERVED_R.y, createTile(SERVED_R.x, SERVED_R.y, TileType.ZONE_RESIDENTIAL));
  map.setTile(SERVED_C.x, SERVED_C.y, createTile(SERVED_C.x, SERVED_C.y, TileType.ZONE_COMMERCIAL));
  map.setTile(SERVED_I.x, SERVED_I.y, createTile(SERVED_I.x, SERVED_I.y, TileType.ZONE_INDUSTRIAL));
  // Road row beneath the cluster (cluster is frontage 'S' onto this road).
  for (let x = 0; x < W; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
  // Power: plant at (0,3)-(1,4); cell (0,3) adj road (0,2) → powers the road row.
  seedPower(world, 0, 3);
  // Water: road spur (W-1,1) up from the road row, tower at (W-1,0) feeding it,
  // so the watered road row reaches every cluster cell adjacent to it.
  map.setTile(W - 1, 1, createTile(W - 1, 1, TileType.ROAD));
  seedWater(world, W - 1, 0); // tower (W-1,0) adj road (W-1,1) → waters spur → road row
  // Four services adjacent to the road row → coverage chains to the cluster anchors.
  seedPolice(world, 7, 3);
  seedFire(world, 9, 3);
  seedHospital(world, 0, 0);
  seedSchool(world, 7, 0);
  // Park directly north of the R anchor for the additive land-value boost.
  seedPark(world, SERVED_R.x, 0);
  world.markLandValueDirty();
  world.recomputeLandValue();
  for (const a of [SERVED_R, SERVED_C, SERVED_I]) {
    expect(world.getLandValue().getValue(a.x, a.y)).toBeGreaterThanOrEqual(0.85);
  }
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
      abandoned: false,
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
      abandoned: false,
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
    // The max-level R and its level-4 C/I demand seeders sit on a fully served
    // cluster (power, water, four services, lv ≈ 1.0) so the abandonment sweep
    // (Task 4) does not flag any of them — leaving density the only variable.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);

    // Seed building at ZONE_MAX_LEVEL with age just under DENSITY_COOLDOWN_INTERVALS.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [SERVED_R],
      anchor: SERVED_R,
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_R.x, y: SERVED_R.y, w: 1, h: 1 },
    });
    // 80 reachable jobs against the max-level R's 50 workers → net 30 on a market of 100 →
    // ratio 0.30, a saturated residential bar, well clear of DENSITY_DEMAND_THRESHOLD.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [SERVED_C],
      anchor: SERVED_C,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [SERVED_I],
      anchor: SERVED_I,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_I.x, y: SERVED_I.y, w: 1, h: 1 },
    });
    world.markDemandDirty();

    let densityBumpResult: ReturnType<typeof world.tick> | null = null;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) {
      const result = world.tick();
      const b = map.getBuildings().getBuildingAt(SERVED_R.x, SERVED_R.y)!;
      if (b.density === 1 && densityBumpResult === null) {
        densityBumpResult = result;
        break;
      }
    }

    const b = map.getBuildings().getBuildingAt(SERVED_R.x, SERVED_R.y)!;
    expect(b.density).toBe(1);
    expect(b.level).toBe(ZONE_MAX_LEVEL);
  });

  it('density bump emits changedTiles with footprint coords and changedBuildingIds with building id', () => {
    // Fully served cluster so the abandonment sweep (Task 4) leaves the max-level
    // R and its level-4 C/I demand seeders alone; density is the only variable.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);

    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [SERVED_R],
      anchor: SERVED_R,
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_R.x, y: SERVED_R.y, w: 1, h: 1 },
    })!;
    // 80 reachable jobs against the max-level R's 50 workers → net 30 on a market of 100 →
    // ratio 0.30, a saturated residential bar, well clear of DENSITY_DEMAND_THRESHOLD.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [SERVED_C],
      anchor: SERVED_C,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [SERVED_I],
      anchor: SERVED_I,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_I.x, y: SERVED_I.y, w: 1, h: 1 },
    });
    world.markDemandDirty();

    let densityTickResult: ReturnType<typeof world.tick> | null = null;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) {
      const result = world.tick();
      const b = map.getBuildings().getBuildingAt(SERVED_R.x, SERVED_R.y)!;
      if (b.density === 1 && densityTickResult === null) {
        densityTickResult = result;
        break;
      }
    }

    expect(densityTickResult).not.toBeNull();
    expect(densityTickResult!.changedBuildingIds).toContain(building.id);
    expect(densityTickResult!.changedTiles).toContainEqual({ x: SERVED_R.x, y: SERVED_R.y });
    expect(densityTickResult!.changedTiles.length).toBeGreaterThanOrEqual(1);
  });

  it('missing school coverage blocks density even though every other gate stays open (not a land-value confound)', () => {
    // Identical setup to the served-cluster bump test above (its positive control) minus the
    // school station, which is the ONE variable that differs. `LandValueMap`'s service term
    // averages all four coverages, so dropping the school also lowers anchor land value — a
    // level-5 target below LEVEL_THRESHOLDS[ZONE_MAX_LEVEL] would be abandoned by the sweep and
    // never reach the density branch at all, passing "density stays 0" without ever exercising
    // isSchoolAnchorCovered. So the indirect (land-value) path is pinned CLOSED below, and the
    // direct (coverage) path is pinned OPEN, before crediting the missing-density result to the
    // coverage gate specifically.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);

    // Remove the school seeded by seedServedCluster at (7,0)-(8,1).
    const school = world.getStructureMap().getStructureAt(7, 0);
    expect(school?.type).toBe('school');
    expect(world.getStructureMap().removeStructure(school!.id)).toBe(true);
    world.markSchoolDirty();
    world.recomputeSchool();
    world.markLandValueDirty();
    world.recomputeLandValue();

    // Close the indirect path: anchor land value must still clear the density threshold
    // (independent of services — a park feeds the additive park term) or the abandonment
    // sweep would freeze the target for an unrelated reason.
    if (world.getLandValue().getValue(SERVED_R.x, SERVED_R.y) < LEVEL_THRESHOLDS[ZONE_MAX_LEVEL]) {
      seedPark(world, SERVED_R.x, 1);
      world.markLandValueDirty();
      world.recomputeLandValue();
    }
    expect(world.getLandValue().getValue(SERVED_R.x, SERVED_R.y)).toBeGreaterThanOrEqual(LEVEL_THRESHOLDS[ZONE_MAX_LEVEL]);

    // Open the direct path: school coverage is gone, the other three anchors still hold, and
    // the target is watered (all pre-existing gates stay satisfied so only school discriminates).
    expect(world.getSchoolCoverageMap().getCoverage(SERVED_R.x, SERVED_R.y)).toBeLessThan(1);
    expect(isSchoolAnchorCovered(SERVED_R, world.getSchoolCoverageMap())).toBe(false);
    expect(isAnchorCovered(SERVED_R, world.getServiceCoverageMap())).toBe(true);
    expect(isFireAnchorCovered(SERVED_R, world.getFireCoverageMap())).toBe(true);
    expect(isHospitalAnchorCovered(SERVED_R, world.getHospitalCoverageMap())).toBe(true);

    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [SERVED_R],
      anchor: SERVED_R,
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_R.x, y: SERVED_R.y, w: 1, h: 1 },
    });
    // Same C/I demand seeders as the positive control: 80 reachable jobs against the
    // max-level R's 50 workers keeps residential demand well clear of the threshold.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [SERVED_C],
      anchor: SERVED_C,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [SERVED_I],
      anchor: SERVED_I,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_I.x, y: SERVED_I.y, w: 1, h: 1 },
    });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) {
      world.tick();
      const b = map.getBuildings().getBuildingAt(SERVED_R.x, SERVED_R.y)!;
      // Pin the indirect path closed on every sample, not just at the end: the target must
      // never be swept into abandonment (which would silently starve the density branch too).
      expect(b.abandoned).toBe(false);
      expect(b.density).toBe(0);
    }
  });

  it('density bump is a real capacity actuator (ribbon, 1x1 sr): target steps 25 -> 35, and the citywide population step matches once C/I are pinned unchanged', () => {
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);

    map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential', footprint: [SERVED_R], anchor: SERVED_R,
      level: ZONE_MAX_LEVEL, density: 0, age: DENSITY_COOLDOWN_INTERVALS, abandoned: false, frontage: 'S',
      structureRect: { x: SERVED_R.x, y: SERVED_R.y, w: 1, h: 1 },
    });
    // Level-4, age-0 C/I seeders: same fixture as the served-cluster bump test above, tuned so
    // residential demand clears DENSITY_DEMAND_THRESHOLD while the seeders themselves stay too
    // young this pass to reach their own DENSITY_COOLDOWN_INTERVALS or level up further.
    map.getBuildings().addExistingBuilding({ id: 1, type: 'commercial', footprint: [SERVED_C], anchor: SERVED_C, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [SERVED_I], anchor: SERVED_I, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_I.x, y: SERVED_I.y, w: 1, h: 1 } });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    expect(buildingCapacity(map.getBuildings().getBuilding(0)!)).toBe(25); // 1*1*5*5
    // `getBuilding` returns the STORED object and `World.tick` mutates it in place, so a bare
    // `const cBefore = map.getBuildings().getBuilding(1)!` would alias the post-tick object —
    // every "pinned unchanged" assertion below would compare a value to itself. Snapshot the
    // primitive fields plus a cloned structureRect instead.
    const b1 = map.getBuildings().getBuilding(1)!;
    const b2 = map.getBuildings().getBuilding(2)!;
    const cBefore = { level: b1.level, density: b1.density, structureRect: { ...b1.structureRect } };
    const iBefore = { level: b2.level, density: b2.density, structureRect: { ...b2.structureRect } };
    const popBefore = world.getPopulation();

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const target = map.getBuildings().getBuilding(0)!;
    expect(target.density).toBe(1);
    expect(buildingCapacity(target)).toBe(35); // 1*1*5*7

    // Grade the target above; only credit the citywide delta to it once the C/I seeders are
    // pinned identical (level/density/structureRect) — they legitimately could have grown too.
    const cAfter = map.getBuildings().getBuilding(1)!;
    const iAfter = map.getBuildings().getBuilding(2)!;
    expect(cAfter.level).toBe(cBefore.level);
    expect(cAfter.density).toBe(cBefore.density);
    expect(cAfter.structureRect).toEqual(cBefore.structureRect);
    expect(iAfter.level).toBe(iBefore.level);
    expect(iAfter.density).toBe(iBefore.density);
    expect(iAfter.structureRect).toEqual(iBefore.structureRect);

    expect(world.getPopulation()).toBe(popBefore + 10);
  });

  it('density bump is a real capacity actuator (modal, area-2 sr): target steps 50 -> 70, and the citywide population step matches once C/I are pinned unchanged', () => {
    // Structure AREA drives capacity, not the w x h split, so a 2-wide x 1-deep sr is the same
    // "modal area-2" case as a 1-wide x 2-deep one. This orientation is chosen deliberately: a
    // depth-2 (1x2) lot's anchor is the far corner from the frontage edge, one row farther from
    // the road, which costs enough road-proximity land value in this synthetic cluster to drop
    // the anchor below LEVEL_THRESHOLDS[ZONE_MAX_LEVEL] and get the level-5 target swept into
    // abandonment before density is ever reached (verified while building this fixture). A
    // 2-wide x 1-deep lot keeps both cells on the road-adjacent row, so land value is unaffected
    // — same area, same buildingCapacity arithmetic.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(6, 1, createTile(6, 1, TileType.ZONE_INDUSTRIAL));
    world.markLandValueDirty();
    world.recomputeLandValue();

    map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential', footprint: [{ x: 2, y: 1 }, { x: 3, y: 1 }], anchor: { x: 2, y: 1 },
      level: ZONE_MAX_LEVEL, density: 0, age: DENSITY_COOLDOWN_INTERVALS, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 1, w: 2, h: 1 },
    });
    // A doubled residential worker count (area 2, not 1) needs a doubled job surplus to clear
    // DENSITY_DEMAND_THRESHOLD: level 5 C at the known-served SERVED_C anchor plus a 2-wide I lot
    // reusing the already-served (6,1) tile, both aged 0 so neither reaches its own density
    // cooldown or abandons in this single pass.
    map.getBuildings().addExistingBuilding({ id: 1, type: 'commercial', footprint: [SERVED_C], anchor: SERVED_C, level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'industrial', footprint: [{ x: 5, y: 1 }, { x: 6, y: 1 }], anchor: { x: 5, y: 1 },
      level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 5, y: 1, w: 2, h: 1 },
    });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    expect(buildingCapacity(map.getBuildings().getBuilding(0)!)).toBe(50); // 2*1*5*5
    // See the ribbon actuator test above: `getBuilding` returns the stored, in-place-mutated
    // object, so a bare reference would self-compare. Snapshot instead.
    const b1 = map.getBuildings().getBuilding(1)!;
    const b2 = map.getBuildings().getBuilding(2)!;
    const cBefore = { level: b1.level, density: b1.density, structureRect: { ...b1.structureRect } };
    const iBefore = { level: b2.level, density: b2.density, structureRect: { ...b2.structureRect } };
    const popBefore = world.getPopulation();

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const target = map.getBuildings().getBuilding(0)!;
    expect(target.density).toBe(1);
    expect(buildingCapacity(target)).toBe(70); // 2*1*5*7

    const cAfter = map.getBuildings().getBuilding(1)!;
    const iAfter = map.getBuildings().getBuilding(2)!;
    expect(cAfter.level).toBe(cBefore.level);
    expect(cAfter.density).toBe(cBefore.density);
    expect(cAfter.structureRect).toEqual(cBefore.structureRect);
    expect(iAfter.level).toBe(iBefore.level);
    expect(iAfter.density).toBe(iBefore.density);
    expect(iAfter.structureRect).toEqual(iBefore.structureRect);

    expect(world.getPopulation()).toBe(popBefore + 20);
  });

  it('1-wide lot never bumps past tier 1 (width cap, not a closed demand/abandonment gate)', () => {
    // Clone of the ribbon actuator fixture above, but the target already sits at density 1 —
    // the negative control for the lot-width density cap. A density-1 target supplies
    // 1*1*5*7 = 35 workers (up from the 0-density actuator's 25), so the level-4 C/I seeders
    // there no longer clear DENSITY_DEMAND_THRESHOLD; retuned to level 5 (max, still 1x1 — the
    // served cluster already supports level 5 at 1x1, as the modal fixture's own C seeder
    // proves) to restore the vacancy surplus.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);

    map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential', footprint: [SERVED_R], anchor: SERVED_R,
      level: ZONE_MAX_LEVEL, density: 1, age: DENSITY_COOLDOWN_INTERVALS, abandoned: false, frontage: 'S',
      structureRect: { x: SERVED_R.x, y: SERVED_R.y, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'commercial', footprint: [SERVED_C], anchor: SERVED_C, level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [SERVED_I], anchor: SERVED_I, level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_I.x, y: SERVED_I.y, w: 1, h: 1 } });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    const ageBefore = map.getBuildings().getBuilding(0)!.age;

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 2; i++) {
      world.tick();
      const b = map.getBuildings().getBuilding(0)!;
      // Pin every other gate open on every sample: without this, "density stays 1" could pass
      // for a silently-closed demand/abandonment gate rather than the width cap.
      expect(b.abandoned).toBe(false);
      expect(b.density).toBe(1);
    }

    // The branch was actually visited (aging happened) across the run, not skipped entirely.
    expect(map.getBuildings().getBuilding(0)!.age).toBeGreaterThan(ageBefore);
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);
  });

  it('2-wide lot reaches tier 2 (positive control): target steps 70 -> 100, and the citywide population step matches once C/I are pinned unchanged', () => {
    // Clone of the modal actuator fixture's 2-wide x 1-deep lot above, but the target already
    // sits at density 1 (buildingCapacity 70) — the width variable's positive control, and proof
    // an assembled lot actually reaches the top tier the ribbon negative above is capped out of.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(6, 1, createTile(6, 1, TileType.ZONE_INDUSTRIAL));
    world.markLandValueDirty();
    world.recomputeLandValue();

    map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential', footprint: [{ x: 2, y: 1 }, { x: 3, y: 1 }], anchor: { x: 2, y: 1 },
      level: ZONE_MAX_LEVEL, density: 1, age: DENSITY_COOLDOWN_INTERVALS, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 1, w: 2, h: 1 },
    });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'commercial', footprint: [SERVED_C], anchor: SERVED_C, level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'industrial', footprint: [{ x: 5, y: 1 }, { x: 6, y: 1 }], anchor: { x: 5, y: 1 },
      level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 5, y: 1, w: 2, h: 1 },
    });
    // Density-1 target now supplies 2*1*5*7 = 70 workers (up from the 0-density actuator's 50),
    // so the original two C/I seeders (75 jobs total) no longer clear the surplus needed for
    // DENSITY_DEMAND_THRESHOLD; a third, small (level 2) industrial seeder restores it. Its tile
    // is zoned to match its type (an unzoned footprint is an impossible persisted/gameplay state),
    // but it still never grows across the single growth pass below: age starts at 0 and the
    // shared growth-gate cooldown is GROWTH_COOLDOWN_INTERVALS(8) + stagger(id), so one tick's
    // age += 1 (age 1) can never clear it — the ordinary cooldown gate keeps it stationary, not
    // its zoning.
    map.setTile(9, 1, createTile(9, 1, TileType.ZONE_INDUSTRIAL));
    map.getBuildings().addExistingBuilding({
      id: 3, type: 'industrial', footprint: [{ x: 9, y: 1 }], anchor: { x: 9, y: 1 },
      level: 2, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 9, y: 1, w: 1, h: 1 },
    });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    expect(buildingCapacity(map.getBuildings().getBuilding(0)!)).toBe(70); // 2*1*5*7
    const b1 = map.getBuildings().getBuilding(1)!;
    const b2 = map.getBuildings().getBuilding(2)!;
    const b3 = map.getBuildings().getBuilding(3)!;
    const cBefore = { level: b1.level, density: b1.density, structureRect: { ...b1.structureRect } };
    const iBefore = { level: b2.level, density: b2.density, structureRect: { ...b2.structureRect } };
    const i2Before = { level: b3.level, density: b3.density, structureRect: { ...b3.structureRect } };
    const popBefore = world.getPopulation();

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const target = map.getBuildings().getBuilding(0)!;
    expect(target.density).toBe(2);
    expect(buildingCapacity(target)).toBe(100); // 2*1*5*10

    const cAfter = map.getBuildings().getBuilding(1)!;
    const iAfter = map.getBuildings().getBuilding(2)!;
    const i2After = map.getBuildings().getBuilding(3)!;
    expect(cAfter.level).toBe(cBefore.level);
    expect(cAfter.density).toBe(cBefore.density);
    expect(cAfter.structureRect).toEqual(cBefore.structureRect);
    expect(iAfter.level).toBe(iBefore.level);
    expect(iAfter.density).toBe(iBefore.density);
    expect(iAfter.structureRect).toEqual(iBefore.structureRect);
    expect(i2After.level).toBe(i2Before.level);
    expect(i2After.density).toBe(i2Before.density);
    expect(i2After.structureRect).toEqual(i2Before.structureRect);

    expect(world.getPopulation()).toBe(popBefore + 30);
  });

  it('adjacent 1-wide neighbors on staggered growth histories converge at density 1, then merge', () => {
    // The central merge-race hypothesis: before the lot-width cap, the first 1-wide lot to reach
    // ZONE_MAX_LEVEL could keep densifying (density 0 -> 1 -> 2) on its own 24-tick cooldown while
    // an adjacent, later-starting 1-wide lot was still leveling up — and canMerge's equal-density
    // gate then blocked them forever once the trailing lot finally caught up at density 0/1. This
    // pins that the cap now closes that race: both grow from level 1 through natural ticks (no
    // hand-placed max-level shortcut) with STAGGERED starting ages so they reach ZONE_MAX_LEVEL at
    // different times, and the assertion inside the loop below fails loudly the instant either one
    // is ever observed above density 1 while still unmerged.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(6, 1, createTile(6, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(9, 1, createTile(9, 1, TileType.ZONE_INDUSTRIAL));
    world.markLandValueDirty();
    world.recomputeLandValue();

    // A (id 0) starts one full GROWTH_COOLDOWN_INTERVALS ahead of B (id 1) — a growth-tick head
    // start, not a shortcut to a higher level, so both climb the SAME level-1..5 ladder on their
    // own clock. Single-cell footprints (matching SERVED_R/C/I elsewhere in this file) keep the lot
    // depth at 1 so there is no structure-grow phase to model — every growth tick is a level-up or
    // (once at ZONE_MAX_LEVEL) a density bump, exactly the branch this cap gates.
    map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential', footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 },
      level: 1, density: 0, age: GROWTH_COOLDOWN_INTERVALS, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential', footprint: [{ x: 3, y: 1 }], anchor: { x: 3, y: 1 },
      level: 1, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 3, y: 1, w: 1, h: 1 },
    });
    // Static job bank — same 85-job total (25 + 50 + 10) already verified by the positive-control
    // test above to keep residential demand >= DENSITY_DEMAND_THRESHOLD at the pair's combined
    // level-5/density-1 ceiling (capacity 70, same arithmetic as that test's target).
    map.getBuildings().addExistingBuilding({ id: 2, type: 'commercial', footprint: [SERVED_C], anchor: SERVED_C, level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({
      id: 3, type: 'industrial', footprint: [{ x: 5, y: 1 }, { x: 6, y: 1 }], anchor: { x: 5, y: 1 },
      level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 5, y: 1, w: 2, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: 4, type: 'industrial', footprint: [{ x: 9, y: 1 }], anchor: { x: 9, y: 1 },
      level: 2, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 9, y: 1, w: 1, h: 1 },
    });

    let sawBothAtDensity1 = false;
    let mergedId: number | null = null;
    // Generous upper bound: worst-case per building is 4 level-ups at up to
    // GROWTH_COOLDOWN_INTERVALS(8) + stagger(id ≤ 6) growth-ticks each, plus
    // DENSITY_COOLDOWN_INTERVALS(24) to first density-bump, plus another cooldown before merge
    // eligibility — comfortably under 150 growth-ticks even for the trailing building.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 300 && mergedId === null; i++) {
      world.tick();
      // Fresh snapshot each tick — never retain a live Building reference across a world.tick()
      // call, since getBuildingAt returns the object the next tick mutates in place.
      const a = map.getBuildings().getBuildingAt(2, 1);
      const b = map.getBuildings().getBuildingAt(3, 1);
      if (a === null || b === null) throw new Error('building unexpectedly removed without merging');
      if (a.id === b.id) {
        mergedId = a.id;
        break;
      }
      // The property under test: neither lot is ever observed above the 1-wide density cap while
      // still unmerged, regardless of which one reached ZONE_MAX_LEVEL first.
      expect(a.density).toBeLessThanOrEqual(1);
      expect(b.density).toBeLessThanOrEqual(1);
      if (a.density === 1 && b.density === 1) sawBothAtDensity1 = true;
    }

    // They actually converged at density 1 before merging — not merged by coincidence at density 0.
    expect(sawBothAtDensity1).toBe(true);
    expect(mergedId).not.toBeNull();

    const merged = map.getBuildings().getBuilding(mergedId!)!;
    expect(merged.level).toBe(ZONE_MAX_LEVEL);
    expect(merged.density).toBe(1);
    expect(merged.footprint).toHaveLength(2);
    expect(merged.structureRect).toEqual({ x: 2, y: 1, w: 2, h: 1 });
    expect(buildingCapacity(merged)).toBe(70); // conserved: 1*5*7 + 1*5*7
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
      abandoned: false,
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
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Positive control: with road, water, AND coverage, building should level up.
    // Decision-A: add isolated road (0,1) + tower (0,2)-(1,3). Zone (0,0) adj to watered road (0,1) → watered.
    // LV >= LEVEL_THRESHOLDS[1]=0.1 satisfied by road at distance 1 (roadScore≈0.857).
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD)); // isolated road for water routing
    seedWater(world, 0, 2); // tower at (0,2); adj road (0,1) → waters (0,1); zone (0,0) adj → watered
    // Task 5: service coverage gates level-up. Road spur (3,0),(3,1); station (4,0)-(5,1); cell
    // (4,0) adj road (3,0). Road (1,0)-(2,0)-(3,0) chains coverage to anchor (0,0) at offDist 1.
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));
    map.setTile(3, 0, createTile(3, 0, TileType.ROAD));
    seedPolice(world, 4, 0); // station at (4,0)-(5,1); cell (4,0) adj road (3,0)
    // Fire ALSO gates level-up. Extend the network down a road spur (3,1),(3,2) into open
    // grass, then place the fire station (4,2)-(5,3); cell (4,2) adj road (3,2) on the network.
    map.setTile(3, 1, createTile(3, 1, TileType.ROAD));
    map.setTile(3, 2, createTile(3, 2, TileType.ROAD));
    seedFire(world, 4, 2);
    // Hospital ALSO gates level-up. Extend the spur two more cells (3,3),(3,4) into open grass,
    // then place the hospital (4,4)-(5,5); cell (4,4) adj road (3,4) on the network.
    map.setTile(3, 3, createTile(3, 3, TileType.ROAD));
    map.setTile(3, 4, createTile(3, 4, TileType.ROAD));
    seedHospital(world, 4, 4);
    // School ALSO gates level-up. Station (1,3)-(2,4); cell (2,3) adj road (3,3) on the network.
    seedSchool(world, 1, 3);
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      abandoned: false,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // Also need land value >= LEVEL_THRESHOLDS[1]=0.1; road at distance 1 should suffice.
    // Force land value recompute.
    world.markLandValueDirty();
    seedPower(world, 1, 1); // plant at (1,1)-(2,2); cell (1,1) adj road (1,0) → powers road row y=0
    expect(world.getServiceCoverageMap().getCoverage(0, 0)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 0)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 0)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 0)).toBeGreaterThan(0);
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
      abandoned: false,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    // No road → hasRoadAccess returns false → age does not increment → level stays 0.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world2.tick();
    expect(map2.getBuildings().getBuildingAt(0, 0)!.level).toBe(0);
  });

  it('existing building loses road access: density bump does not fire', () => {
    // Positive control: a fully served cluster (so abandonment leaves the max-level
    // R and its level-4 C/I seeders alone) lets density fire.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [SERVED_R],
      anchor: SERVED_R,
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS - 1,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_R.x, y: SERVED_R.y, w: 1, h: 1 },
    });
    // 80 reachable jobs against the max-level R's 50 workers → net 30 on a market of 100 →
    // ratio 0.30, a saturated residential bar, well clear of DENSITY_DEMAND_THRESHOLD.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [SERVED_C],
      anchor: SERVED_C,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [SERVED_I],
      anchor: SERVED_I,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_I.x, y: SERVED_I.y, w: 1, h: 1 },
    });
    world.markDemandDirty();
    world.markLandValueDirty();
    // Run enough ticks so density fires (positive control).
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world.tick();
    expect(map.getBuildings().getBuildingAt(SERVED_R.x, SERVED_R.y)!.density).toBeGreaterThanOrEqual(1);

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
      abandoned: false,
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
      abandoned: false,
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
    // Fully served cluster keeps the max-level R and its level-5 industrial demand
    // seeders out of abandonment so density bumps within one growth interval.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);

    map.getBuildings().addExistingBuilding({
      id: 0, type: 'residential', footprint: [SERVED_R], anchor: SERVED_R,
      level: ZONE_MAX_LEVEL, density: 0, age: DENSITY_COOLDOWN_INTERVALS, abandoned: false, frontage: 'S',
      structureRect: { x: SERVED_R.x, y: SERVED_R.y, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [SERVED_C], anchor: SERVED_C, level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [SERVED_I], anchor: SERVED_I, level: 5, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: SERVED_I.x, y: SERVED_I.y, w: 1, h: 1 } });

    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(SERVED_R.x, SERVED_R.y);
    expect(b).not.toBeNull();
    expect(b!.density).toBe(1);
  });
});

describe('World.getDemand() — freshness', () => {
  it('reset({ regenerate: false }) drops demand back to the empty-city reading', () => {
    // Three road-less level-4 R buildings, 1x1 sr: buildingCapacity(level 4) = 20 each = 60 total
    // workers, no jobs, market floored to MIN_MARKET(100), ratio -0.6 →
    // saturated workplace severity, and 100% unemployment damps migration to zero.
    // (Residential, not industrial: an industrial-only fixture reads residential 1.00 on BOTH
    // sides of the reset through the zero-workforce fallback, discriminating nothing.)
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({ id: 0, type: 'residential', footprint: [{ x: 1, y: 1 }], anchor: { x: 1, y: 1 }, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 1, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'residential', footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 }, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 2, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'residential', footprint: [{ x: 3, y: 1 }], anchor: { x: 3, y: 1 }, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 3, y: 1, w: 1, h: 1 } });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBe(0);
    expect(world.getDemand().industrial).toBe(0.5);

    world.reset({ regenerate: false });

    // Empty labor market → the bootstrap reading.
    expect(world.getDemand().residential).toBe(1);
    expect(world.getDemand().industrial).toBe(0);
  });

  it('reset({ regenerate: true }) drops demand back to the empty-city reading', () => {
    // Three road-less level-4 R buildings, 1x1 sr: buildingCapacity(level 4) = 20 each = 60 total
    // workers, no jobs, market floored to MIN_MARKET(100), ratio -0.6 →
    // saturated workplace severity, and 100% unemployment damps migration to zero.
    // (Residential, not industrial: an industrial-only fixture reads residential 1.00 on BOTH
    // sides of the reset through the zero-workforce fallback, discriminating nothing.)
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addExistingBuilding({ id: 0, type: 'residential', footprint: [{ x: 1, y: 1 }], anchor: { x: 1, y: 1 }, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 1, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 1, type: 'residential', footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 }, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 2, y: 1, w: 1, h: 1 } });
    map.getBuildings().addExistingBuilding({ id: 2, type: 'residential', footprint: [{ x: 3, y: 1 }], anchor: { x: 3, y: 1 }, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 3, y: 1, w: 1, h: 1 } });
    world.markDemandDirty();
    expect(world.getDemand().residential).toBe(0);
    expect(world.getDemand().industrial).toBe(0.5);

    world.reset({ regenerate: true });

    // Empty labor market → the bootstrap reading.
    expect(world.getDemand().residential).toBe(1);
    expect(world.getDemand().industrial).toBe(0);
  });

  it('CommandDispatcher bulldoze of a non-zero-level R building refreshes demand', () => {
    const world = new World(8, 8, { regenerate: false });
    const map = world.getMap();
    map.setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
    // Modal 1x2 structureRect so buildingCapacity(level 4) = 40, matching this fixture's
    // MIN_MARKET-era arithmetic exactly (road-less, so the extension direction is free).
    map.getBuildings().addExistingBuilding({ id: 0, type: 'residential', footprint: [{ x: 3, y: 3 }, { x: 3, y: 4 }], anchor: { x: 3, y: 3 }, level: 4, density: 0, age: 0, abandoned: false, frontage: 'S', structureRect: { x: 3, y: 3, w: 1, h: 2 } });

    world.markDemandDirty();
    // Road-less level-4 R: 40 workers against the 100-unit MIN_MARKET floor → ratio 0.40 →
    // saturated workplace severity, halved onto the industrial bar.
    expect(world.getDemand().industrial).toBe(0.5);

    const result = executeClick(Tool.BULLDOZE, { x: 3, y: 3 }, world);
    expect(result.removedBuildingIds).toContain(0);

    // The last R/C/I building is gone → the labor market is empty again.
    expect(world.getDemand().industrial).toBe(0);
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
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(b.density).toBe(0);
  });

  it('Fixture B: sufficient C/I level-points → residentialDemand >= threshold → density bumps to 1', () => {
    // Fully served cluster keeps the max-level R and level-4 C/I seeders out of
    // abandonment so residential demand stays high and density bumps.
    const world = new World(12, 6, { regenerate: false });
    const map = world.getMap();
    seedServedCluster(world);

    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [SERVED_R],
      anchor: SERVED_R,
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: DENSITY_COOLDOWN_INTERVALS,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_R.x, y: SERVED_R.y, w: 1, h: 1 },
    });
    // C+I level 4 each = 80 reachable jobs against the max-level R's 50 workers → 30 vacancies
    // on a market floored to MIN_MARKET → ratio 0.30, at SATURATION_RATE, so residential reads
    // exactly 1.0 — well clear of DENSITY_DEMAND_THRESHOLD.
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [SERVED_C],
      anchor: SERVED_C,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_C.x, y: SERVED_C.y, w: 1, h: 1 },
    });
    map.getBuildings().addBuilding({
      type: 'industrial',
      footprint: [SERVED_I],
      anchor: SERVED_I,
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: SERVED_I.x, y: SERVED_I.y, w: 1, h: 1 },
    });
    world.markDemandDirty();

    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(SERVED_R.x, SERVED_R.y)!;
    expect(b.density).toBe(1);
  });

  it("Fixture B': post-tick getDemand() reflects level-up totals vs control world that did not tick", () => {
    // World with a low-level R building near road, no C/I — tick until it levels up.
    // Decision-A: (0,1) is GRASS here, so add isolated road+tower without changing anything else.
    // Task 5: coverage gates level-up. Bump to 8×10 to fit police, fire, hospital, AND school
    // stations each on the road network with coverage reaching anchor (0,0).
    const world = new World(8, 10, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ROAD)); // isolated road for water routing
    map.setTile(1, 1, createTile(1, 1, TileType.ROAD)); // connects (1,0) down so coverage can be seeded
    // South road spur (1,2),(1,3) extends the network so police AND fire each get free adjacency.
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD));
    map.setTile(1, 3, createTile(1, 3, TileType.ROAD));
    // Left-edge road spur off (1,3) so the hospital AND school get free adjacency on the network.
    map.setTile(0, 3, createTile(0, 3, TileType.ROAD)); // adj road (1,3)
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD));
    map.setTile(0, 5, createTile(0, 5, TileType.ROAD));
    map.setTile(0, 6, createTile(0, 6, TileType.ROAD));
    // Extend the spur two more cells so the school gets free adjacency below the hospital.
    map.setTile(0, 7, createTile(0, 7, TileType.ROAD));
    map.setTile(0, 8, createTile(0, 8, TileType.ROAD));
    seedWater(world, 0, 2); // tower at (0,2); (0,2) adj road (0,1) → watered; zone (0,0) adj (0,1) → watered
    // Station (2,2)-(3,3); cell (2,2) adj road (1,2) → covers network → anchor (0,0) at offDist 1.
    seedPolice(world, 2, 2);
    // Fire ALSO gates level-up. Station (1,4)-(2,5); cell (1,4) adj road (1,3) → covers network → anchor (0,0).
    seedFire(world, 1, 4);
    // Hospital ALSO gates level-up. Station (1,6)-(2,7); cell (1,6) adj road (0,6) → covers network → anchor (0,0).
    seedHospital(world, 1, 6);
    // School ALSO gates level-up. Station (1,8)-(2,9); cell (1,8) adj road (0,8) → covers network → anchor (0,0).
    seedSchool(world, 1, 8);
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 10,
      abandoned: false,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });
    world.markLandValueDirty();
    seedPower(world, 2, 0); // plant at (2,0)-(3,1); cell (2,0) adj road (1,0) → powers road network
    expect(world.getServiceCoverageMap().getCoverage(0, 0)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(0, 0)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(0, 0)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(0, 0)).toBeGreaterThan(0);

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
      abandoned: false,
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

  // Keep residential demand positive: the probe's workers must see a reachable vacancy surplus.
  // The jobs only count if the source's FRONTAGE face lands on the probe's own road network —
  // reachableUnfilledJobs is summed over job nodes a residential BFS actually reaches. Pure
  // placement: the labor/demand preconditions belong at the END of each fixture, once every
  // building exists.
  function seedJobSource(world: World, x: number, y: number, frontage: Frontage, level: number): void {
    expect(world.getMap().getBuildings().addExistingBuilding({
      id: 999,
      type: 'commercial',
      footprint: [{ x, y }],
      anchor: { x, y },
      level,
      density: 0,
      age: 0,
      abandoned: false,
      frontage,
      structureRect: { x, y, w: 1, h: 1 },
    })).toBe(true);
  }

  /**
   * Assert the fixture actually supplies reachable jobs and an open residential gate.
   * Buildings seeded straight into the BuildingMap never mark the world dirty, so force the
   * same labor/demand refresh the growth pass performs before reading the snapshot it acts on.
   */
  function expectGrowthPreconditions(world: World): void {
    world.recomputeLabor();
    world.markDemandDirty();
    expect(world.getLaborMarket().getReachableUnfilledJobs()).toBeGreaterThan(0);
    expect(world.getDemand().residential).toBeGreaterThan(0);
  }

  it('structure-grow happens before level-up on a multi-cell lot', () => {
    // 1×4 R-zone lot: cells (1,0)..(1,3), frontage='S', road at (1,4).
    // structureRect = {x:1, y:3, w:1, h:1} — 1×1 at the south end.
    // Land value at anchor (1,0): road proximity (weight 0.40) plus the four services'
    // coverage (weight 0.50, all covering (1,0) here) clears LEVEL_THRESHOLDS[2]=0.25 comfortably.
    // Decision-A: bump to World(10,8); add road (0,4) + tower (0,5)-(1,6) to water road (1,4).
    const world = new World(10, 8, { regenerate: false });
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
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 1, y: 3, w: 1, h: 1 },
    });
    expect(building).toBe(true);
    // (0,3) fronts the road at (0,4): level 2 is supported by road frontage alone (lv ≈ 0.34 >
    // LEVEL_THRESHOLDS[2]) so the sweep never abandons it, and its 20 jobs against the level-1
    // probe's 10 workers give net 10 on a market floored to MIN_MARKET → residential 0.25.
    seedJobSource(world, 0, 3, 'S', 2);
    world.markLandValueDirty();
    seedPower(world, 2, 4); // plant at (2,4)–(3,5) powers road (1,4)
    seedWater(world, 0, 5); // tower at (0,5)–(1,6); (0,5) adj road (0,4) → waters (0,4)→(1,4); zone (1,3) adj (1,4) → watered
    // Task 5: coverage gates level-up/structure-grow at the anchor (1,0). The frontage road at y=4
    // is too far, so seed a top road ROW (x=2..9, y=0) and hang all four stations one row below.
    // Anchor (1,0) is off-road from road (2,0) at offDist 1 → covered by all four.
    for (let x = 2; x <= 9; x++) map.setTile(x, 0, createTile(x, 0, TileType.ROAD));
    seedPolice(world, 4, 1); // station (4,1)-(5,2); cell (4,1) adj road (4,0)
    // Fire ALSO gates level-up/structure-grow. Station (6,1)-(7,2); cell (6,1) adj road (6,0).
    seedFire(world, 6, 1);
    // Hospital ALSO gates level-up/structure-grow. Station (2,1)-(3,2); cell (2,1) adj road (2,0).
    seedHospital(world, 2, 1);
    // School ALSO gates level-up/structure-grow. Station (8,1)-(9,2); cell (8,1) adj road (8,0).
    seedSchool(world, 8, 1);
    expect(world.getServiceCoverageMap().getCoverage(1, 0)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(1, 0)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(1, 0)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(1, 0)).toBeGreaterThan(0);

    // Asserted LAST, once every road, structure and building is in place — an assertion inside a
    // seeding helper would read a labor market with no residential origins yet.
    expectGrowthPreconditions(world);

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
    //           structureRect stays at cap. The level stops at 2 because the test runs
    //           only GROWTH_COOLDOWN_INTERVALS more intervals after Grow 1 — the age
    //           cooldown (not land value) caps the level here. (Land value at the anchor
    //           now clears 0.45 thanks to the service term, but no further interval runs.)
    // Decision-A: bump to World(10,8), add road(0,4)+tower(0,5)-(1,6).
    const world = new World(10, 8, { regenerate: false });
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
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 1, y: 3, w: 1, h: 1 },
    });
    // Same reachable level-2 source as the fixture above (see there for the arithmetic).
    seedJobSource(world, 0, 3, 'S', 2);
    world.markLandValueDirty();
    seedPower(world, 2, 4); // plant at (2,4)–(3,5) powers road (1,4)
    seedWater(world, 0, 5); // tower at (0,5)–(1,6); (0,5) adj road (0,4) → waters (0,4)→(1,4) → zone (1,3) watered
    // Task 5: coverage gates level-up at the anchor (1,0). Top road ROW (x=2..9, y=0) with all four
    // stations one row below; anchor (1,0) off-road from road (2,0) at offDist 1 → covered by all four.
    for (let x = 2; x <= 9; x++) map.setTile(x, 0, createTile(x, 0, TileType.ROAD));
    seedPolice(world, 4, 1); // station (4,1)-(5,2); cell (4,1) adj road (4,0)
    // Fire ALSO gates level-up/structure-grow. Station (6,1)-(7,2); cell (6,1) adj road (6,0).
    seedFire(world, 6, 1);
    // Hospital ALSO gates level-up/structure-grow. Station (2,1)-(3,2); cell (2,1) adj road (2,0).
    seedHospital(world, 2, 1);
    // School ALSO gates level-up/structure-grow. Station (8,1)-(9,2); cell (8,1) adj road (8,0).
    seedSchool(world, 8, 1);
    expect(world.getServiceCoverageMap().getCoverage(1, 0)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(1, 0)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(1, 0)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(1, 0)).toBeGreaterThan(0);

    // Asserted LAST, once every road, structure and building is in place — an assertion inside a
    // seeding helper would read a labor market with no residential origins yet.
    expectGrowthPreconditions(world);

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
    // Decision-A: bump to World(6,6) with a road row y=2; add tower for water routing.
    // Task 5: coverage gates level-up — add a station adjacent to the road row so the anchor (1,1) is covered.
    // Zone (1,1) frontage S adj to road (1,2) on the row → powered, watered, and covered.
    const world = new World(7, 6, { regenerate: false });
    const map = world.getMap();

    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    for (let x = 0; x < 7; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD)); // road row y=2

    // id=0, stagger(0)=0, cooldown=8. age=7 → after +1 gate fires.
    // land value at (1,1): road at distance 1 (roadScore ≈ 0.857) plus the four services'
    // coverage (weight 0.50, all covering (1,1)) → lv well above LEVEL_THRESHOLDS[2]=0.25.
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 1,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    // (2,1) fronts the served road row at (2,2), whose land value (road + all four coverages,
    // lv ≈ 0.8) supports level 4; its 40 jobs saturate the bar against the probe's 10 workers.
    seedJobSource(world, 2, 1, 'S', 4);
    world.markLandValueDirty();
    seedPower(world, 2, 3); // plant at (2,3)-(3,4); (2,3) adj road (2,2) → powers road row
    seedWater(world, 4, 3); // tower at (4,3); (4,3) adj road (4,2) → waters road row → zone (1,1) watered
    seedPolice(world, 0, 3); // station at (0,3)-(1,4); (0,3) adj road (0,2) → covers road row → anchor (1,1) at offDist 1
    // Fire ALSO gates level-up. Station (3,0)-(4,1); cell (3,1) adj road (3,2) → covers road row → anchor (1,1).
    seedFire(world, 3, 0);
    // Hospital ALSO gates level-up. Station (5,3)-(6,4); cell (5,3) adj road (5,2) → covers road row → anchor (1,1).
    seedHospital(world, 5, 3);
    // School ALSO gates level-up. Station (5,0)-(6,1); cell (5,1) adj road (5,2) → covers road row → anchor (1,1).
    seedSchool(world, 5, 0);
    expect(world.getServiceCoverageMap().getCoverage(1, 1)).toBeGreaterThan(0);
    expect(world.getFireCoverageMap().getCoverage(1, 1)).toBeGreaterThan(0);
    expect(world.getHospitalCoverageMap().getCoverage(1, 1)).toBeGreaterThan(0);
    expect(world.getSchoolCoverageMap().getCoverage(1, 1)).toBeGreaterThan(0);

    // Asserted LAST, once every road, structure and building is in place — an assertion inside a
    // seeding helper would read a labor market with no residential origins yet.
    expectGrowthPreconditions(world);

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
// Task 4: reorder the growth branch so max-level structures can still grow
// ---------------------------------------------------------------------------

describe('World.tick() — max-level structure-grow reaches a merged lot\'s raised depth cap (Task 4)', () => {
  it('level-5 building on a 4-wide, 4-deep lot extends structureRect 4×2 → 4×3 → 4×4 across growth passes, never density-bumping in between', () => {
    // A second-generation (4-wide) merged lot: 4 wide (x=1..4), 4 deep (y=3..6), frontage
    // 'S'. Its depth cap is max(MIN_STRUCTURE_DEPTH_CAP=2, lot.w=4) = 4 — only reachable at
    // max level through Task 4's reorder (a first-generation 2-wide lot's cap would still be
    // max(2,2)=2, no gain).
    const world = new World(25, 13, { regenerate: false });
    const map = world.getMap();
    const sm = world.getStructureMap();

    for (let x = 1; x <= 4; x++) {
      for (let y = 3; y <= 6; y++) map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
    }
    // Frontage road immediately south of the lot.
    for (let x = 0; x < 25; x++) map.setTile(x, 7, createTile(x, 7, TileType.ROAD));
    // A SEPARATE coverage-only road row directly above the anchor's row (y=2), disconnected
    // from the frontage road. Off-road decay is Chebyshev/hop distance, not frontage-bound, so
    // this alone gives the anchor a road tile at distance 1 and lets stations hung above it
    // reach the anchor at offDist 1 — needed because the anchor sits 4 rows from the frontage
    // road, well outside OFF_ROAD_RADIUS_TILES=2.
    for (let x = 0; x < 25; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));

    // Park directly above the anchor (Chebyshev distance 1): LEVEL_THRESHOLDS[5]=0.85 is far
    // above what road + service alone reliably clears once commute congestion trims a little
    // back off, so the additive park boost supplies the margin.
    expect(sm.addStructure({ type: 'park', anchor: { x: 1, y: 1 }, footprint: [{ x: 1, y: 1 }] })).not.toBeNull();

    // Four stations hung above the coverage road row, close to the anchor's column.
    seedPolice(world, 3, 0);
    seedFire(world, 5, 0);
    seedHospital(world, 7, 0);
    seedSchool(world, 9, 0);

    // Power + water: any footprint cell suffices (footprint scan), so powering/watering the
    // frontage road row (adjacent to the lot's south row, y=6) is enough.
    seedPower(world, 0, 8); // plant (0,8)-(1,9); (0,8) adj road (0,7) → powers the road row
    seedWater(world, 3, 8); // tower (3,8); adj road (3,7) → waters the road row

    world.markServiceDirty();
    world.markFireDirty();
    world.markHospitalDirty();
    world.markSchoolDirty();
    world.markLandValueDirty();
    world.recomputeService();
    world.recomputeFire();
    world.recomputeHospital();
    world.recomputeSchool();
    world.recomputeLandValue();

    const ANCHOR = { x: 1, y: 3 };
    expect(world.getLandValue().getValue(ANCHOR.x, ANCHOR.y)).toBeGreaterThanOrEqual(LEVEL_THRESHOLDS[ZONE_MAX_LEVEL]);

    // The building under test: level 5 (max), sr 4×2 (the southern half of the 4×4 lot),
    // frontage 'S'. Capacity = 4·2·5(level)·5(unit) = 200.
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [
        { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
        { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
        { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 },
        { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 },
      ],
      anchor: ANCHOR,
      level: ZONE_MAX_LEVEL,
      density: 0,
      // Past cooldown for ANY stagger (max stagger 6): GROWTH_COOLDOWN_INTERVALS(8)+6=14; after
      // the first age++ below this clears the cooldown regardless of this building's own id.
      age: GROWTH_COOLDOWN_INTERVALS + 6 - 1,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 1, y: 5, w: 4, h: 2 },
    })!;
    expect(building).not.toBeNull();
    expect(buildingCapacity(building)).toBe(200);

    // A reachable job bank south of the frontage road, sized well above the R building's
    // largest possible workforce (400 at 4×4), so residential demand stays positive and the
    // R building's residents stay employed across the whole test. Four level-2 industrial
    // lots, sr 4×4 (area 16, the max lot size) each: 16·2(level)·5(unit) = 160, 640 total.
    for (let k = 0; k < 4; k++) {
      const jx = 5 + k * 5;
      const footprint = [];
      for (let dx = 0; dx < 4; dx++) {
        for (let dy = 0; dy < 4; dy++) footprint.push({ x: jx + dx, y: 8 + dy });
      }
      expect(map.getBuildings().addExistingBuilding({
        id: 100 + k,
        type: 'industrial',
        footprint,
        anchor: { x: jx, y: 8 },
        level: 2,
        density: 0,
        age: 0,
        abandoned: false,
        frontage: 'N',
        structureRect: { x: jx, y: 8, w: 4, h: 4 },
      })).toBe(true);
    }

    // Asserted last, once every road, structure and building exists.
    world.recomputeLabor();
    world.markDemandDirty();
    expect(world.getLaborMarket().getReachableUnfilledJobs()).toBeGreaterThan(0);
    expect(world.getDemand().residential).toBeGreaterThan(0);

    function tickOneGrowthInterval(): ReturnType<typeof world.tick> {
      for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
      return world.tick();
    }

    // Extend 1: 4×2 → 4×3 (8 → 12 tiles, capacity 200 → 300). Age resets after firing, so the
    // second extend below needs up to GROWTH_COOLDOWN_INTERVALS+6=14 more growth passes; poll
    // rather than compute the exact stagger.
    let grown = false;
    for (let g = 0; g < 20 && !grown; g++) {
      tickOneGrowthInterval();
      grown = map.getBuildings().getBuilding(building.id)!.structureRect.h === 3;
    }
    expect(grown).toBe(true);
    let b = map.getBuildings().getBuilding(building.id)!;
    expect(b.structureRect).toEqual({ x: 1, y: 4, w: 4, h: 3 });
    expect(b.level).toBe(ZONE_MAX_LEVEL);
    expect(b.density).toBe(0);
    expect(buildingCapacity(b)).toBe(300);

    // Extend 2: 4×3 → 4×4 (12 → 16 tiles, capacity 300 → 400) — fills the lot's depth cap,
    // matching lot.h exactly, so canExtendStructure goes false and further growth passes fall
    // through to the (untouched) density branch instead.
    grown = false;
    for (let g = 0; g < 20 && !grown; g++) {
      tickOneGrowthInterval();
      grown = map.getBuildings().getBuilding(building.id)!.structureRect.h === 4;
    }
    expect(grown).toBe(true);
    b = map.getBuildings().getBuilding(building.id)!;
    expect(b.structureRect).toEqual({ x: 1, y: 3, w: 4, h: 4 });
    expect(b.level).toBe(ZONE_MAX_LEVEL);
    expect(buildingCapacity(b)).toBe(400);
    expect(b.abandoned).toBe(false);
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
      abandoned: false,
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
      abandoned: false,
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
    // Two adjacent 1×4 R lots (road at y=4) plus level-4 industrial demand seeders
    // (road at y=6) on land served by all four services + a park, so the
    // abandonment sweep (Task 4) flags none of them: the R anchors clear level 2
    // (lv ≈ 0.4, below LEVEL_THRESHOLDS[3]=0.45 so no level-up resets age before
    // the merge pass), and the industrials clear level 4 (lv ≈ 0.73) so they keep
    // feeding residential demand. Water is present from the start; only adding
    // power flips the merge from blocked to firing.
    const world = new World(14, 10, { regenerate: false });
    const map = world.getMap();

    // R lots: cols 0,1 over rows 0..3, fronting the road at y=4.
    for (let x = 0; x < 14; x++) map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
    for (let y = 0; y < 4; y++) {
      map.setTile(0, y, createTile(0, y, TileType.ZONE_RESIDENTIAL));
      map.setTile(1, y, createTile(1, y, TileType.ZONE_RESIDENTIAL));
    }
    // Industrial demand seeders fronting a second road row at y=6, linked to the
    // y=4 row by a vertical road at (13,5) so one power plant feeds both rows.
    for (let x = 0; x < 14; x++) map.setTile(x, 6, createTile(x, 6, TileType.ROAD));
    map.setTile(13, 5, createTile(13, 5, TileType.ROAD));
    map.setTile(0, 5, createTile(0, 5, TileType.ZONE_INDUSTRIAL));
    map.setTile(1, 5, createTile(1, 5, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 5, createTile(3, 5, TileType.ZONE_INDUSTRIAL));
    map.setTile(4, 5, createTile(4, 5, TileType.ZONE_INDUSTRIAL));

    // R lots: sr shrunk to the modal south-pinned 1x2 (rows 2-3 of the 4-deep lot) — a
    // 1-wide lot's structureDepthCap floors at MIN_STRUCTURE_DEPTH_CAP=2 (growthConstants.ts),
    // so a full-depth (h=4) sr was never reachable by real growth anyway. This keeps
    // buildingCapacity(level MERGE_LEVEL_THRESHOLD=2) = 1*2*2*5 = 20 each, matching this
    // fixture's MIN_MARKET-era arithmetic (40 workers total) exactly.
    map.getBuildings().addExistingBuilding({
      id: 0,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }],
      anchor: { x: 0, y: 0 },
      level: MERGE_LEVEL_THRESHOLD,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 6,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 0, y: 2, w: 1, h: 2 },
    });
    map.getBuildings().addExistingBuilding({
      id: 1,
      type: 'residential',
      footprint: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }],
      anchor: { x: 1, y: 0 },
      level: MERGE_LEVEL_THRESHOLD,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS + 6,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 1, y: 2, w: 1, h: 2 },
    });
    // Level-4 industrials, each a modal 2-wide 1-deep lot (id 3 moved to x=3..4 so the two
    // don't collide) so buildingCapacity(level 4) = 2*1*4*5 = 40 each — matching this
    // fixture's MIN_MARKET-era arithmetic exactly. Both front the y=6 road that the (13,5)
    // link joins to the R lots' own road row, so their 80 jobs are reachable: the two
    // MERGE_LEVEL_THRESHOLD R lots' 40 workers are all employed and 40 vacancies remain, giving
    // ratio 0.40 on a market floored to MIN_MARKET → residential saturates at 1.0, above
    // DENSITY_DEMAND_THRESHOLD for the whole run.
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'industrial', footprint: [{ x: 0, y: 5 }, { x: 1, y: 5 }], anchor: { x: 0, y: 5 },
      level: 4, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 5, w: 2, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: 3, type: 'industrial', footprint: [{ x: 3, y: 5 }, { x: 4, y: 5 }], anchor: { x: 3, y: 5 },
      level: 4, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 3, y: 5, w: 2, h: 1 },
    });

    // Water from the start: tower spur (13,3) off road y=4, tower (13,2) feeding it.
    map.setTile(13, 3, createTile(13, 3, TileType.ROAD));
    seedWater(world, 13, 2);
    // Four services (no power needed) over both road rows so every anchor is covered.
    seedPolice(world, 4, 2);
    seedFire(world, 6, 2);
    seedHospital(world, 8, 2);
    seedSchool(world, 10, 2);
    // Park near the R lot tops for the additive boost to clear level 2.
    seedPark(world, 2, 0);
    world.markLandValueDirty();
    world.recomputeLandValue();
    world.markDemandDirty();

    // No power — first growth tick: no merge (buildings are unpowered; water alone is not enough).
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    world.tick();
    expect(map.getBuildings().getBuilding(0)).not.toBeNull();
    expect(map.getBuildings().getBuilding(1)).not.toBeNull();

    // Add power: plant at (12,7)-(13,8); cell (12,7) adj road (12,6) → powers the
    // connected road network (y=6 ↔ y=4 via the (13,3) spur). Buildings have NOT
    // aged (unpowered), so age still satisfies cooldown.
    seedPower(world, 12, 7);
    world.markPowerDirty();
    world.recomputePower();

    // Run another growth tick: both powered → merge succeeds.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    world.tick();

    const aExists = map.getBuildings().getBuilding(0) !== null;
    const bExists = map.getBuildings().getBuilding(1) !== null;
    expect(aExists && bExists).toBe(false);
  });
});

describe('World.tick() — congestion-suppressed land value gates level-up', () => {
  it('a jammed frontage road blocks the L2→L3 level-up; relieving the jam re-enables it', () => {
    // COMPACT counterpart to the abandonment corridor test: the real
    // labor → traffic → land-value cascade is already covered (World.test.ts), so this
    // fixture seeds ONE synthetic congestion byte and checks only the gameplay
    // consequence — the land-value gate on level-up.
    //
    // Seeding is a legitimate seam here: TrafficMap.getRaw() hands back the backing
    // Uint8Array by reference, and while trafficDirty stays false nothing recomputes
    // over it before the TRAFFIC_INTERVAL = 16 cadence (the same retained-reference
    // contract the "traffic cadence" test in World.test.ts pins down). Drain-on-read is
    // untouched because dirtiness is never set until the relief phase.
    //
    // Reserved cells (nothing overlaps): road row y=2 (x=0..W-1) + water spur (W-1,1);
    // power plant (0,3)-(1,4); probe zone (5,1); commercial job source (15,1);
    // police (20,3)-(21,4); fire (20,0)-(21,1); hospital (22,3)-(23,4);
    // school (22,0)-(23,1); water tower (W-1,0).
    const world = new World(32, 8, { regenerate: false });
    const map = world.getMap();
    // Single width source of truth (as seedServedCluster does) — the flat traffic index
    // below derives from it, so a resized fixture can never silently address another cell.
    const W = map.getWidth();
    for (let x = 0; x < W; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
    map.setTile(W - 1, 1, createTile(W - 1, 1, TileType.ROAD)); // water spur, placed before any propagation

    // Probe: 2-wide 1-deep lot (modal sr area 2, anchor unmoved since the extra cell is
    // added EAST — every later assertion hardcodes anchor (5,1)) whose structureRect
    // already fills it → the level-up branch fires directly. age ≫ the cooldown so only
    // land value can gate it. buildingCapacity(level 2) = 2*1*2*5 = 20, matching this
    // fixture's MIN_MARKET-era arithmetic exactly.
    const PROBE_ID = 0;
    map.setTile(5, 1, createTile(5, 1, TileType.ZONE_RESIDENTIAL));
    expect(map.getBuildings().addExistingBuilding({
      id: PROBE_ID,
      type: 'residential',
      footprint: [{ x: 5, y: 1 }, { x: 6, y: 1 }],
      anchor: { x: 5, y: 1 },
      level: 2,
      density: 0,
      age: 100,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 5, y: 1, w: 2, h: 1 },
    })).toBe(true);
    // Commercial L4 job source (also widened to a modal 2-wide lot, anchor unmoved), road-
    // reachable from the probe's frontage: buildingCapacity(level 4) = 2*1*4*5 = 40 jobs,
    // keeping a reachable-vacancy surplus in BOTH phases — net 20 against the L2 probe's 20
    // workers and net 10 against the L3 probe's 30 — so the labor axis never closes the gate
    // on its own. Level 5 would exceed maxSupportedLevel at this anchor (lv ≈ 0.72) and
    // abandon on the first sweep, which would silently make the whole test vacuous.
    expect(map.getBuildings().addExistingBuilding({
      id: 1,
      type: 'commercial',
      footprint: [{ x: 15, y: 1 }, { x: 16, y: 1 }],
      anchor: { x: 15, y: 1 },
      level: 4,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 15, y: 1, w: 2, h: 1 },
    })).toBe(true);

    seedPower(world, 0, 3); // plant (0,3)-(1,4); (0,3) adj road (0,2) → powers the road row
    seedWater(world, W - 1, 0); // tower (W-1,0) adj spur (W-1,1) → waters the whole road row
    // Stations hang off the road row east of the probe. Police/fire nearest seed is (20,2),
    // 15 road hops from the probe's frontage (5,2) → round(255·(1−15/SERVICE_RANGE_TILES))
    // = 96 with SERVICE_RANGE_TILES = 24 (serviceCoveragePropagation.ts); hospital/school
    // nearest seed is (22,2), 17 hops → round(255·(1−17/24)) = 74.
    // The anchor (5,1) is off-road distance 1 from (5,2) → offRoadFactor(1) = 1.0 → it
    // receives the frontage road cell's full intensity.
    seedPolice(world, 20, 3);
    seedFire(world, 20, 0);
    seedHospital(world, 22, 3);
    seedSchool(world, 22, 0);

    // The seed helpers only MARK land value dirty and getLandValue() does not drain, so
    // force the recompute before asserting preconditions (as seedServedCluster does).
    world.recomputeLandValue();

    // Derived preconditions — all four coverages clear SERVICE_COVERAGE_THRESHOLD_RAW = 64.
    expect(world.getServiceCoverageMap().getCoverage(5, 1)).toBe(96);
    expect(world.getFireCoverageMap().getCoverage(5, 1)).toBe(96);
    expect(world.getHospitalCoverageMap().getCoverage(5, 1)).toBe(74);
    expect(world.getSchoolCoverageMap().getCoverage(5, 1)).toBe(74);
    // 20 workers, 40 reachable jobs → net 20 on a market floored to MIN_MARKET → ratio 0.20.
    expect(world.getDemand().residential).toBeCloseTo(0.75, 10);
    // Uncongested anchor land value: road 0.40·(1 − 1/7) + diversity 0.10·(1/3) (only the
    // probe's own R tile is zoned in the 3×3) + service 0.50·(96+96+74+74)/1020 ≈ 0.5429.
    // The recompute drains traffic, which is NOT dirty, so the still-zero congestion map
    // leaves this value uncongested.
    const UNCONGESTED_LV = 0.40 * (6 / 7) + 0.10 * (1 / 3) + 0.50 * (340 / 1020);
    expect(world.getLandValue().getValue(5, 1)).toBeCloseTo(UNCONGESTED_LV, 6);

    // Blocked phase: jam the probe's frontage road (5,2) at full congestion. The retained
    // reference is read back below WITHOUT going through the draining getTrafficMap(), so
    // the survival check can never be satisfied by a recompute it triggered itself.
    const trafficRaw = world.getTrafficMap().getRaw();
    const FRONTAGE_INDEX = 2 * W + 5; // flat index of the probe's frontage road (5,2)
    trafficRaw[FRONTAGE_INDEX] = 255;
    world.markLandValueDirty();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick(); // → tick 8, first growth tick

    // The synthetic byte is still there: tick 8 is inside the TRAFFIC_INTERVAL = 16 window
    // and nothing in the fixture marked traffic or labor dirty.
    expect(trafficRaw[FRONTAGE_INDEX]).toBe(255);
    const blockedLv = world.getLandValue().getValue(5, 1);
    expect(blockedLv).toBeCloseTo(UNCONGESTED_LV - 0.20 * (255 / 255) * (6 / 7), 6); // ≈ 0.3714
    expect(blockedLv).toBeLessThan(LEVEL_THRESHOLDS[3]); // 0.45 → L3 out of reach
    expect(blockedLv).toBeGreaterThanOrEqual(LEVEL_THRESHOLDS[2]); // 0.25 → L2 still supported
    expect(map.getBuildings().getBuilding(PROBE_ID)!.level).toBe(2);
    expect(map.getBuildings().getBuilding(PROBE_ID)!.abandoned).toBe(false);
    // The job source survives the sweep too — otherwise the jobs vanish and demand, not land
    // value, would be what blocked the level-up.
    expect(map.getBuildings().getBuilding(1)!.abandoned).toBe(false);

    // Relief phase: re-resolve traffic from the REAL flows. The L2 probe's whole matched
    // workforce (2 · POPULATION_PER_LEVEL, absorbed by the L2 commercial) loads road tiles
    // x=5..15 of its commute → byte 10 at capacity 500, a residual penalty of
    // 0.20·(10/255)·(6/7) ≈ 0.0067 at the anchor (frontage at Chebyshev distance 1) —
    // real congestion from an ordinary commute, but far short of the ~0.09 that would
    // push the anchor back under LEVEL_THRESHOLDS[3].
    const RELIEF_BYTE = Math.round((255 * 2 * POPULATION_PER_LEVEL) / TRAFFIC_CAPACITY);
    world.markTrafficDirty();
    world.tick(); // tick 9: traffic resolves before land value in the derived-field chain

    expect(world.getTrafficMap().getCongestion(5, 2)).toBe(RELIEF_BYTE);
    const reliefLv = world.getLandValue().getValue(5, 1);
    expect(reliefLv).toBeCloseTo(UNCONGESTED_LV - 0.20 * (RELIEF_BYTE / 255) * (6 / 7), 6);
    expect(reliefLv).toBeGreaterThanOrEqual(LEVEL_THRESHOLDS[3]);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick(); // → tick 16, next growth tick
    expect(map.getBuildings().getBuilding(PROBE_ID)!.level).toBe(3);
  });
});
