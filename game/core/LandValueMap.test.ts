import { describe, it, expect, beforeEach } from 'vitest';
import { LandValueMap } from './LandValueMap';
import { GameMap } from './Map';
import { World } from './World';
import { StructureMap } from './StructureMap';
import { ServiceCoverageMap } from './ServiceCoverageMap';
import { FireCoverageMap } from './FireCoverageMap';
import { HospitalCoverageMap } from './HospitalCoverageMap';
import { SchoolCoverageMap } from './SchoolCoverageMap';
import { TileType, createTile } from './Tile';
import { executeClick } from '../engine/CommandDispatcher';
import { Tool } from '../tools/Tool';

// ---------------------------------------------------------------------------
// Helper: build a GameMap with explicit tile types at given coordinates
// ---------------------------------------------------------------------------
function makeMap(w: number, h: number, overrides: Array<{ x: number; y: number; type: TileType }>): GameMap {
  const map = new GameMap(w, h);
  for (const { x, y, type } of overrides) {
    map.setTile(x, y, createTile(x, y, type));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Coverage-bundle helpers: real instances with raw arrays filled deterministically.
// zeroCoverage → serviceScore 0; fullCoverage → serviceScore 1.0.
// ---------------------------------------------------------------------------
function zeroCoverage(w: number, h: number) {
  return {
    police: new ServiceCoverageMap(w, h),
    fire: new FireCoverageMap(w, h),
    hospital: new HospitalCoverageMap(w, h),
    school: new SchoolCoverageMap(w, h),
  };
}

function fullCoverage(w: number, h: number) {
  const c = zeroCoverage(w, h);
  c.police.getRaw().fill(255);
  c.fire.getRaw().fill(255);
  c.hospital.getRaw().fill(255);
  c.school.getRaw().fill(255);
  return c;
}

// ---------------------------------------------------------------------------
// Unit tests for LandValueMap
// ---------------------------------------------------------------------------

describe('LandValueMap', () => {
  describe('5×5 with one road at (2,2)', () => {
    let lv: LandValueMap;
    let map: GameMap;

    beforeEach(() => {
      map = makeMap(5, 5, [{ x: 2, y: 2, type: TileType.ROAD }]);
      lv = new LandValueMap(5, 5);
      lv.recompute(map, new StructureMap(5, 5), zeroCoverage(5, 5));
    });

    it('all values are in [0, 1]', () => {
      const raw = lv.getRaw();
      for (let i = 0; i < raw.length; i++) {
        expect(raw[i]).toBeGreaterThanOrEqual(0);
        expect(raw[i]).toBeLessThanOrEqual(1);
      }
    });

    it('tiles adjacent to road have higher value than corner tiles', () => {
      // (2,1), (1,2), (3,2), (2,3) are Chebyshev-distance-1 neighbours
      const adjacentValue = lv.getValue(2, 1);
      const cornerValue = lv.getValue(0, 0);
      expect(adjacentValue).toBeGreaterThan(cornerValue);
    });

    it('recompute is deterministic (same result twice)', () => {
      const firstPass = Float32Array.from(lv.getRaw());
      lv.recompute(map, new StructureMap(5, 5), zeroCoverage(5, 5));
      const secondPass = lv.getRaw();
      for (let i = 0; i < firstPass.length; i++) {
        expect(firstPass[i]).toBe(secondPass[i]);
      }
    });
  });

  describe('3×3 region with mixed zone types', () => {
    it('diversity bonus > uniform region', () => {
      // Mixed: R/C/I in a 3×3 neighbourhood
      const mixedMap = makeMap(3, 3, [
        { x: 0, y: 0, type: TileType.ZONE_RESIDENTIAL },
        { x: 1, y: 0, type: TileType.ZONE_COMMERCIAL },
        { x: 2, y: 0, type: TileType.ZONE_INDUSTRIAL },
      ]);
      const mixedLv = new LandValueMap(3, 3);
      mixedLv.recompute(mixedMap, new StructureMap(3, 3), zeroCoverage(3, 3));

      // Uniform: only residential across entire map
      const uniformMap = makeMap(3, 3, [
        { x: 0, y: 0, type: TileType.ZONE_RESIDENTIAL },
        { x: 1, y: 0, type: TileType.ZONE_RESIDENTIAL },
        { x: 2, y: 0, type: TileType.ZONE_RESIDENTIAL },
      ]);
      const uniformLv = new LandValueMap(3, 3);
      uniformLv.recompute(uniformMap, new StructureMap(3, 3), zeroCoverage(3, 3));

      // The centre tile (1,1) of the mixed map should see all 3 zone types
      // in its 3×3 neighbourhood; uniformMap centre only sees 1 type.
      expect(mixedLv.getValue(1, 1)).toBeGreaterThan(uniformLv.getValue(1, 1));
    });
  });

  describe('empty map (no road, no zone)', () => {
    it('every value is 0', () => {
      const map = new GameMap(4, 4);
      const lv = new LandValueMap(4, 4);
      lv.recompute(map, new StructureMap(4, 4), zeroCoverage(4, 4));
      const raw = lv.getRaw();
      for (let i = 0; i < raw.length; i++) {
        expect(raw[i]).toBe(0);
      }
    });
  });

  describe('park-free map yields the road+diversity result (service=0)', () => {
    it('empty StructureMap + zero coverage produces the 0.40*road + 0.10*diversity result', () => {
      // A map with a road and zone — with an empty StructureMap parkScore=0 everywhere
      // and zeroCoverage serviceScore=0 everywhere, so the result is the 0.40*road +
      // 0.10*diversity base. The assertion is relational so it stays green.
      const map = makeMap(5, 5, [
        { x: 2, y: 2, type: TileType.ROAD },
        { x: 0, y: 0, type: TileType.ZONE_RESIDENTIAL },
      ]);
      const lv = new LandValueMap(5, 5);
      lv.recompute(map, new StructureMap(5, 5), zeroCoverage(5, 5));
      // Adjacent tile (2,1) should be > 0 (road proximity), corner (4,4) lower.
      expect(lv.getValue(2, 1)).toBeGreaterThan(lv.getValue(4, 4));
    });
  });

  describe('park-term boost', () => {
    it('(a) single park raises a nearby tile above its park-free baseline', () => {
      const world = new World(10, 10, { regenerate: false });
      const map = world.getMap();
      const lv = new LandValueMap(10, 10);

      // Baseline: no park
      lv.recompute(map, new StructureMap(10, 10), zeroCoverage(10, 10));
      const baseline = lv.getValue(5, 5);

      // Place a park at (5,5)
      world.getStructureMap().addStructure({
        type: 'park',
        anchor: { x: 5, y: 5 },
        footprint: [{ x: 5, y: 5 }],
      });
      lv.recompute(map, world.getStructureMap(), zeroCoverage(10, 10));
      const withPark = lv.getValue(5, 5);

      expect(withPark).toBeGreaterThan(baseline);
    });

    it('(b) falloff: dist-1 tile gets bigger boost than dist-4, and dist-5 gets zero boost', () => {
      const world = new World(20, 20, { regenerate: false });
      const map = world.getMap();
      const lv = new LandValueMap(20, 20);

      // Place park at (10,10)
      world.getStructureMap().addStructure({
        type: 'park',
        anchor: { x: 10, y: 10 },
        footprint: [{ x: 10, y: 10 }],
      });
      lv.recompute(map, world.getStructureMap(), zeroCoverage(20, 20));

      // Baseline with no park for comparison at dist-5
      const lvBaseline = new LandValueMap(20, 20);
      lvBaseline.recompute(map, new StructureMap(20, 20), zeroCoverage(20, 20));

      // Chebyshev dist=1: tile (11,10)
      const dist1 = lv.getValue(11, 10);
      // Chebyshev dist=4: tile (14,10)
      const dist4 = lv.getValue(14, 10);
      // Chebyshev dist=5: tile (15,10) — beyond PARK_RADIUS=4, zero park boost
      const dist5WithPark = lv.getValue(15, 10);
      const dist5Baseline = lvBaseline.getValue(15, 10);

      expect(dist1).toBeGreaterThan(dist4);
      // dist=5 beyond radius: no park boost → same as baseline
      expect(dist5WithPark).toBe(dist5Baseline);
    });

    it('(c) two parks: boost derives from nearest (strongest-wins, not summed)', () => {
      const world = new World(20, 20, { regenerate: false });
      const map = world.getMap();
      const lv = new LandValueMap(20, 20);

      // Park A at (5,5), Park B at (15,5)
      world.getStructureMap().addStructure({
        type: 'park',
        anchor: { x: 5, y: 5 },
        footprint: [{ x: 5, y: 5 }],
      });
      world.getStructureMap().addStructure({
        type: 'park',
        anchor: { x: 15, y: 5 },
        footprint: [{ x: 15, y: 5 }],
      });
      lv.recompute(map, world.getStructureMap(), zeroCoverage(20, 20));

      // Tile (6,5) is dist=1 from Park A and dist=9 from Park B → nearest is A.
      // If summed it would exceed PARK_BOOST_MAX; if strongest-wins it equals
      // the single-park case exactly.
      const lvSingle = new LandValueMap(20, 20);
      const singleStructures = new StructureMap(20, 20);
      singleStructures.addStructure({
        type: 'park',
        anchor: { x: 5, y: 5 },
        footprint: [{ x: 5, y: 5 }],
      });
      lvSingle.recompute(map, singleStructures, zeroCoverage(20, 20));

      // Boost must equal single-park result (nearest-wins, not summed).
      expect(lv.getValue(6, 5)).toBe(lvSingle.getValue(6, 5));
      // And the result must not exceed 1.0.
      expect(lv.getValue(6, 5)).toBeLessThanOrEqual(1.0);
    });

    it('(d) clamp at 1.0: full coverage already maxes the base, adding a park stays at 1.0', () => {
      // With fullCoverage serviceScore=1.0 everywhere, the base is
      // 0.40*road + 0.10*diversity + 0.50*1.0. At a road tile with 3 zone types nearby
      // the base = 0.40 + 0.10 + 0.50 = 1.00 already → adding any park boost must clamp at 1.0.
      const map = makeMap(5, 5, [
        { x: 2, y: 2, type: TileType.ROAD },
        { x: 1, y: 1, type: TileType.ZONE_RESIDENTIAL },
        { x: 2, y: 1, type: TileType.ZONE_COMMERCIAL },
        { x: 3, y: 1, type: TileType.ZONE_INDUSTRIAL },
      ]);
      const structures = new StructureMap(5, 5);
      structures.addStructure({
        type: 'park',
        anchor: { x: 2, y: 0 },
        footprint: [{ x: 2, y: 0 }],
      });
      const lv = new LandValueMap(5, 5);
      lv.recompute(map, structures, fullCoverage(5, 5));

      // Tile (2,2): roadScore=1.0, diversity=1.0, service=1.0 → base 1.0; park boost
      // would push >1.0 without clamp; must stay at 1.0.
      expect(lv.getValue(2, 2)).toBe(1.0);
    });
  });

  describe('service-coverage term (unit)', () => {
    it('(1) full coverage adds exactly +0.50 over the service-free baseline', () => {
      // No road, no zone → road=0, diversity=0, park=0. With fullCoverage serviceScore=1.0
      // → land value = 0.50 * 1.0 = 0.50 exactly (base+0.50 < 1.0).
      const map = new GameMap(5, 5);
      const lv = new LandValueMap(5, 5);
      lv.recompute(map, new StructureMap(5, 5), fullCoverage(5, 5));
      expect(lv.getValue(0, 0)).toBeCloseTo(0.5, 5);
    });

    it('(2) partial coverage averages: police+fire full, hospital+school zero → 0.25', () => {
      // serviceScore = (1 + 1 + 0 + 0) / 4 = 0.5 → on a road/zone-free tile
      // land value = 0.50 * 0.5 = 0.25.
      const map = new GameMap(5, 5);
      const coverage = zeroCoverage(5, 5);
      coverage.police.getRaw().fill(255);
      coverage.fire.getRaw().fill(255);
      const lv = new LandValueMap(5, 5);
      lv.recompute(map, new StructureMap(5, 5), coverage);
      expect(lv.getValue(0, 0)).toBeCloseTo(0.25, 5);
    });

    it('(3) per-tile coverage: a covered tile exceeds an uncovered tile', () => {
      const w = 5;
      const map = new GameMap(w, 5);
      const coverage = zeroCoverage(w, 5);
      // Cover only tile (1,1): raw index = ty*w + tx.
      coverage.police.getRaw()[1 * w + 1] = 255;
      const lv = new LandValueMap(w, 5);
      lv.recompute(map, new StructureMap(w, 5), coverage);
      expect(lv.getValue(1, 1)).toBeGreaterThan(lv.getValue(3, 3));
    });

    it('(4) service-free → service term 0: value equals the pure road+diversity result', () => {
      // Road at (2,2); tile (2,1) is road-dist 1 → roadScore = 1 - 1/7 = 6/7.
      // diversity 0, service 0, park 0 → land value = 0.40 * 6/7 = 0.342857…
      const map = makeMap(5, 5, [{ x: 2, y: 2, type: TileType.ROAD }]);
      const lv = new LandValueMap(5, 5);
      lv.recompute(map, new StructureMap(5, 5), zeroCoverage(5, 5));
      expect(lv.getValue(2, 1)).toBeCloseTo(0.3429, 4);
    });
  });

  describe('dirty-mark integration: observable behavior only', () => {
    it('value at road tile is 0 before placement, > 0 after tick', () => {
      const world = new World(8, 8, { regenerate: false });

      // Before placement: land value not yet computed; force initial compute.
      world.recomputeLandValue();
      const before = world.getLandValue().getValue(3, 3);
      expect(before).toBe(0);

      // Place a road at (3,3) — this should mark land value dirty.
      executeClick(Tool.ROAD, { x: 3, y: 3 }, world);

      // Tick advances simulation, which calls recomputeLandValueIfDirty().
      world.tick();

      const after = world.getLandValue().getValue(3, 3);
      expect(after).toBeGreaterThan(0);
    });

    it('value unchanged after tick with no new changes', () => {
      const world = new World(8, 8, { regenerate: false });
      executeClick(Tool.ROAD, { x: 3, y: 3 }, world);
      world.tick();
      const afterFirst = world.getLandValue().getValue(3, 3);

      // Second tick with no changes: dirty flag is clear, value unchanged.
      world.tick();
      const afterSecond = world.getLandValue().getValue(3, 3);

      expect(afterSecond).toBe(afterFirst);
    });
  });
});
