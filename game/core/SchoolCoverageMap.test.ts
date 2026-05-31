import { describe, it, expect, beforeEach } from 'vitest';
import { SchoolCoverageMap, isSchoolAnchorCovered } from './SchoolCoverageMap';
import { ServiceCoverageMap } from './ServiceCoverageMap';
import { FireCoverageMap } from './FireCoverageMap';
import { HospitalCoverageMap } from './HospitalCoverageMap';
import { SERVICE_COVERAGE_THRESHOLD_RAW } from './ServiceCoverageMap';
import { GameMap } from './Map';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
//
// SchoolCoverageMap.recompute delegates to propagateServiceCoverage (with a
// `school` source selector). The full BFS topology matrix lives in
// serviceCoveragePropagation.test.ts — the single source of BFS truth. These
// tests cover only the class surface: source-type selection (school only, not
// police/fire/hospital), school NOT seeding the other maps, getCoverageNormalized,
// getCoverage OOB, clear(), and isSchoolAnchorCovered threshold boundary.

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

/** Place a canonical 2×2 school with NW anchor at (ox, oy). */
function placeSchool(structures: StructureMap, ox: number, oy: number) {
  return structures.addStructure({
    type: 'school',
    anchor: { x: ox, y: oy },
    footprint: [
      { x: ox,     y: oy     },
      { x: ox + 1, y: oy     },
      { x: ox,     y: oy + 1 },
      { x: ox + 1, y: oy + 1 },
    ],
  });
}

/** Place a canonical 2×2 police station with NW anchor at (ox, oy). */
function placePoliceStation(structures: StructureMap, ox: number, oy: number) {
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

/** Place a canonical 2×2 fire station with NW anchor at (ox, oy). */
function placeFireStation(structures: StructureMap, ox: number, oy: number) {
  return structures.addStructure({
    type: 'fire_station',
    anchor: { x: ox, y: oy },
    footprint: [
      { x: ox,     y: oy     },
      { x: ox + 1, y: oy     },
      { x: ox,     y: oy + 1 },
      { x: ox + 1, y: oy + 1 },
    ],
  });
}

/** Place a canonical 2×2 hospital with NW anchor at (ox, oy). */
function placeHospital(structures: StructureMap, ox: number, oy: number) {
  return structures.addStructure({
    type: 'hospital',
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

describe('SchoolCoverageMap', () => {
  describe('source-type selection: school seeds coverage', () => {
    // School at (1,1) — 2×2 footprint (1,1),(2,1),(1,2),(2,2).
    // Road at (1,0) — orthogonally adjacent to the school footprint cell.
    // Proves school seeds the road at distance 0 → raw intensity 255.
    let svc: SchoolCoverageMap;
    beforeEach(() => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placeSchool(structures, 1, 1);
      svc = new SchoolCoverageMap(10, 10);
      svc.recompute(map, structures);
    });

    it('road cell adjacent to school at distance 0 reads 255', () => {
      expect(svc.getCoverage(1, 0)).toBe(255);
    });

    it('school footprint cell itself reads 0 (not self-covered)', () => {
      expect(svc.getCoverage(1, 1)).toBe(0);
    });
  });

  describe('cross-source isolation: school ignores police_station, fire_station, and hospital', () => {
    it('a police_station adjacent to road does NOT produce school coverage', () => {
      // Road at (1,0). Police station at (1,1).
      // SchoolCoverageMap uses school as source predicate, so the
      // police station should NOT seed school coverage.
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placePoliceStation(structures, 1, 1);
      const svc = new SchoolCoverageMap(10, 10);
      svc.recompute(map, structures);

      expect(svc.getCoverage(1, 0)).toBe(0);
      expect(svc.getCoverage(0, 0)).toBe(0);
    });

    it('a fire_station adjacent to road does NOT produce school coverage', () => {
      // Road at (1,0). Fire station at (1,1).
      // SchoolCoverageMap uses school as source predicate, so the
      // fire station should NOT seed school coverage.
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placeFireStation(structures, 1, 1);
      const svc = new SchoolCoverageMap(10, 10);
      svc.recompute(map, structures);

      expect(svc.getCoverage(1, 0)).toBe(0);
      expect(svc.getCoverage(0, 0)).toBe(0);
    });

    it('a hospital adjacent to road does NOT produce school coverage', () => {
      // Road at (1,0). Hospital at (1,1).
      // SchoolCoverageMap uses school as source predicate, so the
      // hospital should NOT seed school coverage.
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placeHospital(structures, 1, 1);
      const svc = new SchoolCoverageMap(10, 10);
      svc.recompute(map, structures);

      expect(svc.getCoverage(1, 0)).toBe(0);
      expect(svc.getCoverage(0, 0)).toBe(0);
    });
  });

  describe('cross-source isolation: school does NOT seed police/fire/hospital maps', () => {
    // School at (1,1). Road at (1,0). The other maps use different source
    // predicates, so a school building must produce zero coverage in them.
    it('a school adjacent to road does NOT produce police coverage', () => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placeSchool(structures, 1, 1);
      const svc = new ServiceCoverageMap(10, 10);
      svc.recompute(map, structures);

      expect(svc.getCoverage(1, 0)).toBe(0);
    });

    it('a school adjacent to road does NOT produce fire coverage', () => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placeSchool(structures, 1, 1);
      const svc = new FireCoverageMap(10, 10);
      svc.recompute(map, structures);

      expect(svc.getCoverage(1, 0)).toBe(0);
    });

    it('a school adjacent to road does NOT produce hospital coverage', () => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placeSchool(structures, 1, 1);
      const svc = new HospitalCoverageMap(10, 10);
      svc.recompute(map, structures);

      expect(svc.getCoverage(1, 0)).toBe(0);
    });
  });

  describe('getCoverageNormalized', () => {
    it('returns getCoverage / 255', () => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placeSchool(structures, 1, 1);
      const svc = new SchoolCoverageMap(10, 10);
      svc.recompute(map, structures);

      const raw = svc.getCoverage(1, 0);
      expect(svc.getCoverageNormalized(1, 0)).toBeCloseTo(raw / 255, 10);
    });

    it('returns 0 for an uncovered cell', () => {
      const svc = new SchoolCoverageMap(5, 5);
      expect(svc.getCoverageNormalized(2, 2)).toBe(0);
    });
  });

  describe('getCoverage out-of-bounds', () => {
    it('returns 0 for negative coordinates', () => {
      const svc = new SchoolCoverageMap(5, 5);
      expect(svc.getCoverage(-1, 0)).toBe(0);
      expect(svc.getCoverage(0, -1)).toBe(0);
    });

    it('returns 0 for coordinates >= dimensions', () => {
      const svc = new SchoolCoverageMap(5, 5);
      expect(svc.getCoverage(5, 0)).toBe(0);
      expect(svc.getCoverage(0, 5)).toBe(0);
    });
  });

  describe('clear()', () => {
    it('zeroes the backing array; getCoverage returns 0 everywhere after clear', () => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      placeSchool(structures, 1, 1);
      const svc = new SchoolCoverageMap(10, 10);
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

  describe('isSchoolAnchorCovered — threshold boundary', () => {
    // We use getRaw() to inject values directly — test-only path to verify the
    // integer-compare boundary deterministically without needing a precise BFS
    // scenario that hits exactly 64 or 63.
    it('SERVICE_COVERAGE_THRESHOLD_RAW is 64', () => {
      // Math.round(0.25 * 255) = Math.round(63.75) = 64
      expect(SERVICE_COVERAGE_THRESHOLD_RAW).toBe(64);
    });

    it('returns true when raw coverage equals 64 (threshold)', () => {
      const svc = new SchoolCoverageMap(5, 5);
      svc.getRaw()[1 * 5 + 1] = 64; // inject raw value at (1,1)
      expect(isSchoolAnchorCovered({ x: 1, y: 1 }, svc)).toBe(true);
    });

    it('returns false when raw coverage is 63 (one below threshold)', () => {
      const svc = new SchoolCoverageMap(5, 5);
      svc.getRaw()[1 * 5 + 1] = 63; // inject raw value at (1,1)
      expect(isSchoolAnchorCovered({ x: 1, y: 1 }, svc)).toBe(false);
    });

    it('returns false when raw coverage is 0', () => {
      const svc = new SchoolCoverageMap(5, 5);
      // No injection — array initializes to 0
      expect(isSchoolAnchorCovered({ x: 1, y: 1 }, svc)).toBe(false);
    });
  });
});
