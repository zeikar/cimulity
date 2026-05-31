import { describe, it, expect, beforeEach } from 'vitest';
import {
  ServiceCoverageMap,
  isAnchorCovered,
  SERVICE_COVERAGE_THRESHOLD_RAW,
} from './ServiceCoverageMap';
import { GameMap } from './Map';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
//
// ServiceCoverageMap.recompute delegates to propagateServiceCoverage (with a
// `police_station` source selector). The full BFS topology matrix lives in
// serviceCoveragePropagation.test.ts — the single source of BFS truth. These
// tests cover only the class surface: delegation wiring, getCoverageNormalized,
// getCoverage OOB, clear(), isAnchorCovered threshold boundary, and
// source-selector isolation.

function makeMap(
  w: number,
  h: number,
  overrides: Array<{ x: number; y: number; type: TileType }>,
): GameMap {
  const map = new GameMap(w, h);
  for (const { x, y, type } of overrides) {
    map.setTile(x, y, createTile(x, y, type));
  }
  return map;
}

/** Place a canonical 2×2 police station with NW anchor at (ox, oy). */
function addStation(structures: StructureMap, ox: number, oy: number) {
  return structures.addStructure({
    type: 'police_station',
    anchor: { x: ox, y: oy },
    footprint: [
      { x: ox,     y: oy     },
      { x: ox + 1, y: oy     },
      { x: ox,     y: oy + 1 },
      { x: ox + 1, y: oy + 1 },
    ],
  });
}

/** Place a canonical 2×2 power plant with NW anchor at (ox, oy). */
function addPlant(structures: StructureMap, ox: number, oy: number) {
  return structures.addStructure({
    type: 'power_plant',
    anchor: { x: ox, y: oy },
    footprint: [
      { x: ox,     y: oy     },
      { x: ox + 1, y: oy     },
      { x: ox,     y: oy + 1 },
      { x: ox + 1, y: oy + 1 },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ServiceCoverageMap', () => {
  describe('delegation wiring — police station adjacent to one road cell', () => {
    let svc: ServiceCoverageMap;
    // Station at (1,1) — 2×2 footprint (1,1),(2,1),(1,2),(2,2).
    // Road at (1,0) — orthogonally adjacent to footprint cell (1,1).
    // Proves the class drives the real BFS: the station seeds the road at
    // distance 0, which yields raw intensity 255.
    beforeEach(() => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addStation(structures, 1, 1);
      svc = new ServiceCoverageMap(10, 10);
      svc.recompute(map, structures);
    });

    it('road cell adjacent to station at distance 0 reads 255', () => {
      expect(svc.getCoverage(1, 0)).toBe(255);
    });

    it('station footprint cell itself reads 0 (not self-covered)', () => {
      expect(svc.getCoverage(1, 1)).toBe(0);
    });
  });

  describe('getCoverageNormalized', () => {
    it('returns getCoverage / 255', () => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addStation(structures, 1, 1);
      const svc = new ServiceCoverageMap(10, 10);
      svc.recompute(map, structures);

      const raw = svc.getCoverage(1, 0);
      expect(svc.getCoverageNormalized(1, 0)).toBeCloseTo(raw / 255, 10);
    });

    it('returns 0 for an uncovered cell', () => {
      const svc = new ServiceCoverageMap(5, 5);
      expect(svc.getCoverageNormalized(2, 2)).toBe(0);
    });
  });

  describe('getCoverage out-of-bounds', () => {
    it('returns 0 for negative coordinates', () => {
      const svc = new ServiceCoverageMap(5, 5);
      expect(svc.getCoverage(-1, 0)).toBe(0);
      expect(svc.getCoverage(0, -1)).toBe(0);
    });

    it('returns 0 for coordinates >= dimensions', () => {
      const svc = new ServiceCoverageMap(5, 5);
      expect(svc.getCoverage(5, 0)).toBe(0);
      expect(svc.getCoverage(0, 5)).toBe(0);
    });
  });

  describe('clear()', () => {
    it('zeroes the backing array; getCoverage returns 0 everywhere after clear', () => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addStation(structures, 1, 1);
      const svc = new ServiceCoverageMap(10, 10);
      svc.recompute(map, structures);

      // Verify something is covered before clearing
      expect(svc.getCoverage(1, 0)).toBe(255);

      svc.clear();

      expect(svc.getCoverage(1, 0)).toBe(0);
      const raw = svc.getRaw();
      for (let i = 0; i < raw.length; i++) {
        expect(raw[i]).toBe(0);
      }
    });
  });

  describe('isAnchorCovered — threshold boundary', () => {
    // We use getRaw() to inject values directly — test-only path to verify the
    // integer-compare boundary deterministically without needing a precise BFS
    // scenario that hits exactly 64 or 63.
    it('SERVICE_COVERAGE_THRESHOLD_RAW is 64', () => {
      // Math.round(0.25 * 255) = Math.round(63.75) = 64
      expect(SERVICE_COVERAGE_THRESHOLD_RAW).toBe(64);
    });

    it('returns true when raw coverage equals 64 (threshold)', () => {
      const svc = new ServiceCoverageMap(5, 5);
      svc.getRaw()[1 * 5 + 1] = 64; // inject raw value at (1,1)
      expect(isAnchorCovered({ x: 1, y: 1 }, svc)).toBe(true);
    });

    it('returns false when raw coverage is 63 (one below threshold)', () => {
      const svc = new ServiceCoverageMap(5, 5);
      svc.getRaw()[1 * 5 + 1] = 63; // inject raw value at (1,1)
      expect(isAnchorCovered({ x: 1, y: 1 }, svc)).toBe(false);
    });

    it('returns false when raw coverage is 0', () => {
      const svc = new ServiceCoverageMap(5, 5);
      // No injection — array initializes to 0
      expect(isAnchorCovered({ x: 1, y: 1 }, svc)).toBe(false);
    });
  });

  describe('source-selector isolation: power_plant does NOT produce police coverage', () => {
    it('a power_plant adjacent to road does not produce police coverage', () => {
      // Road at (1,0). Power plant at (1,1) — adjacent to the road.
      // ServiceCoverageMap uses police_station as source predicate, so the
      // plant should NOT seed coverage.
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 1, 1);
      const svc = new ServiceCoverageMap(10, 10);
      svc.recompute(map, structures);

      expect(svc.getCoverage(1, 0)).toBe(0);
      expect(svc.getCoverage(0, 0)).toBe(0);
    });
  });
});
