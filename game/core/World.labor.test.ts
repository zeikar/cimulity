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
