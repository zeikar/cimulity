import { describe, it, expect } from 'vitest';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { inspectTile } from './inspectTile';
import { SERVICE_COVERAGE_THRESHOLD_RAW } from '../core/ServiceCoverageMap';

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
      abandoned: false,
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
      abandoned: false,
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

  it('reports a service structure (police) as powered AND watered when wired next to a powered/watered road', () => {
    const world = makeWorld(8);
    // Road line (2,0)-(4,0). Plant at (2,1) powers it; tower at (4,1) waters it.
    for (const x of [2, 3, 4]) world.getMap().setTile(x, 0, createTile(x, 0, TileType.ROAD));
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }],
      anchor: { x: 2, y: 1 },
    });
    world.getStructureMap().addStructure({
      type: 'water_tower',
      footprint: [{ x: 4, y: 1 }],
      anchor: { x: 4, y: 1 },
    });
    // Police 2×2 at (5,0)..(6,1): cell (5,0) is adjacent to powered+watered road (4,0).
    world.getStructureMap().addStructure({
      type: 'police_station',
      footprint: [{ x: 5, y: 0 }, { x: 6, y: 0 }, { x: 5, y: 1 }, { x: 6, y: 1 }],
      anchor: { x: 5, y: 0 },
    });
    world.recomputePower();
    world.recomputeWater();

    const info = inspectTile(world, { x: 5, y: 0 })!;
    expect(info.structure).toEqual({ type: 'police_station' });
    expect(info.powered).toBe(true);
    expect(info.watered).toBe(true);
  });

  it('reports a service structure as NOT powered/watered when the adjacent road has no plant/tower', () => {
    const world = makeWorld(8);
    // A plain road with no power plant / water tower → ungridded.
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.getStructureMap().addStructure({
      type: 'fire_station',
      footprint: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
      anchor: { x: 1, y: 1 },
    });
    world.recomputePower();
    world.recomputeWater();

    const info = inspectTile(world, { x: 1, y: 1 })!;
    expect(info.powered).toBe(false);
    expect(info.watered).toBe(false);
  });

  it('reports land value in [0, 1]', () => {
    const world = makeWorld();
    const info = inspectTile(world, { x: 1, y: 1 });
    expect(info!.landValue).toBeGreaterThanOrEqual(0);
    expect(info!.landValue).toBeLessThanOrEqual(1);
  });

  it('reports congestionPenalty 0 on a quiet map with no traffic', () => {
    const world = makeWorld();
    const info = inspectTile(world, { x: 1, y: 1 });
    expect(info!.congestionPenalty).toBe(0);
  });

  it('reports a nonzero congestionPenalty matching getLandValue().getCongestionPenalty when a road is jammed', () => {
    const size = 6;
    const world = makeWorld(size);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));

    // Seed full congestion directly on the retained TrafficMap array — traffic is never
    // marked dirty, so this byte survives until land value reads it.
    world.getTrafficMap().getRaw()[2 * size + 2] = 255;
    world.markLandValueDirty();

    const info = inspectTile(world, { x: 2, y: 2 });
    expect(info!.congestionPenalty).toBeGreaterThan(0);
    expect(info!.congestionPenalty).toBe(world.getLandValue().getCongestionPenalty(2, 2));
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

  it('reports the building ANCHOR land value when a non-anchor footprint cell is clicked', () => {
    // The growth gates read the anchor (World.tick: lv.getValue(existing.anchor...)),
    // so the panel must report the same cell — otherwise a lot straddling a land-value
    // step shows a threshold as cleared that the deciding cell has not cleared.
    const world = new World(20, 20, { regenerate: false });
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ZONE_RESIDENTIAL));
    // Road adjacent to the NON-anchor cell only, so road proximity — and with it
    // land value — differs across the two footprint cells.
    world.getMap().setTile(4, 2, createTile(4, 2, TileType.ROAD));
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
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 2, h: 1 },
    });
    world.recomputeLandValue();

    const anchorValue = world.getLandValue().getValue(2, 2);
    const cellValue = world.getLandValue().getValue(3, 2);
    // Guard against a vacuous pass: if the fixture ever stops producing a spread,
    // the assertion below would hold for the wrong reason.
    expect(cellValue).not.toBe(anchorValue);

    expect(inspectTile(world, { x: 3, y: 2 })!.landValue).toBe(anchorValue);
    // The anchor itself is unchanged.
    expect(inspectTile(world, { x: 2, y: 2 })!.landValue).toBe(anchorValue);
  });

  it('reports the building ANCHOR congestion penalty so it describes the same cell as landValue', () => {
    // landValue and congestionPenalty are shown adjacent in the panel and are two
    // halves of one figure (penalty = uncongested - value). Sourcing them from
    // different cells would make the pair incoherent.
    const size = 20;
    const world = new World(size, size, { regenerate: false });
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().setTile(4, 2, createTile(4, 2, TileType.ROAD));
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
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 2, h: 1 },
    });
    // Jam the road so the penalty is nonzero, and distance-weighted differently at
    // each footprint cell (Chebyshev 1 from the non-anchor cell, 2 from the anchor).
    world.getTrafficMap().getRaw()[2 * size + 4] = 255;
    world.markLandValueDirty();
    world.recomputeLandValueIfDirty();

    const anchorPenalty = world.getLandValue().getCongestionPenalty(2, 2);
    const cellPenalty = world.getLandValue().getCongestionPenalty(3, 2);
    // Non-vacuous: the two cells must genuinely disagree, and the penalty must be real.
    expect(anchorPenalty).toBeGreaterThan(0);
    expect(cellPenalty).not.toBe(anchorPenalty);

    expect(inspectTile(world, { x: 3, y: 2 })!.congestionPenalty).toBe(anchorPenalty);
  });

  it('reports the building ANCHOR service coverage when a non-anchor footprint cell is clicked', () => {
    // World.tick: "Graded fields (land value, coverage) gate at the ANCHOR; binary fields
    // (power, water) scan the FOOTPRINT." All four coverage gates call is*AnchorCovered,
    // so a non-anchor cell reading its own coverage could show green while the anchor
    // blocks growth — the same misleading wait state as the land-value case.
    const size = 20;
    const world = new World(size, size, { regenerate: false });
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
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 2, h: 1 },
    });

    // Cover the NON-anchor cell only; the anchor stays at 0, so every gate is shut.
    const covered = 200;
    world.getServiceCoverageMap().getRaw()[2 * size + 3] = covered;
    world.getFireCoverageMap().getRaw()[2 * size + 3] = covered;
    world.getHospitalCoverageMap().getRaw()[2 * size + 3] = covered;
    world.getSchoolCoverageMap().getRaw()[2 * size + 3] = covered;

    // Non-vacuous: read the maps back, not the literal. A wrong stride would leave the
    // clicked cell at 0, and the assertions below would then hold for the wrong reason.
    for (const map of [
      world.getServiceCoverageMap(),
      world.getFireCoverageMap(),
      world.getHospitalCoverageMap(),
      world.getSchoolCoverageMap(),
    ]) {
      expect(map.getCoverage(3, 2)).toBeGreaterThanOrEqual(SERVICE_COVERAGE_THRESHOLD_RAW);
      expect(map.getCoverage(2, 2)).toBeLessThan(SERVICE_COVERAGE_THRESHOLD_RAW);
    }

    const info = inspectTile(world, { x: 3, y: 2 })!;
    // The anchor decides, so every gate reads shut and every number reads 0.
    expect(info.serviceCovered).toBe(false);
    expect(info.fireServiceCovered).toBe(false);
    expect(info.hospitalServiceCovered).toBe(false);
    expect(info.schoolServiceCovered).toBe(false);
    expect(info.coverage).toBe(0);
    expect(info.fireCoverage).toBe(0);
    expect(info.hospitalCoverage).toBe(0);
    expect(info.schoolCoverage).toBe(0);
  });

  it('reports the clicked cell service coverage when no building occupies the tile', () => {
    // The anchor redirect is building-scoped; bare land still describes itself.
    const size = 20;
    const world = new World(size, size, { regenerate: false });
    world.getServiceCoverageMap().getRaw()[2 * size + 3] = 200;

    const info = inspectTile(world, { x: 3, y: 2 })!;
    expect(info.serviceCovered).toBe(true);
    expect(info.coverage).toBeCloseTo(200 / 255);
  });

  it('reports the clicked cell land value when no building occupies the tile', () => {
    // The anchor redirect applies to building cells only — a bare tile still
    // describes itself.
    const world = new World(20, 20, { regenerate: false });
    world.getMap().setTile(4, 2, createTile(4, 2, TileType.ROAD));
    world.recomputeLandValue();

    expect(inspectTile(world, { x: 3, y: 2 })!.landValue).toBe(
      world.getLandValue().getValue(3, 2),
    );
  });

  it('surfaces a grown building occupying the tile', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    // A 1-wide lot capped at density tier 1 (level 5, density 1) — the built-out
    // state a width-1 lot can actually reach, unlike the old level-1/density-2
    // fixture, which no simulation path can produce (over the lot-width cap).
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 5,
      density: 1,
      age: 5,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });
    const info = inspectTile(world, { x: 2, y: 2 });
    // capacity = 1 * 1 * 5 * DENSITY_CAPACITY_UNITS[1] (7) = 35.
    expect(info!.building).toEqual({
      type: 'residential',
      level: 5,
      density: 1,
      age: 5,
      abandoned: false,
      capacity: 35,
      lotWidth: 1,
      maxDensity: 1,
    });
    expect(info!.structure).toBeNull();
  });

  it('reports capacity 200, lotWidth 2, maxDensity 2 for a built-out 2x2 lot at density tier 2', () => {
    const world = makeWorld();
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) {
      world.getMap().setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
    }
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
      level: 5,
      density: 2,
      age: 5,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 2, h: 2 },
    });
    const info = inspectTile(world, { x: 2, y: 2 });
    // capacity = 2 * 2 * 5 * DENSITY_CAPACITY_UNITS[2] (10) = 200.
    expect(info!.building!.capacity).toBe(200);
    expect(info!.building!.lotWidth).toBe(2);
    expect(info!.building!.maxDensity).toBe(2);
  });

  it('reports lotWidth 2 for a W-frontage lot 1 wide x 2 tall (width measured along the depth-perpendicular axis)', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ZONE_RESIDENTIAL));
    // A 2-cell-along-the-width-axis footprint only exists after a merge (mergePolicy.ts),
    // which requires both parents at ZONE_MAX_LEVEL first — so level must be 5, not a
    // fresh-spawn 1. density 1 is the just-merged, not-yet-density-bumped state: merge
    // takes max(a.density, b.density), and each 1-wide parent was capped at tier 1.
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
      anchor: { x: 2, y: 2 },
      level: 5,
      density: 1,
      age: 0,
      abandoned: false,
      frontage: 'W',
      structureRect: { x: 2, y: 2, w: 1, h: 2 },
    });
    const info = inspectTile(world, { x: 2, y: 2 });
    // lot is 1 wide x 2 tall; for W/E frontage the width-along-frontage axis is
    // lot.h, not lot.w — so this must read 2, not 1 (the N/S-axis answer).
    // capacity = 1 * 2 * 5 * DENSITY_CAPACITY_UNITS[1] (7) = 70.
    expect(info!.building!.capacity).toBe(70);
    expect(info!.building!.lotWidth).toBe(2);
    expect(info!.building!.maxDensity).toBe(2);
  });

  it('surfaces abandoned:true for an abandoned building and abandoned:false for an active one', () => {
    const world = makeWorld();
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 2,
      density: 0,
      age: 10,
      abandoned: true,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    const abandonedInfo = inspectTile(world, { x: 1, y: 1 });
    expect(abandonedInfo!.building!.abandoned).toBe(true);

    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_COMMERCIAL));
    world.getMap().getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 1,
      density: 0,
      age: 3,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });
    const activeInfo = inspectTile(world, { x: 2, y: 2 });
    expect(activeInfo!.building!.abandoned).toBe(false);
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

  describe('service coverage', () => {
    const SIZE = 6;

    it('reports coverage matching getCoverage/255 and serviceCovered true for a covered tile', () => {
      const world = makeWorld(SIZE);
      // Seed raw=128 at (2,2) — well above the threshold.
      world.getServiceCoverageMap().getRaw()[2 * SIZE + 2] = 128;
      const info = inspectTile(world, { x: 2, y: 2 })!;
      expect(info.coverage).toBeCloseTo(128 / 255);
      expect(info.serviceCovered).toBe(true);
    });

    it('reports serviceCovered false for a tile at raw 63 (one below threshold)', () => {
      const world = makeWorld(SIZE);
      // SERVICE_COVERAGE_THRESHOLD_RAW = 64; raw 63 must NOT be covered.
      world.getServiceCoverageMap().getRaw()[1 * SIZE + 1] = SERVICE_COVERAGE_THRESHOLD_RAW - 1;
      const info = inspectTile(world, { x: 1, y: 1 })!;
      expect(info.serviceCovered).toBe(false);
      expect(info.coverage).toBeCloseTo((SERVICE_COVERAGE_THRESHOLD_RAW - 1) / 255);
    });

    it('reports serviceCovered true for a tile exactly at threshold (raw 64)', () => {
      const world = makeWorld(SIZE);
      world.getServiceCoverageMap().getRaw()[1 * SIZE + 1] = SERVICE_COVERAGE_THRESHOLD_RAW;
      const info = inspectTile(world, { x: 1, y: 1 })!;
      expect(info.serviceCovered).toBe(true);
    });

    it('reports isServiceSource true, coverage 0, serviceCovered false for a police_station tile', () => {
      const world = makeWorld(SIZE);
      // police_station requires a 2×2 footprint (same as power_plant).
      world.getStructureMap().addStructure({
        type: 'police_station',
        footprint: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 1, y: 2 },
          { x: 2, y: 2 },
        ],
        anchor: { x: 1, y: 1 },
      });
      // Even if the raw array had a value, the source tile should read 0/false.
      world.getServiceCoverageMap().getRaw()[2 * SIZE + 2] = 200;
      const info = inspectTile(world, { x: 2, y: 2 })!;
      expect(info.isServiceSource).toBe(true);
      expect(info.coverage).toBe(0);
      expect(info.serviceCovered).toBe(false);
    });

    it('reports coverage 0 and serviceCovered false for an uncovered tile', () => {
      const world = makeWorld(SIZE);
      // Raw array defaults to 0 — no seeding needed.
      const info = inspectTile(world, { x: 3, y: 3 })!;
      expect(info.isServiceSource).toBe(false);
      expect(info.coverage).toBe(0);
      expect(info.serviceCovered).toBe(false);
    });
  });

  describe('fire coverage', () => {
    const SIZE = 6;

    it('reports fireCoverage matching getCoverage/255 and fireServiceCovered true for a covered tile', () => {
      const world = makeWorld(SIZE);
      // Seed raw=128 at (2,2) — well above the threshold.
      world.getFireCoverageMap().getRaw()[2 * SIZE + 2] = 128;
      const info = inspectTile(world, { x: 2, y: 2 })!;
      expect(info.fireCoverage).toBeCloseTo(128 / 255);
      expect(info.fireServiceCovered).toBe(true);
    });

    it('reports fireServiceCovered false for a tile at raw 63 (one below threshold)', () => {
      const world = makeWorld(SIZE);
      // SERVICE_COVERAGE_THRESHOLD_RAW = 64; raw 63 must NOT be covered.
      world.getFireCoverageMap().getRaw()[1 * SIZE + 1] = SERVICE_COVERAGE_THRESHOLD_RAW - 1;
      const info = inspectTile(world, { x: 1, y: 1 })!;
      expect(info.fireServiceCovered).toBe(false);
      expect(info.fireCoverage).toBeCloseTo((SERVICE_COVERAGE_THRESHOLD_RAW - 1) / 255);
    });

    it('reports fireServiceCovered true for a tile exactly at threshold (raw 64)', () => {
      const world = makeWorld(SIZE);
      world.getFireCoverageMap().getRaw()[1 * SIZE + 1] = SERVICE_COVERAGE_THRESHOLD_RAW;
      const info = inspectTile(world, { x: 1, y: 1 })!;
      expect(info.fireServiceCovered).toBe(true);
    });

    it('reports isFireSource true, fireCoverage 0, fireServiceCovered false for a fire_station tile', () => {
      const world = makeWorld(SIZE);
      // fire_station requires a 2×2 footprint (same as power_plant).
      world.getStructureMap().addStructure({
        type: 'fire_station',
        footprint: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 1, y: 2 },
          { x: 2, y: 2 },
        ],
        anchor: { x: 1, y: 1 },
      });
      // Even if the raw array had a value, the source tile should read 0/false.
      world.getFireCoverageMap().getRaw()[2 * SIZE + 2] = 200;
      const info = inspectTile(world, { x: 2, y: 2 })!;
      expect(info.isFireSource).toBe(true);
      expect(info.fireCoverage).toBe(0);
      expect(info.fireServiceCovered).toBe(false);
    });

    it('reports fireCoverage 0 and fireServiceCovered false for an uncovered tile', () => {
      const world = makeWorld(SIZE);
      // Raw array defaults to 0 — no seeding needed.
      const info = inspectTile(world, { x: 3, y: 3 })!;
      expect(info.isFireSource).toBe(false);
      expect(info.fireCoverage).toBe(0);
      expect(info.fireServiceCovered).toBe(false);
    });
  });

  describe('hospital coverage', () => {
    const SIZE = 6;

    it('reports hospitalCoverage matching getCoverage/255 and hospitalServiceCovered true for a covered tile', () => {
      const world = makeWorld(SIZE);
      // Seed raw=128 at (2,2) — well above the threshold.
      world.getHospitalCoverageMap().getRaw()[2 * SIZE + 2] = 128;
      const info = inspectTile(world, { x: 2, y: 2 })!;
      expect(info.hospitalCoverage).toBeCloseTo(128 / 255);
      expect(info.hospitalServiceCovered).toBe(true);
    });

    it('reports hospitalServiceCovered false for a tile at raw 63 (one below threshold)', () => {
      const world = makeWorld(SIZE);
      // SERVICE_COVERAGE_THRESHOLD_RAW = 64; raw 63 must NOT be covered.
      world.getHospitalCoverageMap().getRaw()[1 * SIZE + 1] = SERVICE_COVERAGE_THRESHOLD_RAW - 1;
      const info = inspectTile(world, { x: 1, y: 1 })!;
      expect(info.hospitalServiceCovered).toBe(false);
      expect(info.hospitalCoverage).toBeCloseTo((SERVICE_COVERAGE_THRESHOLD_RAW - 1) / 255);
    });

    it('reports hospitalServiceCovered true for a tile exactly at threshold (raw 64)', () => {
      const world = makeWorld(SIZE);
      world.getHospitalCoverageMap().getRaw()[1 * SIZE + 1] = SERVICE_COVERAGE_THRESHOLD_RAW;
      const info = inspectTile(world, { x: 1, y: 1 })!;
      expect(info.hospitalServiceCovered).toBe(true);
    });

    it('reports isHospitalSource true, hospitalCoverage 0, hospitalServiceCovered false for a hospital tile', () => {
      const world = makeWorld(SIZE);
      // hospital requires a 2×2 footprint (same as fire_station).
      world.getStructureMap().addStructure({
        type: 'hospital',
        footprint: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 1, y: 2 },
          { x: 2, y: 2 },
        ],
        anchor: { x: 1, y: 1 },
      });
      // Even if the raw array had a value, the source tile should read 0/false.
      world.getHospitalCoverageMap().getRaw()[2 * SIZE + 2] = 200;
      const info = inspectTile(world, { x: 2, y: 2 })!;
      expect(info.isHospitalSource).toBe(true);
      expect(info.hospitalCoverage).toBe(0);
      expect(info.hospitalServiceCovered).toBe(false);
    });

    it('reports hospitalCoverage 0 and hospitalServiceCovered false for an uncovered tile', () => {
      const world = makeWorld(SIZE);
      // Raw array defaults to 0 — no seeding needed.
      const info = inspectTile(world, { x: 3, y: 3 })!;
      expect(info.isHospitalSource).toBe(false);
      expect(info.hospitalCoverage).toBe(0);
      expect(info.hospitalServiceCovered).toBe(false);
    });
  });

  describe('school coverage', () => {
    const SIZE = 6;

    it('reports schoolCoverage matching getCoverage/255 and schoolServiceCovered true for a covered tile', () => {
      const world = makeWorld(SIZE);
      // Seed raw=128 at (2,2) — well above the threshold.
      world.getSchoolCoverageMap().getRaw()[2 * SIZE + 2] = 128;
      const info = inspectTile(world, { x: 2, y: 2 })!;
      expect(info.schoolCoverage).toBeCloseTo(128 / 255);
      expect(info.schoolServiceCovered).toBe(true);
    });

    it('reports schoolServiceCovered false for a tile at raw 63 (one below threshold)', () => {
      const world = makeWorld(SIZE);
      // SERVICE_COVERAGE_THRESHOLD_RAW = 64; raw 63 must NOT be covered.
      world.getSchoolCoverageMap().getRaw()[1 * SIZE + 1] = SERVICE_COVERAGE_THRESHOLD_RAW - 1;
      const info = inspectTile(world, { x: 1, y: 1 })!;
      expect(info.schoolServiceCovered).toBe(false);
      expect(info.schoolCoverage).toBeCloseTo((SERVICE_COVERAGE_THRESHOLD_RAW - 1) / 255);
    });

    it('reports schoolServiceCovered true for a tile exactly at threshold (raw 64)', () => {
      const world = makeWorld(SIZE);
      world.getSchoolCoverageMap().getRaw()[1 * SIZE + 1] = SERVICE_COVERAGE_THRESHOLD_RAW;
      const info = inspectTile(world, { x: 1, y: 1 })!;
      expect(info.schoolServiceCovered).toBe(true);
    });

    it('reports isSchoolSource true, schoolCoverage 0, schoolServiceCovered false for a school tile', () => {
      const world = makeWorld(SIZE);
      // school requires a 2×2 footprint (same as hospital).
      world.getStructureMap().addStructure({
        type: 'school',
        footprint: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 1, y: 2 },
          { x: 2, y: 2 },
        ],
        anchor: { x: 1, y: 1 },
      });
      // Even if the raw array had a value, the source tile should read 0/false.
      world.getSchoolCoverageMap().getRaw()[2 * SIZE + 2] = 200;
      const info = inspectTile(world, { x: 2, y: 2 })!;
      expect(info.isSchoolSource).toBe(true);
      expect(info.schoolCoverage).toBe(0);
      expect(info.schoolServiceCovered).toBe(false);
    });

    it('reports schoolCoverage 0 and schoolServiceCovered false for an uncovered tile', () => {
      const world = makeWorld(SIZE);
      // Raw array defaults to 0 — no seeding needed.
      const info = inspectTile(world, { x: 3, y: 3 })!;
      expect(info.isSchoolSource).toBe(false);
      expect(info.schoolCoverage).toBe(0);
      expect(info.schoolServiceCovered).toBe(false);
    });
  });
});
