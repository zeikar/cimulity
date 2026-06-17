import { describe, it, expect } from 'vitest';
import { LaborMarketMap } from './LaborMarketMap';
import { GameMap } from './Map';
import { BuildingMap, type BuildingType } from './Building';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';
import type { Frontage } from './buildingFootprint';

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LaborMarketMap', () => {
  describe('initial state', () => {
    it('a fresh instance reports zero everywhere and no flows', () => {
      const lm = new LaborMarketMap();
      expect(lm.getEmployed()).toBe(0);
      expect(lm.getUnemployed()).toBe(0);
      expect(lm.getJobsCapacity()).toBe(0);
      expect(lm.getJobsFilled()).toBe(0);
      expect(lm.getReachableUnfilledJobs()).toBe(0);
      expect(lm.getFlows()).toEqual([]);
    });
  });

  describe('recompute — seeded R/C scenario', () => {
    it('populates getters and matched flows from a single R→C pair', () => {
      // Residential (1,0) frontage S → access (1,1). Commercial (5,0) frontage S
      // → access (5,1). Road row y=1 connects them.
      const w = 10;
      const map = makeMap(w, 8, roadRow(1, 1, 5));
      const sm = new StructureMap(w, 8);
      const bm = new BuildingMap(w, 8);
      addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
      addBuilding(bm, 5, 0, 'commercial', 'S', { level: 1 });

      const lm = new LaborMarketMap();
      lm.recompute(map, sm, bm);

      expect(lm.getEmployed()).toBe(1);
      expect(lm.getUnemployed()).toBe(0);
      expect(lm.getJobsCapacity()).toBe(1);
      expect(lm.getJobsFilled()).toBe(1);
      expect(lm.getReachableUnfilledJobs()).toBe(0);

      const flows = lm.getFlows();
      expect(flows).toHaveLength(1);
      expect(flows[0]).toEqual({
        originNode: idxOf(w, 1, 1),
        destNode: idxOf(w, 5, 1),
        count: 1,
      });
    });

    it('counts leftover workers as unemployed when jobs are scarce', () => {
      // Two residential workers, one commercial job → one matched, one unemployed.
      const w = 12;
      const map = makeMap(w, 8, roadRow(1, 1, 7));
      const sm = new StructureMap(w, 8);
      const bm = new BuildingMap(w, 8);
      addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
      addBuilding(bm, 3, 0, 'residential', 'S', { level: 1 });
      addBuilding(bm, 7, 0, 'commercial', 'S', { level: 1 });

      const lm = new LaborMarketMap();
      lm.recompute(map, sm, bm);

      expect(lm.getEmployed()).toBe(1);
      expect(lm.getUnemployed()).toBe(1);
      expect(lm.getJobsCapacity()).toBe(1);
      expect(lm.getJobsFilled()).toBe(1);
      expect(lm.getFlows()).toHaveLength(1);
    });

    it('reports reachableUnfilledJobs === 1 for a connected 1R + level-2 C scenario', () => {
      // 1 worker reaches a level-2 C (2 slots), fills 1 → 1 slot remains reachable+unfilled.
      const w = 10;
      const map = makeMap(w, 8, roadRow(1, 1, 5));
      const sm = new StructureMap(w, 8);
      const bm = new BuildingMap(w, 8);
      addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
      addBuilding(bm, 5, 0, 'commercial', 'S', { level: 2 });

      const lm = new LaborMarketMap();
      lm.recompute(map, sm, bm);

      expect(lm.getEmployed()).toBe(1);
      expect(lm.getReachableUnfilledJobs()).toBe(1);
    });
  });

  describe('clear()', () => {
    it('zeroes every getter and empties the flows after a populated recompute', () => {
      const w = 10;
      const map = makeMap(w, 8, roadRow(1, 1, 5));
      const sm = new StructureMap(w, 8);
      const bm = new BuildingMap(w, 8);
      addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
      addBuilding(bm, 5, 0, 'commercial', 'S', { level: 1 });

      const lm = new LaborMarketMap();
      lm.recompute(map, sm, bm);
      expect(lm.getEmployed()).toBe(1);

      lm.clear();

      expect(lm.getEmployed()).toBe(0);
      expect(lm.getUnemployed()).toBe(0);
      expect(lm.getJobsCapacity()).toBe(0);
      expect(lm.getJobsFilled()).toBe(0);
      expect(lm.getReachableUnfilledJobs()).toBe(0);
      expect(lm.getFlows()).toEqual([]);
    });
  });
});
