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
    // Map wide enough: n R lots + 2 industrial seeders.
    // Decision-A: height bumped to 7 so tower (0,5)-(1,6) fits adjacent to road y=4.
    const world = new World(n + 2, 7, { regenerate: false });
    const map = world.getMap();

    // Road row at y=4
    for (let x = 0; x < n + 2; x++) {
      map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
    }

    // R-zone cells for each lot: column x, rows y=0..3
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < 4; y++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
      }
    }

    // Seed R buildings: level=MERGE_LEVEL_THRESHOLD, full structureRect, age past cooldown.
    // Use addExistingBuilding with explicit ids so we can track them.
    const ids: number[] = [];
    for (let x = 0; x < n; x++) {
      const id = x; // ids 0..n-1
      const ok = map.getBuildings().addExistingBuilding({
        id,
        type: 'residential',
        footprint: [
          { x, y: 0 }, { x, y: 1 }, { x, y: 2 }, { x, y: 3 },
        ],
        anchor: { x, y: 0 },
        level: MERGE_LEVEL_THRESHOLD,
        density: 0,
        // age must satisfy canMerge for any building id (max stagger = 6).
        // After Branch B's age+= 1 the age becomes 15, which exceeds
        // GROWTH_COOLDOWN_INTERVALS + 6 = 14 (worst-case stagger).
        // No coverage stations are placed here, so the four service AND-gates block
        // Branch B (level-up) regardless of land value — leaving the buildings at
        // MERGE_LEVEL_THRESHOLD to merge. (Land value is also low: with serviceScore=0,
        // anchor row 0 / road row 4 is road-dist 4 → 0.40 * (1-4/7) ≈ 0.17.)
        // The merge pass (Branch B'') is NOT coverage-gated, so the merge still fires.
        age: GROWTH_COOLDOWN_INTERVALS + 6,
        abandoned: false,
        frontage: 'S',
        // Full 1×4 structureRect pinned to south (y+h = 0+4 = lot.y+lot.h)
        structureRect: { x, y: 0, w: 1, h: 4 },
      });
      expect(ok).toBe(true);
      ids.push(id);
    }

    // Seed two industrial buildings on the road row to drive residential demand >= 0.6.
    // jobsLevels = 4+4 = 8, levelSumR = n * MERGE_LEVEL_THRESHOLD = n*2.
    // For n=2: residential = (8-4)/8+0.25 = 0.75 >= 0.6. For n>2 demand is lower but
    // we'll use level=8 per industrial to always satisfy the gate.
    map.getBuildings().addExistingBuilding({
      id: n,
      type: 'industrial',
      footprint: [{ x: n, y: 4 }],
      anchor: { x: n, y: 4 },
      level: 8,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'N',
      structureRect: { x: n, y: 4, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: n + 1,
      type: 'industrial',
      footprint: [{ x: n + 1, y: 4 }],
      anchor: { x: n + 1, y: 4 },
      level: 8,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'N',
      structureRect: { x: n + 1, y: 4, w: 1, h: 1 },
    });

    // Plant at (n, 3)–(n+1, 4): cell (n,4) ROAD adj to (n,3) → all road y=4 powered.
    // Building footprint cells at y=3 are then powered via adjacency to road y=4.
    seedPower(world, n, 3);
    // Decision-A: tower at (0,5)–(1,6): (0,5) adj to (0,4)=ROAD → waters road y=4; zone cells y=0..3 adj y=4 → watered.
    seedWater(world, 0, 5);
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

    // structureRect = bbox union of two 1×4 full structureRects → 2×4
    expect(merged.structureRect).toEqual({ x: 0, y: 0, w: 2, h: 4 });
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
