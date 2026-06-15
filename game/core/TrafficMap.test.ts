import { describe, it, expect } from 'vitest';
import { TrafficMap } from './TrafficMap';
import { TRAFFIC_CAPACITY } from './trafficAssignment';
import { GameMap } from './Map';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';
import type { CommuteFlow } from './laborMarket';

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

describe('TrafficMap', () => {
  describe('construct → all-zero', () => {
    it('fresh instance has all congestion values at 0', () => {
      const tm = new TrafficMap(8, 8);
      const raw = tm.getRaw();
      expect(raw.length).toBe(64);
      expect(raw.every((v) => v === 0)).toBe(true);
    });

    it('getCongestion returns 0 for every cell before recompute', () => {
      const tm = new TrafficMap(5, 5);
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          expect(tm.getCongestion(x, y)).toBe(0);
        }
      }
    });
  });

  describe('recompute — explicit flows', () => {
    // Road row y=1 from x=1..5. Flow origin (1,1) → dest (5,1), count=1.
    // Expected normalized on any path tile = Math.round(255 * 1 / TRAFFIC_CAPACITY) / 255.
    it('road tile on the path has non-zero normalized congestion after recompute', () => {
      const w = 10;
      const map = makeMap(w, 8, roadRow(1, 1, 5));
      const sm = new StructureMap(w, 8);
      const flows: CommuteFlow[] = [
        { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 5, 1), count: 1 },
      ];

      const tm = new TrafficMap(w, 8);
      tm.recompute(map, sm, flows);

      const expectedRaw = Math.round((255 * 1) / TRAFFIC_CAPACITY);
      const expectedNorm = expectedRaw / 255;
      expect(tm.getCongestion(3, 1)).toBe(expectedRaw);
      expect(tm.getCongestionNormalized(3, 1)).toBeCloseTo(expectedNorm, 10);
    });

    it('non-road tile stays at 0 after recompute', () => {
      const w = 10;
      const map = makeMap(w, 8, roadRow(1, 1, 5));
      const sm = new StructureMap(w, 8);
      const flows: CommuteFlow[] = [
        { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 5, 1), count: 1 },
      ];

      const tm = new TrafficMap(w, 8);
      tm.recompute(map, sm, flows);

      // (0,0) is not a road tile and not on the path.
      expect(tm.getCongestion(0, 0)).toBe(0);
      expect(tm.getCongestionNormalized(0, 0)).toBe(0);
    });
  });

  describe('clear()', () => {
    it('zeroes all values; getCongestion returns 0 everywhere after clear', () => {
      const w = 10;
      const map = makeMap(w, 8, roadRow(1, 1, 5));
      const sm = new StructureMap(w, 8);
      const flows: CommuteFlow[] = [
        { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 5, 1), count: 1 },
      ];

      const tm = new TrafficMap(w, 8);
      tm.recompute(map, sm, flows);

      // Verify something is non-zero before clearing.
      expect(tm.getCongestion(3, 1)).toBeGreaterThan(0);

      tm.clear();

      expect(tm.getCongestion(3, 1)).toBe(0);
      const raw = tm.getRaw();
      for (let i = 0; i < raw.length; i++) {
        expect(raw[i]).toBe(0);
      }
    });
  });

  describe('getCongestion out-of-bounds', () => {
    it('returns 0 for negative coordinates', () => {
      const tm = new TrafficMap(5, 5);
      expect(tm.getCongestion(-1, 0)).toBe(0);
      expect(tm.getCongestion(0, -1)).toBe(0);
    });

    it('returns 0 for coordinates >= dimensions', () => {
      const tm = new TrafficMap(5, 5);
      expect(tm.getCongestion(5, 0)).toBe(0);
      expect(tm.getCongestion(0, 5)).toBe(0);
    });

    it('getCongestionNormalized returns 0 for OOB coords', () => {
      const tm = new TrafficMap(5, 5);
      expect(tm.getCongestionNormalized(-1, 0)).toBe(0);
      expect(tm.getCongestionNormalized(0, 5)).toBe(0);
    });
  });
});
