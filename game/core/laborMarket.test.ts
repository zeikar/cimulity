import { describe, it, expect } from 'vitest';
import {
  computeLaborMarket,
  JOBS_PER_LEVEL,
  WORKERS_PER_LEVEL,
} from './laborMarket';
import { GameMap } from './Map';
import { BuildingMap, type BuildingType } from './Building';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';
import type { Frontage } from './buildingFootprint';

// ---------------------------------------------------------------------------
// Helpers (mirrors trafficAssignment.test / roadGraph.test fixtures)
// ---------------------------------------------------------------------------

function makeMap(
  w: number,
  h: number,
  roads: Array<{ x: number; y: number }>,
): GameMap {
  const map = new GameMap(w, h);
  for (const { x, y } of roads) {
    map.setTile(x, y, createTile(x, y, TileType.ROAD));
  }
  return map;
}

function addBuilding(
  bm: BuildingMap,
  x: number,
  y: number,
  type: BuildingType,
  frontage: Frontage,
  opts: { level?: number; abandoned?: boolean } = {},
) {
  return bm.addBuilding({
    type,
    level: opts.level ?? 1,
    density: 0,
    age: 0,
    abandoned: opts.abandoned ?? false,
    frontage,
    footprint: [{ x, y }],
    anchor: { x, y },
    structureRect: { x, y, w: 1, h: 1 },
  });
}

const idxOf = (w: number, x: number, y: number) => y * w + x;

/** A straight road row at `y` spanning `[x0, x1]` inclusive. */
function roadRow(y: number, x0: number, x1: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

/** Sum of non-abandoned residential workers across a BuildingMap. */
function totalResidentialWorkers(bm: BuildingMap): number {
  let sum = 0;
  for (const b of bm.iterBuildings()) {
    if (b.abandoned) continue;
    if (b.type !== 'residential') continue;
    sum += b.level * WORKERS_PER_LEVEL;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// computeLaborMarket
// ---------------------------------------------------------------------------

describe('computeLaborMarket — basis constants', () => {
  it('exposes tunable per-level basis values', () => {
    expect(JOBS_PER_LEVEL).toBe(1);
    expect(WORKERS_PER_LEVEL).toBe(1);
  });
});

describe('computeLaborMarket — empty world', () => {
  it('yields an all-zero result with no buildings or roads', () => {
    const map = new GameMap(8, 8);
    const sm = new StructureMap(8, 8);
    const bm = new BuildingMap(8, 8);
    const r = computeLaborMarket(map, sm, bm);
    expect(r.flows).toEqual([]);
    expect(r.employed).toBe(0);
    expect(r.unemployed).toBe(0);
    expect(r.jobsCapacity).toBe(0);
    expect(r.jobsFilled).toBe(0);
  });
});

describe('computeLaborMarket — single R → single C', () => {
  it('fully employs workers when workers ≤ capacity', () => {
    // Residential at (1,0) frontage S → access (1,1).
    // Commercial at (5,0) frontage S → access (5,1), level 3 → capacity 3.
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 2 });
    addBuilding(bm, 5, 0, 'commercial', 'S', { level: 3 });

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(2);
    expect(r.unemployed).toBe(0);
    expect(r.jobsCapacity).toBe(3);
    expect(r.jobsFilled).toBe(2);
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0]).toEqual({
      originNode: idxOf(w, 1, 1),
      destNode: idxOf(w, 5, 1),
      count: 2,
    });
    expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
  });
});

describe('computeLaborMarket — workers exceed total capacity', () => {
  it('employs only the matchable capacity and marks the rest unemployed', () => {
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 5 }); // 5 workers
    addBuilding(bm, 5, 0, 'commercial', 'S', { level: 2 }); // 2 jobs

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(2);
    expect(r.unemployed).toBe(3);
    expect(r.jobsCapacity).toBe(2);
    expect(r.jobsFilled).toBe(2);
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0].count).toBe(2);
    expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
  });
});

describe('computeLaborMarket — overflow spills to the farther job', () => {
  it('fills the nearer job then spills the remainder to the farther one', () => {
    // Origin access (5,1). Near commercial access (3,1) — 2 hops, capacity 1.
    // Far industrial access (9,1) — 4 hops, capacity 5. Road row y=1 x=3..9.
    // Origin has 4 workers → near=1 (full), far=3 (remainder).
    const w = 14;
    const map = makeMap(w, 8, roadRow(1, 3, 9));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 5, 0, 'residential', 'S', { level: 4 });
    addBuilding(bm, 3, 0, 'commercial', 'S', { level: 1 }); // near, cap 1
    addBuilding(bm, 9, 0, 'industrial', 'S', { level: 5 }); // far, cap 5

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(4);
    expect(r.unemployed).toBe(0);
    expect(r.jobsCapacity).toBe(6);
    expect(r.jobsFilled).toBe(4);
    expect(r.flows).toHaveLength(2);

    const near = r.flows.find((f) => f.destNode === idxOf(w, 3, 1));
    const far = r.flows.find((f) => f.destNode === idxOf(w, 9, 1));
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    expect(near!.count).toBe(1); // nearer job filled to its capacity
    expect(far!.count).toBe(3); // remainder spills to the farther job
    expect(near!.destNode).not.toBe(far!.destNode);
    expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
  });
});

describe('computeLaborMarket — abandoned buildings', () => {
  it('abandoned R contributes no workers; abandoned C adds no capacity', () => {
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 3, abandoned: true });
    addBuilding(bm, 5, 0, 'commercial', 'S', { level: 4, abandoned: true });

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(0);
    expect(r.unemployed).toBe(0);
    expect(r.jobsCapacity).toBe(0);
    expect(r.jobsFilled).toBe(0);
    expect(r.flows).toEqual([]);
    expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
  });
});

describe('computeLaborMarket — no-road-access residential', () => {
  it('counts a road-less residential as unemployed with no flow', () => {
    // Road only WEST of both; frontage S → neither has a frontage-face road.
    const w = 10;
    const map = makeMap(w, 8, [
      { x: 0, y: 3 }, // west of residential (1,3)
      { x: 4, y: 3 }, // west of commercial (5,3)
    ]);
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 3, 'residential', 'S', { level: 2 });
    addBuilding(bm, 5, 3, 'commercial', 'S', { level: 4 });

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(0);
    expect(r.unemployed).toBe(2);
    expect(r.flows).toEqual([]);
    // The commercial also has no access → not in capByNode but still counted.
    expect(r.jobsCapacity).toBe(4);
    expect(r.jobsFilled).toBe(0);
    expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
  });
});

describe('computeLaborMarket — no-road-access commercial', () => {
  it('raises jobsCapacity but leaves jobsFilled unchanged', () => {
    // R has road access (1,1). The only C has no frontage-face road, so its
    // capacity counts toward jobsCapacity but can never be matched.
    const w = 10;
    const map = makeMap(w, 8, [
      { x: 1, y: 1 }, // R access (frontage S)
      { x: 4, y: 5 }, // west of C (5,5) — but C frontage is S → no access
    ]);
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 2 });
    addBuilding(bm, 5, 5, 'commercial', 'S', { level: 4 });

    const r = computeLaborMarket(map, sm, bm);

    expect(r.jobsCapacity).toBe(4); // includes the no-access C
    expect(r.jobsFilled).toBe(0); // never matched
    expect(r.employed).toBe(0);
    expect(r.unemployed).toBe(2); // the R worker has no reachable job
    expect(r.flows).toEqual([]);
    expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
  });
});

describe('computeLaborMarket — no reachable job', () => {
  it('leaves all workers unemployed when segments are disconnected', () => {
    // Origin segment and job segment are separate road cells.
    const w = 12;
    const map = makeMap(w, 8, [
      { x: 1, y: 1 }, // R access only
      { x: 9, y: 1 }, // C access only — separate segment
    ]);
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 3 });
    addBuilding(bm, 9, 0, 'commercial', 'S', { level: 5 });

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(0);
    expect(r.unemployed).toBe(3);
    expect(r.jobsCapacity).toBe(5);
    expect(r.jobsFilled).toBe(0);
    expect(r.flows).toEqual([]);
    expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
  });
});

describe('computeLaborMarket — deterministic origin order', () => {
  it('the lower (node,id) origin wins a single scarce job', () => {
    // Two residentials compete for one capacity-1 job. The origin with the
    // lower access-node index must be served first.
    // Road row y=1 x=1..5. R-A access (1,1), R-B access (5,1), C access (3,1).
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 }); // access (1,1) — lower node
    addBuilding(bm, 5, 0, 'residential', 'S', { level: 1 }); // access (5,1) — higher node
    addBuilding(bm, 3, 0, 'commercial', 'S', { level: 1 }); // single scarce job

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(1);
    expect(r.unemployed).toBe(1);
    expect(r.jobsCapacity).toBe(1);
    expect(r.jobsFilled).toBe(1);
    expect(r.flows).toHaveLength(1);
    // Lower access-node origin (1,1) wins.
    expect(r.flows[0].originNode).toBe(idxOf(w, 1, 1));
    expect(r.flows[0].destNode).toBe(idxOf(w, 3, 1));
    expect(r.flows[0].count).toBe(1);
    expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
  });
});

describe('computeLaborMarket — reachableUnfilledJobs', () => {
  it('counts leftover capacity at reached job nodes when connected', () => {
    // R at (1,0) level-1 → 1 worker; C at (5,0) level-2 → 2 job slots.
    // After matching: 1 worker fills 1 slot, 1 slot remains reachable+unfilled.
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
    addBuilding(bm, 5, 0, 'commercial', 'S', { level: 2 });

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(1);
    expect(r.reachableUnfilledJobs).toBe(1);
  });

  it('is zero when the job node is unreachable (disconnected road segments)', () => {
    // R access isolated from C access — BFS never visits the C node.
    const w = 12;
    const map = makeMap(w, 8, [
      { x: 1, y: 1 }, // R access only
      { x: 9, y: 1 }, // C access only — separate segment
    ]);
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
    addBuilding(bm, 9, 0, 'commercial', 'S', { level: 2 });

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(0);
    expect(r.reachableUnfilledJobs).toBe(0);
  });
});

describe('computeLaborMarket — level-0 residential (0 workers)', () => {
  it('a level-0 residential must not inflate reachableUnfilledJobs', () => {
    // Level-0 residential has 0 workers. Even though it has a road access node,
    // it must not run the BFS and must not mark the adjacent commercial capacity
    // as "reachable". Without the guard this phantom BFS would set
    // reachableUnfilledJobs > 0 despite there being no workers.
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 0 }); // 0 workers
    addBuilding(bm, 5, 0, 'commercial', 'S', { level: 2 });  // reachable if BFS runs

    const r = computeLaborMarket(map, sm, bm);

    expect(r.employed).toBe(0);
    expect(r.unemployed).toBe(0);
    expect(r.reachableUnfilledJobs).toBe(0); // must NOT be inflated by a 0-worker BFS
    expect(r.flows).toEqual([]);
    expect(r.jobsCapacity).toBe(2); // C capacity still counts in total
  });
});

describe('computeLaborMarket — conservation across fixtures', () => {
  it('employed + unemployed equals total residential workers in every fixture', () => {
    const w = 14;
    const fixtures: BuildingMap[] = [];

    // Fixture A: surplus jobs.
    {
      const bm = new BuildingMap(w, 8);
      addBuilding(bm, 1, 0, 'residential', 'S', { level: 3 });
      addBuilding(bm, 5, 0, 'commercial', 'S', { level: 9 });
      fixtures.push(bm);
    }
    // Fixture B: scarce jobs + a no-access residential.
    {
      const bm = new BuildingMap(w, 8);
      addBuilding(bm, 1, 0, 'residential', 'S', { level: 4 });
      addBuilding(bm, 7, 7, 'residential', 'S', { level: 2 }); // no road access
      addBuilding(bm, 5, 0, 'commercial', 'S', { level: 1 });
      fixtures.push(bm);
    }

    const map = makeMap(w, 8, roadRow(1, 1, 9));
    const sm = new StructureMap(w, 8);
    for (const bm of fixtures) {
      const r = computeLaborMarket(map, sm, bm);
      expect(r.employed + r.unemployed).toBe(totalResidentialWorkers(bm));
    }
  });
});
