import { describe, it, expect, vi } from 'vitest';
import { World, ZONE_GROWTH_INTERVAL, DENSITY_COOLDOWN_INTERVALS } from './World';
import { GROWTH_COOLDOWN_INTERVALS, LEVEL_THRESHOLDS, ZONE_MAX_LEVEL } from './growthConstants';
import { DENSITY_DEMAND_THRESHOLD, GROWTH_DEMAND_THRESHOLD } from './Demand';
import { buildingCapacity } from './buildingCapacity';
import { maxDensityForLot } from './zoneGrowth';
import { TileType, createTile } from './Tile';
import { executeClick } from '../engine/CommandDispatcher';
import { Tool } from '../tools/Tool';

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

/** 2×2 service station at (ax,ay); asserts GRASS first so a stray coord is caught. */
function seedStation(
  world: World,
  type: 'police_station' | 'fire_station' | 'hospital' | 'school',
  ax: number,
  ay: number,
): void {
  const footprint = [
    { x: ax, y: ay }, { x: ax + 1, y: ay },
    { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 },
  ];
  for (const c of footprint) expect(world.getMap().getTile(c.x, c.y)?.type).toBe(TileType.GRASS);
  expect(world.getStructureMap().addStructure({ type, anchor: { x: ax, y: ay }, footprint })).not.toBeNull();
}

describe("World.tick() — merge (Branch B'')", () => {
  // ---- Strip geometry: one source of truth for every coordinate below. ----
  const W = 24;
  const H = 8;
  /** Road row the R strip fronts ('S') and the job bank fronts ('N'). */
  const ROAD_Y = 2;
  /** R row — ONE cell deep, directly north of the road. */
  const R_Y = ROAD_Y - 1;
  /** Park row — directly north of the R row. */
  const PARK_Y = R_Y - 1;
  /** Column of the westernmost R lot; the strip is centred between the stations. */
  const X0 = 8;
  /** Columns free for the job bank (everything at y >= 3 the stations/utilities do not own). */
  const BANK_COLS = [2, 3, 8, 9, 10, 11, 12, 17, 18, 19, 20, 21, 22];
  /** Job-bank building: 1 wide × 3 deep, frontage 'N', level 3 → 1·3·3·5 = 45 jobs each. */
  const BANK_JOBS_EACH = 45;
  const BANK_JOBS_TOTAL = BANK_COLS.length * BANK_JOBS_EACH; // 13 × 45 = 585

  /**
   * A strip of `n` BUILT-OUT 1-wide R parcels, all merge-eligible under the built-out gate.
   *
   * Each parcel is a ONE-cell lot at (X0+i, R_Y) fronting 'S' onto the road at ROAD_Y, seeded at
   * every ceiling its own lot allows: `level = ZONE_MAX_LEVEL`, `density = maxDensityForLot` (1 for
   * a 1-wide lot), and a structureRect that already fills the lot's depth so `canExtendStructure`
   * is false. Capacity is therefore 1·1·5·7 = 35 workers each.
   *
   * DEPTH 1 IS LOAD-BEARING — two independent reasons, both easy to undo by accident:
   * 1. The abandonment sweep reads land value at the ANCHOR, and a level-5 building needs
   *    LEVEL_THRESHOLDS[5] there or it is frozen before the merge pass sees it.
   *    `propagateServiceCoverage` reaches 2 orthogonal hops off the road and halves at hop 2,
   *    so the anchor (the lot's NW cell) must sit at hop 1 — under frontage 'S' that is depth 1.
   * 2. `roadGraph.accessNodeFor` gives a building ONE road cell, so a consolidated parcel's
   *    whole workforce loads that single tile. Scaling this fixture up (deeper lots, higher
   *    density) congests the TERMINAL parcel's own anchor back under LEVEL_THRESHOLDS[5] and it
   *    abandons the end state these tests assert. At depth 1 the terminal 4-wide parcel is 200
   *    workers, a penalty of ≈ 0.069 that the base below absorbs.
   *
   * Land value at each R anchor ≈ 0.99 before congestion:
   *   0.40 · 6/7 (road at Chebyshev 1) + 0.10 · 1/3 (R only in the 3×3) + 0.50 · ~0.83 (four
   *   stations at road-hop distances summing to 16 from EVERY strip column) + 0.25 · 4/5 (park
   *   at Chebyshev 1) ≈ 0.34 + 0.03 + 0.42 + 0.20.
   * Net of the ≈ 0.069 peak penalty the anchors still read ≈ 0.92 — clear of 0.85 in every
   * generation.
   *
   * The job bank is a row of static level-3 commercials on GRASS at y >= 3, frontage 'N' onto the
   * SAME road row, so every job is road-reachable from the R access nodes. Grass keeps them out of
   * the zone-growth loop entirely (it iterates zone tiles), so they never age, level, densify or
   * merge, and level 3 needs only LEVEL_THRESHOLDS[3] = 0.45, which their anchors clear with room
   * for the congestion penalty. 585 jobs against a worst case of 235 workers (a fully consolidated
   * n = 5 strip: 100 + 100 + 35) leaves both demand regimes satisfied throughout — see the
   * per-test preconditions.
   */
  function setupMergeStrip(n: number): {
    world: World;
    ids: number[];
  } {
    const world = new World(W, H, { regenerate: false });
    const map = world.getMap();
    const sm = world.getStructureMap();

    for (let x = 0; x < W; x++) map.setTile(x, ROAD_Y, createTile(x, ROAD_Y, TileType.ROAD));
    for (let i = 0; i < n; i++) {
      const x = X0 + i;
      map.setTile(x, R_Y, createTile(x, R_Y, TileType.ZONE_RESIDENTIAL));
      expect(sm.addStructure({ type: 'park', anchor: { x, y: PARK_Y }, footprint: [{ x, y: PARK_Y }] })).not.toBeNull();
    }

    // Utilities and stations, all hung off the road row at y = ROAD_Y from the south.
    seedPower(world, 0, 3);        // (0,3) adj road (0,2) → powers the road row
    seedStation(world, 'hospital', 4, 3);
    seedStation(world, 'police_station', 6, 3);
    seedStation(world, 'fire_station', 13, 3);
    seedStation(world, 'school', 15, 3);
    seedWater(world, 23, 3);       // (23,3) adj road (23,2) → waters the road row

    // Built-out R parcels, ids 0..n-1. Age clears the worst-case merge cooldown
    // (GROWTH_COOLDOWN_INTERVALS + max stagger = 8 + 6 = 14) after the growth pass's age++.
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = X0 + i;
      expect(map.getBuildings().addExistingBuilding({
        id: i,
        type: 'residential',
        footprint: [{ x, y: R_Y }],
        anchor: { x, y: R_Y },
        level: ZONE_MAX_LEVEL,
        density: 1,
        age: GROWTH_COOLDOWN_INTERVALS + 6,
        abandoned: false,
        frontage: 'S',
        structureRect: { x, y: R_Y, w: 1, h: 1 },
      })).toBe(true);
      ids.push(i);
    }

    for (const [k, x] of BANK_COLS.entries()) {
      expect(map.getBuildings().addExistingBuilding({
        id: 100 + k,
        type: 'commercial',
        footprint: [{ x, y: 3 }, { x, y: 4 }, { x, y: 5 }],
        anchor: { x, y: 3 },
        level: 3,
        density: 0,
        age: 0,
        abandoned: false,
        frontage: 'N',
        structureRect: { x, y: 3, w: 1, h: 3 },
      })).toBe(true);
    }

    world.markServiceDirty();
    world.markFireDirty();
    world.markHospitalDirty();
    world.markSchoolDirty();
    world.recomputeService();
    world.recomputeFire();
    world.recomputeHospital();
    world.recomputeSchool();
    world.markLandValueDirty();
    world.recomputeLandValue();
    world.markDemandDirty();

    // Preconditions, asserted only now that every road, structure and building exists. Placed
    // mid-helper they would read a labor market that is still missing origins or destinations —
    // reachable jobs are counted from the residential BFS, so both ends must already be in.
    world.recomputeLabor();
    for (let i = 0; i < n; i++) {
      const b = map.getBuildings().getBuilding(i)!;
      // Every ceiling the built-out gate reads, pinned at seed time.
      expect(b.level).toBe(ZONE_MAX_LEVEL);
      expect(b.density).toBe(maxDensityForLot({ x: X0 + i, y: R_Y, w: 1, h: 1 }, 'S'));
      expect(buildingCapacity(b)).toBe(35); // 1·1·5·7
      // The abandonment sweep would freeze the pair out of the merge pass below 0.85.
      expect(world.getLandValue().getValue(X0 + i, R_Y)).toBeGreaterThanOrEqual(LEVEL_THRESHOLDS[ZONE_MAX_LEVEL]);
    }
    expect(world.getLaborMarket().getJobsCapacity()).toBe(BANK_JOBS_TOTAL);
    expect(world.getLaborMarket().getUnemployed()).toBe(0);
    return { world, ids };
  }

  function residentialOf(world: World) {
    return [...world.getMap().getBuildings().iterBuildings()].filter(b => b.type === 'residential');
  }

  // Advance world by exactly one growth tick; returns the tick result.
  function oneGrowthTick(world: World): ReturnType<typeof world.tick> {
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    return world.tick();
  }

  it('two-building happy path: two built-out 1-wide R parcels merge into one 2-wide building', () => {
    const { world, ids } = setupMergeStrip(2);
    const map = world.getMap();
    const [idA, idB] = ids;

    // The merge only needs demand strictly above GROWTH_DEMAND_THRESHOLD — the built-out gate,
    // not a demand spike, is what unlocks consolidation.
    expect(world.getDemand().residential).toBeGreaterThan(GROWTH_DEMAND_THRESHOLD);

    // Population-conservation precondition: this growth tick admits no OTHER capacity event
    // alongside the merge. Both parcels are at ZONE_MAX_LEVEL, so Branch B (level-up) is
    // structurally unreachable; their structureRect already fills the lot depth, so Branch B'
    // (structure-grow) is too; and their density already equals maxDensityForLot for a 1-wide
    // lot, so the density-bump branch is spent. Every R zone tile is owned, so Branch A (spawn)
    // never fires, and the job bank sits on GRASS, which the zone-growth loop never visits. The
    // merge is the only capacity-changing event left, and it conserves capacity by construction.
    const popBefore = world.getPopulation();

    const result = oneGrowthTick(world);

    expect(world.getPopulation()).toBe(popBefore);

    // Both original buildings are gone
    expect(map.getBuildings().getBuilding(idA)).toBeNull();
    expect(map.getBuildings().getBuilding(idB)).toBeNull();

    // Exactly one building remains (the merged one)
    const remaining = residentialOf(world);
    expect(remaining.length).toBe(1);
    const merged = remaining[0];

    // Merged footprint covers both one-cell lots
    expect(merged.footprint.length).toBe(2);

    // changedBuildingIds contains both old ids and the new merged id
    expect(result.changedBuildingIds).toContain(idA);
    expect(result.changedBuildingIds).toContain(idB);
    expect(result.changedBuildingIds).toContain(merged.id);

    // canMerge's gate 4 pins BOTH inputs to ZONE_MAX_LEVEL, so the merged level is that ceiling.
    expect(merged.level).toBe(ZONE_MAX_LEVEL);
    // Density is INHERITED, not recomputed: gate 8 made both inputs sit at a 1-wide lot's cap of
    // 1, so the merged building carries 1 — which is now BELOW its own 2-wide lot's cap of 2.
    // Closing that gap is exactly what the next test's PHASE 2 exercises.
    expect(merged.density).toBe(1);

    // structureRect = bbox union of the two 1×1 structureRects → 2×1
    expect(merged.structureRect).toEqual({ x: X0, y: R_Y, w: 2, h: 1 });
    expect(buildingCapacity(merged)).toBe(70); // conserved: 2·1·5·7 = 35 + 35
  });

  it('disjoint pairs then a second generation: 4 parcels consolidate to one 4-wide building', () => {
    const { world, ids } = setupMergeStrip(4);
    const map = world.getMap();
    const [idA, idB, idC, idD] = ids;

    // PHASE 1 — one growth tick merges the two disjoint pairs.
    oneGrowthTick(world);

    const afterPhase1 = residentialOf(world);
    expect(afterPhase1.length).toBe(2);
    expect(map.getBuildings().getBuilding(idA)).toBeNull();
    expect(map.getBuildings().getBuilding(idB)).toBeNull();
    expect(map.getBuildings().getBuilding(idC)).toBeNull();
    expect(map.getBuildings().getBuilding(idD)).toBeNull();

    // Coordinate-checked intermediates: two 2-wide lots at the strip's west and east halves.
    const west = map.getBuildings().getBuildingAt(X0, R_Y)!;
    const east = map.getBuildings().getBuildingAt(X0 + 2, R_Y)!;
    expect(west.id).not.toBe(east.id);
    for (const [b, x] of [[west, X0], [east, X0 + 2]] as const) {
      expect(b.footprint.length).toBe(2);
      expect(b.level).toBe(ZONE_MAX_LEVEL);
      expect(b.density).toBe(1);
      expect(b.structureRect).toEqual({ x, y: R_Y, w: 2, h: 1 });
      expect(buildingCapacity(b)).toBe(70); // 2·1·5·7
    }

    // PHASE 2 — a 2-wide lot's cap is density 2, so neither intermediate is built out yet and
    // canMerge's gate 8 rejects the pair. Both were created this tick at age 0 and the density
    // cooldown is a flat DENSITY_COOLDOWN_INTERVALS with NO stagger, so both bump on the same
    // pass, exactly DENSITY_COOLDOWN_INTERVALS growth passes later.
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);
    for (let g = 0; g < DENSITY_COOLDOWN_INTERVALS; g++) oneGrowthTick(world);

    const afterPhase2 = residentialOf(world);
    expect(afterPhase2.length).toBe(2);
    for (const b of afterPhase2) {
      expect(b.density).toBe(2);
      expect(buildingCapacity(b)).toBe(100); // 2·1·5·10
    }

    // PHASE 3 — both intermediates are now built out; the density bump reset their ages to 0, so
    // run the worst-case merge cooldown (GROWTH_COOLDOWN_INTERVALS + max stagger 6) back out.
    for (let g = 0; g < GROWTH_COOLDOWN_INTERVALS + 6; g++) oneGrowthTick(world);

    const afterPhase3 = residentialOf(world);
    expect(afterPhase3.length).toBe(1);
    const consolidated = afterPhase3[0];
    expect(consolidated.footprint.length).toBe(4);
    expect(consolidated.structureRect).toEqual({ x: X0, y: R_Y, w: 4, h: 1 });
    expect(consolidated.level).toBe(ZONE_MAX_LEVEL);
    expect(consolidated.density).toBe(2);
    expect(buildingCapacity(consolidated)).toBe(200); // conserved: 100 + 100
  });

  it('5-strip multi-generation consolidation conserves the footprint and strands the odd parcel', () => {
    // Five parcels cannot pair evenly, so one is always left over. This pins the shape of that
    // end state — one fully consolidated 4-wide building plus the stranded 1-wide parcel, with
    // every original cell still accounted for.
    //
    // NOT a size-cap test: the end-state pair (4-wide + 1-wide) is rejected by canMerge's gate 7
    // (structureRect widths 4 vs 1) before `mergedW > 4` is ever evaluated, so no rejection here
    // can be attributed to the cap. Attributable cap coverage lives in mergePolicy.test.ts's
    // equal-width 3+3 cases.
    const { world } = setupMergeStrip(5);
    const cells = () => residentialOf(world).map(b => b.footprint.length).sort((a, z) => a - z);

    // PHASE 1 — two disjoint pairs merge; the fifth parcel has no partner.
    oneGrowthTick(world);
    expect(cells()).toEqual([1, 2, 2]);

    // PHASE 2 — both 2-wide intermediates reach their lot's density cap.
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);
    for (let g = 0; g < DENSITY_COOLDOWN_INTERVALS; g++) oneGrowthTick(world);
    const intermediates = residentialOf(world).filter(b => b.footprint.length === 2);
    expect(intermediates.length).toBe(2);
    for (const b of intermediates) expect(b.density).toBe(2);

    // PHASE 3 — the second-generation merge fires once the cooldown runs out.
    for (let g = 0; g < GROWTH_COOLDOWN_INTERVALS + 6; g++) oneGrowthTick(world);

    const steady = residentialOf(world);
    expect(steady.length).toBe(2);
    // 1 + 4 = the 5 cells seeded: no cell was lost or invented across three generations.
    expect(cells()).toEqual([1, 4]);

    const consolidated = steady.find(b => b.footprint.length === 4)!;
    expect(consolidated.structureRect).toEqual({ x: X0, y: R_Y, w: 4, h: 1 });
    expect(buildingCapacity(consolidated)).toBe(200);
    const stranded = steady.find(b => b.footprint.length === 1)!;
    expect(stranded.anchor).toEqual({ x: X0 + 4, y: R_Y });
    expect(buildingCapacity(stranded)).toBe(35);
  });

  it('below the ceiling there is no merge: a level-5 / density-0 pair only merges once density is at its cap', () => {
    // The negative control for canMerge's density-cap gate. Both parcels are at ZONE_MAX_LEVEL
    // with a structureRect that already fills their lot, so EVERY other built-out condition holds
    // — density 0 against a 1-wide lot's cap of 1 is the single rung missing.
    //
    // Isolation comes from an AGE WINDOW, not from demand engineering: a control whose validity
    // depended on a labor balance holding across the flip would be fragile by construction,
    // because the flip itself changes capacity (25 → 35 per parcel) and moves demand with it.
    // The merge cooldown is GROWTH_COOLDOWN_INTERVALS + stagger(id) <= 8 + 6 = 14 while the
    // density cooldown is a flat DENSITY_COOLDOWN_INTERVALS = 24 with no stagger, so ages
    // [14, 24) are merge-eligible but density-ineligible for EVERY id — a 10-pass window that
    // needs no id pinning. Seeding at age 20 leaves 3 negative passes inside it; the POSITIVE
    // pass then lands at age exactly 24, ON the density-cooldown boundary. That is harmless
    // only because the flip has already put density at 1, which IS the 1-wide lot's cap, so the
    // bump branch's `density < maxDensityForLot` test is false and the merge is still the only
    // event that can fire. Seed any lower and the density branch would fire first.
    const { world, ids } = setupMergeStrip(2);
    const map = world.getMap();
    const [idA, idB] = ids;

    // Seeded inside the window and derived from the constant that defines its upper edge, so the
    // literal and the prose above cannot drift apart.
    const SEED_AGE = DENSITY_COOLDOWN_INTERVALS - 4; // 20: merge-eligible, density-ineligible
    const NEGATIVE_PASSES = DENSITY_COOLDOWN_INTERVALS - 1 - SEED_AGE; // 3: last age still 23
    for (const id of ids) {
      const b = map.getBuildings().getBuilding(id)!;
      b.density = 0;
      b.age = SEED_AGE;
    }
    world.markLaborDirty();
    // 2 × 25 workers (1·1·5·5) before the flip, 2 × 35 after, against 585 reachable jobs — so
    // unemployment is 0 and the MIGRATION_PRESSURE floor holds residential demand positive on
    // BOTH sides of the flip. The merge gate needs nothing more than that.
    expect(world.getLaborMarket().getUnemployed()).toBe(0);
    expect(world.getDemand().residential).toBeGreaterThan(GROWTH_DEMAND_THRESHOLD);
    for (const id of ids) expect(buildingCapacity(map.getBuildings().getBuilding(id)!)).toBe(25);

    for (let g = 0; g < NEGATIVE_PASSES; g++) {
      oneGrowthTick(world);
      const a = map.getBuildings().getBuilding(idA);
      const b = map.getBuildings().getBuilding(idB);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      // Still inside the window: no density bump could have fired, so density 0 is genuinely
      // what canMerge rejected.
      expect(a!.age).toBeLessThan(DENSITY_COOLDOWN_INTERVALS);
      expect(a!.density).toBe(0);
      expect(b!.density).toBe(0);
      expect(a!.abandoned).toBe(false);
      expect(b!.abandoned).toBe(false);
    }

    // Flip the one missing rung by hand — nothing else about the pair changes.
    for (const id of ids) map.getBuildings().getBuilding(id)!.density = 1;
    for (const id of ids) {
      expect(map.getBuildings().getBuilding(id)!.age).toBe(DENSITY_COOLDOWN_INTERVALS - 1);
    }
    world.markLaborDirty();
    expect(world.getDemand().residential).toBeGreaterThan(GROWTH_DEMAND_THRESHOLD);

    oneGrowthTick(world);

    expect(map.getBuildings().getBuilding(idA)).toBeNull();
    expect(map.getBuildings().getBuilding(idB)).toBeNull();
    const merged = residentialOf(world);
    expect(merged.length).toBe(1);
    expect(merged[0].structureRect).toEqual({ x: X0, y: R_Y, w: 2, h: 1 });
    expect(buildingCapacity(merged[0])).toBe(70); // conserved: 35 + 35
  });

  it('demand-dirty on merge tick: markDemandDirty is called exactly twice (pre-pass + post-merge)', () => {
    const { world } = setupMergeStrip(2);

    const spy = vi.spyOn(world, 'markDemandDirty');

    oneGrowthTick(world);

    // Exactly two calls per merge tick:
    // 1. growth-pass start (pre demandVec computation)
    // 2. post-merge markLaborDirty() cascade → markDemandDirty()
    // (The redundant explicit markDemandDirty/markTrafficDirty before markLaborDirty
    // were collapsed to a single markLaborDirty call, so the count is exactly 2.)
    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });

  it('bulldoze regression: bulldozing anchor of a 2×4 merged building removes all 8 cells', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();

    // Place zone tiles for the 2×4 footprint: columns x=0,1, rows y=0..3
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 4; y++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
      }
    }
    // Road to south for road-access and money deduction during bulldoze
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD));
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));

    // Directly add a 2×4 merged building
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [
        { x: 0, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: 1 }, { x: 1, y: 1 },
        { x: 0, y: 2 }, { x: 1, y: 2 },
        { x: 0, y: 3 }, { x: 1, y: 3 },
      ],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      // Full 2×4 structureRect pinned to south (y+h = 0+4 = lot.y+lot.h)
      structureRect: { x: 0, y: 0, w: 2, h: 4 },
    });
    expect(building).not.toBeNull();
    const buildingId = building!.id;

    // Bulldoze the anchor tile (0,0)
    executeClick(Tool.BULLDOZE, { x: 0, y: 0 }, world);

    // Building is gone from BuildingMap
    expect(map.getBuildings().getBuilding(buildingId)).toBeNull();

    // All 8 footprint cells are now unowned
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 4; y++) {
        expect(map.getBuildings().getBuildingAt(x, y)).toBeNull();
      }
    }
  });
});
