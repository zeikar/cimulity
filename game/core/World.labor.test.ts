import { describe, it, expect } from 'vitest';
import { World, TRAFFIC_INTERVAL } from './World';
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

      expect(world.getEmployed()).toBe(1);
      expect(world.getUnemployed()).toBe(0);
      expect(world.getJobsCapacity()).toBe(1);
    });

    it('reports leftover workers as unemployed when jobs are scarce', () => {
      const world = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 2 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      world.markLaborDirty();

      // 2 workers, 1 job → 1 employed, 1 unemployed.
      expect(world.getEmployed()).toBe(1);
      expect(world.getUnemployed()).toBe(1);
      expect(world.getJobsCapacity()).toBe(1);
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
      expect(fresh.getEmployed()).toBe(1);
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
      expect(world.getEmployed()).toBe(1);

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
      // Scarce jobs: 3 residential workers, 1 job → only 1 commute → low total load.
      const scarce = makeWorldWithRoadRow([
        { id: 1, type: 'residential', x: 0, level: 3 },
        { id: 2, type: 'commercial', x: 5, level: 1 },
      ]);
      scarce.markTrafficDirty();
      const scarceLoad = totalCongestion(scarce);

      // Ample jobs: same 3 workers, 3 jobs → all 3 commute → higher total load.
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

    // Warm demand in the connected state (R=1, C level 2 ⇒ structural feedback present).
    world.markLaborDirty();
    const connectedResidential = world.getDemand().residential;

    // Sever the road row — building LEVELS unchanged, only reachability changes.
    const map = world.getMap();
    map.setTile(3, 2, createTile(3, 2, TileType.GRASS));

    // Call ONLY markLaborDirty (NOT markDemandDirty directly).
    // The cascade inside markLaborDirty must also set demandDirty so the next
    // getDemand() recomputes with the severed labor state.
    world.markLaborDirty();

    const severedResidential = world.getDemand().residential;

    // Disconnected ⇒ unemploymentRate=1, reachableVacancyRate=0 ⇒ residentialSignal=-1
    // ⇒ residential demand is lower than the connected value.
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
    // No buildings ⇒ all structural terms are 0.25 and labor signals are 0.
    const demand = world.getDemand();
    expect(demand.residential).toBeCloseTo(0.25);
    expect(demand.commercial).toBeCloseTo(0.25);
    expect(demand.industrial).toBeCloseTo(0.25);
  });

  it('road-less residents-only city keeps C/I demand at max', () => {
    // No road row → no labor reachability → employed=0, reachableUnfilledJobs=0.
    // With only residential buildings, jobsLevels=0 → structuralC and structuralI
    // both saturate to ≥1 before clamping, and the positive jobsSignal pushes them
    // further above 1 → clamped to 1.0.
    const world = new World(8, 6, { regenerate: false });
    const map = world.getMap();
    // Add two residential buildings directly (no road, so no road access — building
    // levels are non-zero so structural demand for jobs is real).
    map.getBuildings().addExistingBuilding({
      id: 1, type: 'residential',
      footprint: [{ x: 2, y: 2 }], anchor: { x: 2, y: 2 },
      level: 2, density: 0, age: 0, abandoned: false, frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });

    world.markLaborDirty();

    expect(world.getDemand().commercial).toBe(1);
    expect(world.getDemand().industrial).toBe(1);
  });

  it('reset zeroes the labor feedback', () => {
    const world = makeConnectedFixture();
    world.markLaborDirty();
    // Confirm demand is non-baseline in the connected state.
    const before = world.getDemand().residential;
    expect(before).toBeGreaterThan(0.25);

    world.reset({ regenerate: false });

    const demand = world.getDemand();
    expect(demand.residential).toBeCloseTo(0.25);
    expect(demand.commercial).toBeCloseTo(0.25);
    expect(demand.industrial).toBeCloseTo(0.25);
  });
});
