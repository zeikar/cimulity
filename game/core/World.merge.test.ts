import { describe, it, expect, vi } from 'vitest';
import { World, ZONE_GROWTH_INTERVAL } from './World';
import { GROWTH_COOLDOWN_INTERVALS } from './growthConstants';
import { MERGE_LEVEL_THRESHOLD } from './mergePolicy';
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
  // Demand is driven high (residential >= 0.6) by two industrial buildings
  // placed at x=N and x=N+1 on the road row (y=4) — they are on ROAD tiles so
  // the zone-growth loop ignores them, but they still count in the demand model.
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
    // Residential demand is driven by an ISOLATED industrial cluster on its own
    // road network at the bottom of the map: four level-5 industrials on land
    // served by all four services + parks (lv ≈ 0.9, so they are not abandoned).
    // Isolating their road keeps their coverage/power from ever reaching the R
    // anchors. jobsLevels = 4×5 = 20 ≥ 3.08·(n·2) for n ≤ 5, so residential demand
    // stays ≥ DENSITY_DEMAND_THRESHOLD across the strip sizes used here.
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

    // Isolated industrial demand cluster: own road row at y=12, four level-5
    // industrials at y=11, all four services at y=13, parks at (0,10)/(2,10).
    for (let x = 0; x < W; x++) map.setTile(x, 12, createTile(x, 12, TileType.ROAD));
    for (let k = 0; k < 4; k++) {
      map.setTile(k, 11, createTile(k, 11, TileType.ZONE_INDUSTRIAL));
      map.getBuildings().addExistingBuilding({
        id: n + k,
        type: 'industrial',
        footprint: [{ x: k, y: 11 }],
        anchor: { x: k, y: 11 },
        level: 5,
        density: 0,
        age: 0,
        abandoned: false,
        frontage: 'S',
        structureRect: { x: k, y: 11, w: 1, h: 1 },
      });
    }
    expect(sm.addStructure({ type: 'police_station', anchor: { x: 6, y: 13 }, footprint: [{ x: 6, y: 13 }, { x: 7, y: 13 }, { x: 6, y: 14 }, { x: 7, y: 14 }] })).not.toBeNull();
    expect(sm.addStructure({ type: 'fire_station', anchor: { x: 8, y: 13 }, footprint: [{ x: 8, y: 13 }, { x: 9, y: 13 }, { x: 8, y: 14 }, { x: 9, y: 14 }] })).not.toBeNull();
    expect(sm.addStructure({ type: 'hospital', anchor: { x: 10, y: 13 }, footprint: [{ x: 10, y: 13 }, { x: 11, y: 13 }, { x: 10, y: 14 }, { x: 11, y: 14 }] })).not.toBeNull();
    expect(sm.addStructure({ type: 'school', anchor: { x: 12, y: 13 }, footprint: [{ x: 12, y: 13 }, { x: 13, y: 13 }, { x: 12, y: 14 }, { x: 13, y: 14 }] })).not.toBeNull();
    expect(sm.addStructure({ type: 'park', anchor: { x: 0, y: 10 }, footprint: [{ x: 0, y: 10 }] })).not.toBeNull();
    expect(sm.addStructure({ type: 'park', anchor: { x: 2, y: 10 }, footprint: [{ x: 2, y: 10 }] })).not.toBeNull();

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

  it('demand-dirty on merge tick: markDemandDirty is called at least twice (pre-pass + post-merge)', () => {
    const { world } = setupMergeStrip(2);

    const spy = vi.spyOn(world, 'markDemandDirty');

    oneGrowthTick(world);

    // At minimum: once at growth-pass start (pre demandVec), once post-merge
    // (because changedBuildingIds.length > 0 after the merge).
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
