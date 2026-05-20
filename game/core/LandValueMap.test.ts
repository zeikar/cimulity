import { describe, it, expect, beforeEach } from 'vitest';
import { LandValueMap } from './LandValueMap';
import { GameMap } from './Map';
import { World } from './World';
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
// Unit tests for LandValueMap
// ---------------------------------------------------------------------------

describe('LandValueMap', () => {
  describe('5×5 with one road at (2,2)', () => {
    let lv: LandValueMap;
    let map: GameMap;

    beforeEach(() => {
      map = makeMap(5, 5, [{ x: 2, y: 2, type: TileType.ROAD }]);
      lv = new LandValueMap(5, 5);
      lv.recompute(map, map.getBuildings());
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
      lv.recompute(map, map.getBuildings());
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
      mixedLv.recompute(mixedMap, mixedMap.getBuildings());

      // Uniform: only residential across entire map
      const uniformMap = makeMap(3, 3, [
        { x: 0, y: 0, type: TileType.ZONE_RESIDENTIAL },
        { x: 1, y: 0, type: TileType.ZONE_RESIDENTIAL },
        { x: 2, y: 0, type: TileType.ZONE_RESIDENTIAL },
      ]);
      const uniformLv = new LandValueMap(3, 3);
      uniformLv.recompute(uniformMap, uniformMap.getBuildings());

      // The centre tile (1,1) of the mixed map should see all 3 zone types
      // in its 3×3 neighbourhood; uniformMap centre only sees 1 type.
      expect(mixedLv.getValue(1, 1)).toBeGreaterThan(uniformLv.getValue(1, 1));
    });
  });

  describe('empty map (no road, no zone)', () => {
    it('every value is 0', () => {
      const map = new GameMap(4, 4);
      const lv = new LandValueMap(4, 4);
      lv.recompute(map, map.getBuildings());
      const raw = lv.getRaw();
      for (let i = 0; i < raw.length; i++) {
        expect(raw[i]).toBe(0);
      }
    });
  });

  describe('dirty-mark integration: observable behavior only', () => {
    it('value at road tile is 0 before placement, > 0 after tick', () => {
      const world = new World(8, 8);

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
      const world = new World(8, 8);
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
