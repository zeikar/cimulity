import { describe, it, expect, vi } from 'vitest';
import { World, ZONE_GROWTH_INTERVAL } from './World';
import { GROWTH_COOLDOWN_INTERVALS } from './growthConstants';
import { MERGE_LEVEL_THRESHOLD } from './mergePolicy';
import { DENSITY_DEMAND_THRESHOLD } from './Demand';
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

describe("World.tick() — merge (Branch B'')", () => {
  // Shared helper: build a world with N side-by-side 1×4 R lots, frontage='S',
  // road at y=4, all merge-eligible. Returns { world, map, ids } where ids[i]
  // is the BuildingMap id of the i-th building (x=i).
  //
  // Demand is driven high by a bank of industrial buildings whose frontage faces the SAME
  // road row the R lots front, so their jobs are road-reachable from the R access nodes.
  //
  // Buildings start at level=MERGE_LEVEL_THRESHOLD, full structureRect (1×4),
  // age = GROWTH_COOLDOWN_INTERVALS - 1 so that after Branch B's age++ they
  // hit exactly the cooldown and canMerge's age gate passes.
  function setupMergeStrip(n: number): {
    world: World;
    ids: number[];
  } {
    // Layout (abandonment-aware, Task 4): the n R lots sit on rows 1..4 fronting a
    // road at y=5, with a park ROW at y=0 directly north of each anchor. The park
    // boost lifts every R anchor to lv ≈ 0.405 — above LEVEL_THRESHOLDS[2]=0.25 so
    // the abandonment sweep leaves the level-2 buildings alone, yet below
    // LEVEL_THRESHOLDS[3]=0.45 so no level-up resets age before the merge pass.
    // (Crucially, NO service stations sit near the R lots, so Branch B level-up is
    // also AND-gated off regardless of land value.) The merge pass (Branch B'')
    // is not abandonment-gated, so the merge fires.
    //
    // Residential demand is driven by a bank of level-2 industrials on the row SOUTH of the
    // R road row, frontage 'N' — their access node IS that road row, so the R buildings' BFS
    // reaches every one of them. Reachability is now the requirement an isolated cluster could
    // never satisfy: unreachable jobs are invisible to the labor market, every resident would
    // be unemployed, and residential demand would read 0.00. Level 2 needs only
    // LEVEL_THRESHOLDS[2] = 0.25, which bare road frontage (lv ≈ 0.34) clears, so the
    // abandonment sweep never touches them; and they add NO road, so the R anchors' land value
    // is untouched. At n = 5 the bank is 14 × 20 = 280 jobs against 100 workers → net 180 on a
    // market of 280 → residential saturates at 1.0.
    const W = Math.max(n + 2, 16);
    const H = 16;
    const world = new World(W, H, { regenerate: false });
    const map = world.getMap();
    const sm = world.getStructureMap();

    // R road row at y=5.
    for (let x = 0; x < W; x++) map.setTile(x, 5, createTile(x, 5, TileType.ROAD));
    // R-zone cells for each lot: column x, rows y=1..4.
    for (let x = 0; x < n; x++) {
      for (let y = 1; y < 5; y++) map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
    }
    // Park row north of the anchors (y=0) — additive land-value boost.
    for (let x = 0; x < n; x++) {
      expect(sm.addStructure({ type: 'park', anchor: { x, y: 0 }, footprint: [{ x, y: 0 }] })).not.toBeNull();
    }

    // Seed R buildings: level=MERGE_LEVEL_THRESHOLD, full structureRect, age past cooldown.
    const ids: number[] = [];
    for (let x = 0; x < n; x++) {
      const id = x; // ids 0..n-1
      const ok = map.getBuildings().addExistingBuilding({
        id,
        type: 'residential',
        footprint: [
          { x, y: 1 }, { x, y: 2 }, { x, y: 3 }, { x, y: 4 },
        ],
        anchor: { x, y: 1 },
        level: MERGE_LEVEL_THRESHOLD,
        density: 0,
        // age must satisfy canMerge for any building id (max stagger = 6).
        // After Branch B's age++ the age becomes 15, exceeding
        // GROWTH_COOLDOWN_INTERVALS + 6 = 14 (worst-case stagger).
        age: GROWTH_COOLDOWN_INTERVALS + 6,
        abandoned: false,
        frontage: 'S',
        // Full 1×4 structureRect pinned to south (y+h = 1+4 = lot.y+lot.h).
        structureRect: { x, y: 1, w: 1, h: 4 },
      });
      expect(ok).toBe(true);
      ids.push(id);
    }

    // Reachable job bank at y=6: one level-2 industrial per column the power plant does not
    // own, each fronting 'N' onto the R road row at y=5. Modal 1x2 structureRect (extended
    // SOUTH into the free row y=7, away from the frontage — the power plant only owns
    // (W-2,7)/(W-1,7), outside this x range) so buildingCapacity(level 2) = 1*2*2*5 = 20 each,
    // matching this fixture's pre-buildingCapacity arithmetic (14 * 20 = 280 total jobs). The R
    // lots keep their full 1×4 sr (needed for the structureRect-union assertions below), so
    // buildingCapacity(level MERGE_LEVEL_THRESHOLD=2) = 1*4*2*5 = 40 each — bigger than before,
    // but the bank's fixed 280-job total still comfortably exceeds even 5 R lots' 200 workers.
    for (let x = 0; x < W - 2; x++) {
      map.setTile(x, 6, createTile(x, 6, TileType.ZONE_INDUSTRIAL));
      expect(map.getBuildings().addExistingBuilding({
        id: n + x,
        type: 'industrial',
        footprint: [{ x, y: 6 }, { x, y: 7 }],
        anchor: { x, y: 6 },
        level: 2,
        density: 0,
        age: 0,
        abandoned: false,
        frontage: 'N',
        structureRect: { x, y: 6, w: 1, h: 2 },
      })).toBe(true);
    }

    // R power: plant at (W-2,6)-(W-1,7); cell (W-2,6) adj road (W-2,5) → powers the
    // R road row, powering the y=4 R footprint cells via adjacency.
    seedPower(world, W - 2, 6);
    // R water: tower at (W-1,4); (W-1,4) adj road (W-1,5) → waters the R road row;
    // R footprint cells at y=4 adj the road → watered.
    seedWater(world, W - 1, 4);

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
    world.markDemandDirty();

    // Preconditions, asserted only now that every road, structure and building exists. Placed
    // mid-helper they would read a labor market that is still missing origins or destinations —
    // reachable jobs are counted from the residential BFS, so both ends must already be in.
    world.recomputeLabor();
    expect(world.getLaborMarket().getReachableUnfilledJobs()).toBeGreaterThan(0);
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(DENSITY_DEMAND_THRESHOLD);
    return { world, ids };
  }

  // Advance world by exactly one growth tick; returns the tick result.
  function oneGrowthTick(world: World): ReturnType<typeof world.tick> {
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    return world.tick();
  }

  it('two-building happy path: two 1×4 R buildings merge into one 2×4 building', () => {
    const { world, ids } = setupMergeStrip(2);
    const map = world.getMap();
    const [idA, idB] = ids;

    const result = oneGrowthTick(world);

    // Both original buildings are gone
    expect(map.getBuildings().getBuilding(idA)).toBeNull();
    expect(map.getBuildings().getBuilding(idB)).toBeNull();

    // Exactly one building remains (the merged one)
    const remaining = [...map.getBuildings().iterBuildings()].filter(
      b => b.type === 'residential',
    );
    expect(remaining.length).toBe(1);
    const merged = remaining[0];

    // Merged footprint covers both lots: 8 cells
    expect(merged.footprint.length).toBe(8);

    // changedBuildingIds contains both old ids and the new merged id
    expect(result.changedBuildingIds).toContain(idA);
    expect(result.changedBuildingIds).toContain(idB);
    expect(result.changedBuildingIds).toContain(merged.id);

    // Level = max of the two (both were MERGE_LEVEL_THRESHOLD)
    expect(merged.level).toBe(Math.max(MERGE_LEVEL_THRESHOLD, MERGE_LEVEL_THRESHOLD));

    // structureRect = bbox union of two 1×4 full structureRects → 2×4 (lots at rows 1..4)
    expect(merged.structureRect).toEqual({ x: 0, y: 1, w: 2, h: 4 });
  });

  it('disjoint-pairs-per-tick: 4 buildings [A B C D] → 2 ticks to 1 building', () => {
    const { world, ids } = setupMergeStrip(4);
    const map = world.getMap();
    const [idA, idB, idC, idD] = ids;

    // Tick 1: A+B merge, C+D merge → 2 residential buildings remain
    oneGrowthTick(world);

    const afterTick1 = [...map.getBuildings().iterBuildings()].filter(
      b => b.type === 'residential',
    );
    expect(afterTick1.length).toBe(2);
    // Each merged building is 2×4
    for (const b of afterTick1) {
      expect(b.footprint.length).toBe(8);
    }

    // Original ids are gone
    expect(map.getBuildings().getBuilding(idA)).toBeNull();
    expect(map.getBuildings().getBuilding(idB)).toBeNull();
    expect(map.getBuildings().getBuilding(idC)).toBeNull();
    expect(map.getBuildings().getBuilding(idD)).toBeNull();

    // Tick 2: the two 2×4 buildings merge → 1 building (4×4) remains.
    // The merged buildings start at age=0. Their new ids have unknown stagger;
    // worst case is stagger=6, so cooldown = GROWTH_COOLDOWN_INTERVALS + 6 = 14.
    // Run 15 growth intervals to guarantee age > max cooldown.
    for (let g = 0; g < GROWTH_COOLDOWN_INTERVALS + 7; g++) oneGrowthTick(world);

    const afterTick2 = [...map.getBuildings().iterBuildings()].filter(
      b => b.type === 'residential',
    );
    expect(afterTick2.length).toBe(1);
    expect(afterTick2[0].footprint.length).toBe(16); // 4×4
  });

  it('5-strip cap: consolidates to at most 4-wide, never produces a 5-wide building', () => {
    // The exact pairing order depends on BuildingMap insertion order, so we assert
    // size constraints rather than specific pairings.
    const { world } = setupMergeStrip(5);
    const map = world.getMap();

    const rBuildings = () =>
      [...map.getBuildings().iterBuildings()].filter(b => b.type === 'residential');

    // Tick 1: two disjoint merges happen → 3 residential buildings remain.
    // Two pairs merge (consuming 4 buildings), one building is left unpaired.
    oneGrowthTick(world);
    const after1 = rBuildings();
    expect(after1.length).toBe(3);
    // Total cells = 5×4 = 20; each merge produces 2×4=8 cells; 1 lone = 1×4=4 cells.
    const cells1 = after1.map(b => b.footprint.length).sort((a, z) => a - z);
    expect(cells1).toEqual([4, 8, 8]);
    // No building wider than 2 lots (8 cells)
    expect(after1.every(b => b.footprint.length <= 8)).toBe(true);

    // Run further growth intervals: keep ticking until no merges happen
    // for several consecutive cycles (steady state).
    let prevCount = after1.length;
    let stableFor = 0;
    for (let g = 0; g < 100 && stableFor < 5; g++) {
      oneGrowthTick(world);
      const current = rBuildings().length;
      if (current === prevCount) {
        stableFor++;
      } else {
        stableFor = 0;
        prevCount = current;
      }
    }

    const steady = rBuildings();
    // At steady state: no building is 5-wide (canMerge rejects mergedW > 4).
    // Total residential footprint cells must still equal 5×4 = 20 (no cells lost).
    const totalCells = steady.reduce((s, b) => s + b.footprint.length, 0);
    expect(totalCells).toBe(20);
    // No building wider than 4 lots (16 cells).
    expect(steady.every(b => b.footprint.length <= 16)).toBe(true);
    // The system cannot shrink below 2 buildings (5 lots → at most one 4-wide + one remaining).
    expect(steady.length).toBeGreaterThanOrEqual(2);
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
      level: MERGE_LEVEL_THRESHOLD,
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
