import { describe, it, expect, beforeEach } from 'vitest';
import { WaterMap, isBuildingWatered } from './WaterMap';
import { GameMap } from './Map';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
//
// WaterMap.recompute delegates entirely to propagateThroughRoadNetwork (with a
// `water_tower` source selector). The full BFS topology matrix — empty map,
// road lines, splits, disjoint networks, diagonal adjacency, map edges — lives
// in roadNetworkPropagation.test.ts (the single source of BFS truth). These
// tests cover only WaterMap's own surface: the delegation wiring (real tower +
// road through the class), the `water_tower` source selector, isWatered OOB,
// clear(), and the isBuildingWatered footprint helper.

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

/** Place a canonical 1×1 water tower at (ox, oy). */
function addTower(structures: StructureMap, ox: number, oy: number) {
  return structures.addStructure({
    type: 'water_tower',
    anchor: { x: ox, y: oy },
    footprint: [
      { x: ox, y: oy },
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

describe('WaterMap', () => {
  describe('delegation wiring — tower adjacent to one road cell', () => {
    let water: WaterMap;
    // Tower at (1,1) — single cell. Road at (1,0) — orthogonally adjacent.
    // Proves WaterMap drives the BFS through the real class: the water_tower
    // seeds the network, the footprint cell is excluded, neighbours light up.
    beforeEach(() => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 1, 1);
      water = new WaterMap(10, 10);
      water.recompute(map, structures);
    });

    it('the single road cell is watered', () => {
      expect(water.isWatered(1, 0)).toBe(true);
    });

    it('tower footprint cell is NOT watered', () => {
      expect(water.isWatered(1, 1)).toBe(false);
    });

    it('non-structure orthogonal neighbors of the road cell are watered', () => {
      // Road is at (1,0). Its neighbors: (0,0), (2,0) are not structure cells.
      expect(water.isWatered(0, 0)).toBe(true);
      expect(water.isWatered(2, 0)).toBe(true);
    });
  });

  describe('isWatered out-of-bounds', () => {
    it('returns false for negative coordinates', () => {
      const water = new WaterMap(5, 5);
      expect(water.isWatered(-1, 0)).toBe(false);
      expect(water.isWatered(0, -1)).toBe(false);
    });

    it('returns false for coordinates >= dimensions', () => {
      const water = new WaterMap(5, 5);
      expect(water.isWatered(5, 0)).toBe(false);
      expect(water.isWatered(0, 5)).toBe(false);
    });
  });

  describe('clear()', () => {
    it('zeroes the array; isWatered returns false everywhere after clear', () => {
      const map = makeMap(5, 5, [
        { x: 2, y: 0, type: TileType.ROAD },
        { x: 2, y: 1, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(5, 5);
      addTower(structures, 2, 2);
      const water = new WaterMap(5, 5);
      water.recompute(map, structures);

      // Verify something is watered before clearing
      expect(water.isWatered(2, 0)).toBe(true);

      water.clear();

      expect(water.isWatered(2, 0)).toBe(false);
      expect(water.isWatered(2, 1)).toBe(false);
      const raw = water.getRaw();
      for (let i = 0; i < raw.length; i++) {
        expect(raw[i]).toBe(0);
      }
    });
  });

  describe('isBuildingWatered helper', () => {
    it('returns true when any one footprint cell is watered', () => {
      // Road at (5,0). Tower at (5,1) seeds that road.
      // A 1×4 "building" with footprint (2,0),(3,0),(4,0),(5,0).
      // Only (5,0) is watered (it is the road cell).
      const map = makeMap(10, 10, [{ x: 5, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 5, 1);
      const water = new WaterMap(10, 10);
      water.recompute(map, structures);

      const building = {
        footprint: [
          { x: 2, y: 0 },
          { x: 3, y: 0 },
          { x: 4, y: 0 },
          { x: 5, y: 0 },
        ],
      };
      expect(isBuildingWatered(building, water)).toBe(true);
    });

    it('returns false when none of the footprint cells are watered', () => {
      // Road at (0,0), tower at (0,1). Building at (8,8)...(9,8) — far away.
      const map = makeMap(10, 10, [{ x: 0, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 0, 1);
      const water = new WaterMap(10, 10);
      water.recompute(map, structures);

      const building = {
        footprint: [
          { x: 8, y: 8 },
          { x: 9, y: 8 },
        ],
      };
      expect(isBuildingWatered(building, water)).toBe(false);
    });
  });

  describe('source-selector isolation: power_plant does NOT water its network', () => {
    it('a power_plant in the StructureMap does not water roads — only water_tower sources do', () => {
      // Road at (1,0). Power plant at (1,1) — adjacent to the road.
      // WaterMap uses water_tower as source predicate, so the plant should NOT seed water.
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 1, 1);
      const water = new WaterMap(10, 10);
      water.recompute(map, structures);

      // Road adjacent to plant must NOT be watered (plant is not a water source)
      expect(water.isWatered(1, 0)).toBe(false);
      expect(water.isWatered(0, 0)).toBe(false);
      expect(water.isWatered(2, 0)).toBe(false);
    });
  });
});
