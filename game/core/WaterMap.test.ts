import { describe, it, expect, beforeEach } from 'vitest';
import { WaterMap, isBuildingWatered } from './WaterMap';
import { GameMap } from './Map';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  describe('empty map', () => {
    it('isWatered returns false everywhere', () => {
      const map = new GameMap(5, 5);
      const structures = new StructureMap(5, 5);
      const water = new WaterMap(5, 5);
      water.recompute(map, structures);
      expect(water.isWatered(0, 0)).toBe(false);
      expect(water.isWatered(2, 2)).toBe(false);
    });
  });

  describe('standalone tower with no adjacent road', () => {
    it('nothing is watered; tower cell is false', () => {
      // Tower at (1,1) — single cell, surrounded by GRASS, no roads.
      const map = makeMap(10, 10, []);
      const structures = new StructureMap(10, 10);
      addTower(structures, 1, 1);
      const water = new WaterMap(10, 10);
      water.recompute(map, structures);

      // Tower footprint cell
      expect(water.isWatered(1, 1)).toBe(false);

      // An arbitrary non-tower cell
      expect(water.isWatered(5, 5)).toBe(false);
    });
  });

  describe('tower adjacent to one road cell', () => {
    let water: WaterMap;
    // Tower at (1,1) — single cell.
    // Road placed at (1,0) — orthogonally adjacent to tower cell (1,1).
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

  describe('5-tile road line with tower touching one end', () => {
    let water: WaterMap;
    // Road: (0,0),(1,0),(2,0),(3,0),(4,0).
    // Tower at (0,1) — single cell.
    // Tower cell (0,1) is orthogonally adjacent to road (0,0) → seeds the BFS.
    beforeEach(() => {
      const map = makeMap(10, 10, [
        { x: 0, y: 0, type: TileType.ROAD },
        { x: 1, y: 0, type: TileType.ROAD },
        { x: 2, y: 0, type: TileType.ROAD },
        { x: 3, y: 0, type: TileType.ROAD },
        { x: 4, y: 0, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 0, 1);
      water = new WaterMap(10, 10);
      water.recompute(map, structures);
    });

    it('all 5 road cells are watered', () => {
      for (let x = 0; x < 5; x++) {
        expect(water.isWatered(x, 0)).toBe(true);
      }
    });

    it('non-tower neighbors of road cells are watered', () => {
      // Right neighbor of road at (4,0): (5,0) — GRASS, not structure → watered.
      expect(water.isWatered(5, 0)).toBe(true);
    });

    it('tower footprint cell stays unwatered', () => {
      expect(water.isWatered(0, 1)).toBe(false);
    });
  });

  describe('road split: middle tile changed to DIRT (gap)', () => {
    it('only tower-side component stays watered after recompute', () => {
      // Road: (0,5),(1,5),(2,5),(3,5),(4,5). Tower at (0,6).
      // Gap at (2,5) → (0,5) and (1,5) watered; (3,5) and (4,5) not.
      const map = makeMap(10, 10, [
        { x: 0, y: 5, type: TileType.ROAD },
        { x: 1, y: 5, type: TileType.ROAD },
        // (2,5) stays GRASS — the gap
        { x: 3, y: 5, type: TileType.ROAD },
        { x: 4, y: 5, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 0, 6);
      const water = new WaterMap(10, 10);
      water.recompute(map, structures);

      expect(water.isWatered(0, 5)).toBe(true);
      expect(water.isWatered(1, 5)).toBe(true);
      expect(water.isWatered(3, 5)).toBe(false);
      expect(water.isWatered(4, 5)).toBe(false);
    });
  });

  describe('two towers on a shared road network', () => {
    it('coverage is idempotent — same as single tower on that network', () => {
      // Road: (3,0)...(7,0). Tower A at (3,1); Tower B at (7,1).
      const map = makeMap(10, 10, [
        { x: 3, y: 0, type: TileType.ROAD },
        { x: 4, y: 0, type: TileType.ROAD },
        { x: 5, y: 0, type: TileType.ROAD },
        { x: 6, y: 0, type: TileType.ROAD },
        { x: 7, y: 0, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 3, 1);
      addTower(structures, 7, 1);
      const water = new WaterMap(10, 10);
      water.recompute(map, structures);

      // All road cells watered (both towers can see the full line)
      for (let x = 3; x <= 7; x++) {
        expect(water.isWatered(x, 0)).toBe(true);
      }

      // Single-tower version should yield the same road coverage
      const structures2 = new StructureMap(10, 10);
      addTower(structures2, 3, 1);
      const water2 = new WaterMap(10, 10);
      water2.recompute(map, structures2);
      for (let x = 3; x <= 7; x++) {
        expect(water2.isWatered(x, 0)).toBe(true);
      }
    });
  });

  describe('two towers on disjoint road networks', () => {
    it('each tower waters only its own network', () => {
      // Road A: (0,0)...(2,0). Tower A at (0,1).
      // Road B: (7,0)...(9,0). Tower B at (7,1).
      // No road connects the two halves.
      const map = makeMap(10, 10, [
        { x: 0, y: 0, type: TileType.ROAD },
        { x: 1, y: 0, type: TileType.ROAD },
        { x: 2, y: 0, type: TileType.ROAD },
        { x: 7, y: 0, type: TileType.ROAD },
        { x: 8, y: 0, type: TileType.ROAD },
        { x: 9, y: 0, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 0, 1);
      addTower(structures, 7, 1);
      const water = new WaterMap(10, 10);
      water.recompute(map, structures);

      expect(water.isWatered(0, 0)).toBe(true);
      expect(water.isWatered(1, 0)).toBe(true);
      expect(water.isWatered(2, 0)).toBe(true);

      expect(water.isWatered(7, 0)).toBe(true);
      expect(water.isWatered(8, 0)).toBe(true);
      expect(water.isWatered(9, 0)).toBe(true);

      // The gap in the middle is not watered
      expect(water.isWatered(4, 0)).toBe(false);
      expect(water.isWatered(5, 0)).toBe(false);
    });
  });

  describe('tower diagonally adjacent to road only (no orthogonal road neighbor)', () => {
    it('nothing is watered', () => {
      // Tower NW anchor at (0,0) occupies (0,0),(1,0),(0,1),(1,1).
      // Road at (2,2) — diagonal to (1,1), no orthogonal adjacency.
      const map = makeMap(10, 10, [{ x: 2, y: 2, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 0, 0);
      const water = new WaterMap(10, 10);
      water.recompute(map, structures);

      expect(water.isWatered(2, 2)).toBe(false);
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

  describe('road on map edge with tower on in-bounds neighbor', () => {
    it('seeds correctly without off-map array reads', () => {
      // Map 5×5. Road at (0,0) — top-left corner.
      // Tower NW anchor at (0,1) occupies (0,1),(1,1),(0,2),(1,2).
      // Tower cell (0,1) is orthogonally adjacent to road (0,0).
      const map = makeMap(5, 5, [{ x: 0, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(5, 5);
      addTower(structures, 0, 1);
      const water = new WaterMap(5, 5);
      water.recompute(map, structures);

      expect(water.isWatered(0, 0)).toBe(true);
      // Tower cells remain unwatered
      expect(water.isWatered(0, 1)).toBe(false);
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
