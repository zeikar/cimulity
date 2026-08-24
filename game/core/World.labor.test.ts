import { describe, it, expect } from 'vitest';
import { World, TRAFFIC_INTERVAL } from './World';
import { POPULATION_PER_TILE_LEVEL } from './growthConstants';
import { TileType, createTile } from './Tile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed an 8×6 world with a road row at y=2 plus the given buildings, and return
 * it. Buildings are hydrated directly via BuildingMap (bypasses growth/dirty).
 */
function makeWorldWithRoadRow(
  buildings: ReadonlyArray<{
    id: number;
    type: 'residential' | 'commercial' | 'industrial';
    x: number;
    level: number;
  }>,
): World {
  const world = new World(8, 6, { regenerate: false });
  const map = world.getMap();
  for (let x = 0; x < 8; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));
  for (const b of buildings) {
    map.getBuildings().addExistingBuilding({
      id: b.id,
      type: b.type,
      footprint: [{ x: b.x, y: 1 }],
      anchor: { x: b.x, y: 1 },
      level: b.level,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S', // access node = road tile (b.x, 2)
      structureRect: { x: b.x, y: 1, w: 1, h: 1 },
    });
  }
  return world;
}

function totalCongestion(world: World): number {
  const raw = world.getTrafficMap().getRaw();
  let sum = 0;
  for (const v of raw) sum += v;
  return sum;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('World labor market wiring', () => {
  describe('getEmployed / getUnemployed / getJobsCapacity', () => {
    it('reports a matched R→C scenario', () => {
      const world = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 1 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      world.markLaborDirty();

      expect(world.getEmployed()).toBe(POPULATION_PER_TILE_LEVEL);
      expect(world.getUnemployed()).toBe(0);
      expect(world.getJobsCapacity()).toBe(POPULATION_PER_TILE_LEVEL);
    });

    it('reports leftover workers as unemployed when jobs are scarce', () => {
      const world = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 2 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      world.markLaborDirty();

      // 2 levels of workers, 1 level of jobs → half matched, half unemployed.
      expect(world.getEmployed()).toBe(POPULATION_PER_TILE_LEVEL);
      expect(world.getUnemployed()).toBe(2 * POPULATION_PER_TILE_LEVEL - POPULATION_PER_TILE_LEVEL);
      expect(world.getJobsCapacity()).toBe(POPULATION_PER_TILE_LEVEL);
    });
  });

  describe('getLaborMarket() — drain-on-read', () => {
    it('returns a stale snapshot until markLaborDirty(), then fresh on the next read', () => {
      const world = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 1 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);

      // First read drains the initial dirty-less state (no flag set yet → empty).
      const initial = world.getLaborMarket();
      expect(initial.getEmployed()).toBe(0);

      // Mark dirty so the next read recomputes the matched scenario.
      world.markLaborDirty();
      const fresh = world.getLaborMarket();
      expect(fresh.getEmployed()).toBe(POPULATION_PER_TILE_LEVEL);
      expect(fresh.getFlows()).toHaveLength(1);
    });
  });

  describe('reset() clears labor', () => {
    it('zeroes employment after reset({regenerate:false})', () => {
      const world = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 1 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      world.markLaborDirty();
      expect(world.getEmployed()).toBe(POPULATION_PER_TILE_LEVEL);

      world.reset({ regenerate: false });

      expect(world.getLaborMarket().getEmployed()).toBe(0);
      expect(world.getLaborMarket().getFlows()).toEqual([]);
    });
  });

  describe('traffic reflects matched flows', () => {
    it('congestion is non-zero on the connecting road after a matched R→C pair', () => {
      const world = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 1 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      world.markTrafficDirty();

      // Origin access node road tile (0,2) must carry load from the matched flow.
      expect(world.getTrafficMap().getCongestion(0, 2)).toBeGreaterThan(0);
    });

    it('workers>jobs yields lower total congestion than jobs≥workers (capacity-limited through World)', () => {
      // Scarce jobs: 3 levels of workers, 1 level of jobs → one partial commute → low load.
      const scarce = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 3 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      scarce.markTrafficDirty();
      const scarceLoad = totalCongestion(scarce);

      // Ample jobs: same 3 levels of workers, 3 of jobs → all commute → higher load.
      const ample = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 3 },
        { id: 2, type: 'commercial', x: 5, level: 3 },
      ]);
      ample.markTrafficDirty();
      const ampleLoad = totalCongestion(ample);

      expect(scarceLoad).toBeGreaterThan(0);
      expect(scarceLoad).toBeLessThan(ampleLoad);
    });
  });

  describe('markLaborDirty() cascades to traffic', () => {
    it('getTrafficMap() reflects new state after ONLY markLaborDirty() — no markTrafficDirty call', () => {
      const world = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 1 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      const map = world.getMap();

      // Warm traffic so the instance is allocated and the baseline is non-zero.
      world.markTrafficDirty();
      const retained = world.getTrafficMap();
      expect(retained.getCongestion(0, 2)).toBeGreaterThan(0);

      // Remove the destination directly via BuildingMap — no dirty calls at all.
      map.getBuildings().removeBuilding(2);

      // Call ONLY markLaborDirty (NOT markTrafficDirty). The cascade must propagate.
      world.markLaborDirty();

      // getTrafficMap() drains trafficDirty → recomputeTraffic → recomputeLabor →
      // fresh flows (empty, destination gone) → rewrite the retained instance → 0.
      world.getTrafficMap();
      expect(retained.getCongestion(0, 2)).toBe(0);
    });
  });

  describe('recomputeTraffic() force-refreshes labor', () => {
    it('reflects building changes made WITHOUT dirtying after the TRAFFIC_INTERVAL cadence', () => {
      const world = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 1 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      const map = world.getMap();

      // Baseline: drain once so traffic is allocated and the cadence force-branch can run.
      world.markTrafficDirty();
      const retained = world.getTrafficMap();
      expect(retained.getCongestion(0, 2)).toBeGreaterThan(0);

      // Remove the destination DIRECTLY via BuildingMap — does NOT call markTrafficDirty
      // or markLaborDirty. Both dirty flags stay false.
      map.getBuildings().removeBuilding(2);

      // Tick to the next TRAFFIC_INTERVAL boundary WITHOUT dirtying. Only the cadence
      // force-recompute can update the retained instance — and it force-refreshes labor
      // first, so the matched-flow set drops the removed destination → load goes to 0.
      const ticksNeeded = TRAFFIC_INTERVAL - (world.getTick() % TRAFFIC_INTERVAL);
      for (let i = 0; i < ticksNeeded; i++) {
        const result = world.tick();
        expect(result.changedBuildingIds).toHaveLength(0);
      }

      expect(retained.getCongestion(0, 2)).toBe(0);
    });
  });
});

describe('World.getPopulation() === getEmployed() + getUnemployed() + getJobsCapacity()', () => {
  it('holds across a modal (1x2), a ribbon (1x1), and a wide (2x2) building', () => {
    // A single ROAD row at y=2. Three buildings, one per structure-area shape:
    //   modal:  lot (0,0)-(0,1), sr 1x2 full lot, level 3 → capacity 1*2*3*5 = 30
    //   ribbon: lot (2,1),       sr 1x1 full lot, level 2 → capacity 1*1*2*5 = 10
    //   wide:   lot (5,0)-(6,1), sr 2x2 full lot, level 4 → capacity 2*2*4*5 = 80
    const world = new World(8, 6, { regenerate: false });
    const map = world.getMap();
    for (let x = 0; x < 8; x++) map.setTile(x, 2, createTile(x, 2, TileType.ROAD));

    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 0, y: 0 }, { x: 0, y: 1 }], anchor: { x: 0, y: 0 },
      level: 3, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 2 },
    });
    map.getBuildings().addExistingBuilding({
      id: 2, type: 'residential',
      footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 },
      level: 2, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 1, w: 1, h: 1 },
    });
    map.getBuildings().addExistingBuilding({
      id: 3, type: 'commercial',
      footprint: [{ x: 5, y: 0 }, { x: 6, y: 0 }, { x: 5, y: 1 }, { x: 6, y: 1 }], anchor: { x: 5, y: 0 },
      level: 4, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 5, y: 0, w: 2, h: 2 },
    });

    world.markLaborDirty();

    const population = world.getPopulation();
    const workforce = world.getEmployed() + world.getUnemployed();
    const jobsCapacity = world.getJobsCapacity();

    // 30 + 10 residential capacity + 80 commercial capacity = 120, split as
    // workforce (40) + jobsCapacity (80) — every worker is matched or unemployed by
    // construction, so this holds regardless of how the labor matcher resolved flows.
    expect(population).toBe(workforce + jobsCapacity);
  });
});

// ---------------------------------------------------------------------------
// World-level demand-feedback integration tests
// ---------------------------------------------------------------------------
// Shared fixture geometry (reuses makeWorldWithRoadRow above):
//   road row at y=2; residential at (0,1) frontage S → access node (0,2);
//   commercial at (5,1) frontage S → access node (5,2).
//   Severing tile (3,2) breaks reachability while leaving building LEVELS intact.
// ---------------------------------------------------------------------------

describe('World demand-feedback integration', () => {
  /** Build the shared connected fixture: R level 1 at x=0, C level 2 at x=5. */
  function makeConnectedFixture(): World {
    return makeWorldWithRoadRow([
      { id: 1, type: 'residential', x: 0, level: 1 },
      { id: 2, type: 'commercial',  x: 5, level: 2 },
    ]);
  }

  it('markLaborDirty() cascades to demand', () => {
    const world = makeConnectedFixture();

    // Warm demand in the connected state: buildingCapacity gives 5 workers (1×1×1×5) against
    // 10 job capacity (1×1×2×5) → 5 reachable unfilled jobs → net 5, which lands EXACTLY on
    // DEADBAND_RATE (5/100 = 0.05) against the MIN_MARKET floor → resSeverity 0. With full
    // employment, residential is driven entirely by migration (0.1).
    world.markLaborDirty();
    const connectedResidential = world.getDemand().residential;
    expect(connectedResidential).toBeCloseTo(0.1, 10);

    // Sever the road row — building LEVELS unchanged, only reachability changes.
    const map = world.getMap();
    map.setTile(3, 2, createTile(3, 2, TileType.GRASS));

    // Call ONLY markLaborDirty (NOT markDemandDirty directly).
    // The cascade inside markLaborDirty must also set demandDirty so the next
    // getDemand() recomputes with the severed labor state.
    world.markLaborDirty();

    const severedResidential = world.getDemand().residential;

    // Severed ⇒ the vacancy surplus becomes 5 unemployed workers: the labor axis flips to
    // workplace pressure and 100% unemployment damps migration to zero.
    expect(severedResidential).toBe(0);
    expect(severedResidential).toBeLessThan(connectedResidential);
  });

  it('getDemand() force-refreshes labor with R/C/I levels held fixed', () => {
    const world = makeConnectedFixture();

    // Warm demand in the connected state.
    world.markLaborDirty();
    const connectedResidential = world.getDemand().residential;

    // Sever the road row — building LEVELS unchanged.
    const map = world.getMap();
    map.setTile(3, 2, createTile(3, 2, TileType.GRASS));

    // Call ONLY markDemandDirty (NOT markLaborDirty).
    // getDemand() must force-refresh labor internally to pick up the severed state.
    world.markDemandDirty();

    const severedResidential = world.getDemand().residential;

    // The only changed input is labor reachability; the drop proves the force-refresh fired.
    expect(severedResidential).toBeLessThan(connectedResidential);
  });

  it('empty-city bootstrap through World', () => {
    const world = new World(8, 6, { regenerate: false });
    // No buildings ⇒ the labor market is empty ⇒ "build homes".
    const demand = world.getDemand();
    expect(demand.residential).toBe(1);
    expect(demand.commercial).toBe(0);
    expect(demand.industrial).toBe(0);
  });

  it('road-less residents-only city pushes both jobs bars up', () => {
    // No road row → no labor reachability → employed=0, reachableUnfilledJobs=0.
    // buildingCapacity(level 2, 1×1 sr, density 0) = 10 road-less workers against the
    // 100-unit MIN_MARKET floor → ratio 0.10 → workplaceSeverity 0.25, halved onto each jobs
    // bar (industrial 0.125). The retail axis sums buildingCapacity (10): targetC =
    // COMMERCIAL_CAPACITY_SHARE · 10 = 2.5, over the retail axis's own
    // `max(targetC, capacitySumC, POPULATION_PER_LEVEL)` floor (10), so retail reads 2.5/10 =
    // 0.25; staffing is undamped (resSeverity 0, since the shortfall is a vacancy surplus, not a
    // worker surplus), so commercial reads max(workplaceSeverity·0.5=0.125, retail=0.25,
    // workplaceFloor=0.1) = 0.25 — the retail axis dominates its own jobs half-share.
    const world = new World(8, 6, { regenerate: false });
    const map = world.getMap();
    // Add a residential building directly (no road, so no road access — its workers are
    // real and unemployable, which is what drives the jobs bars).
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 2, y: 2 }], anchor: { x: 2, y: 2 },
      level: 2, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });

    world.markLaborDirty();

    expect(world.getDemand().commercial).toBe(0.25);
    expect(world.getDemand().industrial).toBeCloseTo(0.125, 10);
  });

  it('reset zeroes the labor feedback', () => {
    // R-only fixture on purpose: the connected R+C fixture reads a nonzero residential on BOTH
    // sides of the reset, so it would discriminate nothing. One road-less level-2 R (1×1 sr)
    // gives buildingCapacity 10 unemployed workers against the MIN_MARKET floor → residential 0 /
    // industrial 0.125 (the identical fixture one test above shows the full arithmetic).
    const world = new World(8, 6, { regenerate: false });
    world.getMap().getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 2, y: 2 }], anchor: { x: 2, y: 2 },
      level: 2, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });
    world.markLaborDirty();
    expect(world.getDemand().residential).toBe(0);
    expect(world.getDemand().industrial).toBeCloseTo(0.125, 10);

    world.reset({ regenerate: false });

    const demand = world.getDemand();
    expect(demand.residential).toBe(1);
    expect(demand.commercial).toBe(0);
    expect(demand.industrial).toBe(0);
  });
});
