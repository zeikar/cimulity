import { describe, it, expect, beforeEach } from 'vitest';
import { PowerMap, isBuildingPowered } from './PowerMap';
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

describe('PowerMap', () => {
  describe('empty map', () => {
    it('isPowered returns false everywhere', () => {
      const map = new GameMap(5, 5);
      const structures = new StructureMap(5, 5);
      const power = new PowerMap(5, 5);
      power.recompute(map, structures);
      expect(power.isPowered(0, 0)).toBe(false);
      expect(power.isPowered(2, 2)).toBe(false);
    });
  });

  describe('standalone plant with no adjacent road', () => {
    it('nothing is powered; plant footprint cells are false', () => {
      // Plant at (1,1)...(2,2) — surrounded by GRASS, no roads.
      const map = makeMap(10, 10, []);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 1, 1);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      // Plant footprint cells
      expect(power.isPowered(1, 1)).toBe(false);
      expect(power.isPowered(2, 1)).toBe(false);
      expect(power.isPowered(1, 2)).toBe(false);
      expect(power.isPowered(2, 2)).toBe(false);

      // An arbitrary non-plant cell
      expect(power.isPowered(5, 5)).toBe(false);
    });
  });

  describe('plant adjacent to one road cell', () => {
    let power: PowerMap;
    // Plant NW anchor at (1,1) occupies (1,1),(2,1),(1,2),(2,2).
    // Road placed at (1,0) — orthogonally adjacent to (1,1), a plant cell.
    beforeEach(() => {
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 1, 1);
      power = new PowerMap(10, 10);
      power.recompute(map, structures);
    });

    it('the single road cell is powered', () => {
      expect(power.isPowered(1, 0)).toBe(true);
    });

    it('plant footprint cells are NOT powered', () => {
      expect(power.isPowered(1, 1)).toBe(false);
      expect(power.isPowered(2, 1)).toBe(false);
      expect(power.isPowered(1, 2)).toBe(false);
      expect(power.isPowered(2, 2)).toBe(false);
    });

    it('non-structure orthogonal neighbors of the road cell are powered', () => {
      // Road is at (1,0). Its neighbors: (0,0), (2,0) are not structure cells.
      expect(power.isPowered(0, 0)).toBe(true);
      expect(power.isPowered(2, 0)).toBe(true);
    });
  });

  describe('5-tile road line with plant touching one end', () => {
    let power: PowerMap;
    // Road: (0,0),(1,0),(2,0),(3,0),(4,0).
    // Plant NW anchor at (0,1) occupies (0,1),(1,1),(0,2),(1,2).
    // Plant cell (0,1) is orthogonally adjacent to road (0,0) → seeds the BFS.
    beforeEach(() => {
      const map = makeMap(10, 10, [
        { x: 0, y: 0, type: TileType.ROAD },
        { x: 1, y: 0, type: TileType.ROAD },
        { x: 2, y: 0, type: TileType.ROAD },
        { x: 3, y: 0, type: TileType.ROAD },
        { x: 4, y: 0, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 0, 1);
      power = new PowerMap(10, 10);
      power.recompute(map, structures);
    });

    it('all 5 road cells are powered', () => {
      for (let x = 0; x < 5; x++) {
        expect(power.isPowered(x, 0)).toBe(true);
      }
    });

    it('non-plant neighbors of road cells are powered', () => {
      // Above each road cell (y=-1) is out-of-bounds, not powered.
      // Right neighbor of road at (4,0): (5,0) — GRASS, not structure → powered.
      expect(power.isPowered(5, 0)).toBe(true);
    });

    it('plant footprint cells stay unpowered', () => {
      expect(power.isPowered(0, 1)).toBe(false);
      expect(power.isPowered(1, 1)).toBe(false);
      expect(power.isPowered(0, 2)).toBe(false);
      expect(power.isPowered(1, 2)).toBe(false);
    });
  });

  describe('road split: middle tile changed to DIRT', () => {
    it('only plant-side component stays powered after recompute', () => {
      // Road: (0,5),(1,5),(2,5),(3,5),(4,5). Plant at (0,6).
      // Gap at (2,5) → (0,5) and (1,5) powered; (3,5) and (4,5) not.
      const map = makeMap(10, 10, [
        { x: 0, y: 5, type: TileType.ROAD },
        { x: 1, y: 5, type: TileType.ROAD },
        // (2,5) stays GRASS/DIRT — the gap
        { x: 3, y: 5, type: TileType.ROAD },
        { x: 4, y: 5, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 0, 6);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      expect(power.isPowered(0, 5)).toBe(true);
      expect(power.isPowered(1, 5)).toBe(true);
      expect(power.isPowered(3, 5)).toBe(false);
      expect(power.isPowered(4, 5)).toBe(false);
    });
  });

  describe('two plants on a shared road network', () => {
    it('coverage is idempotent — same as single plant on that network', () => {
      // Road: (3,0)...(7,0). Plant A at (3,1); Plant B at (7,1).
      const map = makeMap(10, 10, [
        { x: 3, y: 0, type: TileType.ROAD },
        { x: 4, y: 0, type: TileType.ROAD },
        { x: 5, y: 0, type: TileType.ROAD },
        { x: 6, y: 0, type: TileType.ROAD },
        { x: 7, y: 0, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 3, 1);
      addPlant(structures, 7, 1);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      // All road cells powered (both plants can see the full line)
      for (let x = 3; x <= 7; x++) {
        expect(power.isPowered(x, 0)).toBe(true);
      }

      // Single-plant version should yield the same road coverage
      const structures2 = new StructureMap(10, 10);
      addPlant(structures2, 3, 1);
      const power2 = new PowerMap(10, 10);
      power2.recompute(map, structures2);
      for (let x = 3; x <= 7; x++) {
        expect(power2.isPowered(x, 0)).toBe(true);
      }
    });
  });

  describe('two plants on disjoint road networks', () => {
    it('each plant lights only its own network', () => {
      // Road A: (0,0)...(2,0). Plant A at (0,1).
      // Road B: (7,0)...(9,0). Plant B at (7,1).
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
      addPlant(structures, 0, 1);
      addPlant(structures, 7, 1);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      expect(power.isPowered(0, 0)).toBe(true);
      expect(power.isPowered(1, 0)).toBe(true);
      expect(power.isPowered(2, 0)).toBe(true);

      expect(power.isPowered(7, 0)).toBe(true);
      expect(power.isPowered(8, 0)).toBe(true);
      expect(power.isPowered(9, 0)).toBe(true);

      // The gap in the middle is not powered
      expect(power.isPowered(4, 0)).toBe(false);
      expect(power.isPowered(5, 0)).toBe(false);
    });
  });

  describe('plant diagonally adjacent to road only (no orthogonal road neighbor)', () => {
    it('nothing is powered', () => {
      // Plant NW anchor at (0,0) occupies (0,0),(1,0),(0,1),(1,1).
      // Road at (2,2) — diagonal to (1,1), no orthogonal adjacency.
      const map = makeMap(10, 10, [{ x: 2, y: 2, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 0, 0);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      expect(power.isPowered(2, 2)).toBe(false);
    });
  });

  describe('isPowered out-of-bounds', () => {
    it('returns false for negative coordinates', () => {
      const power = new PowerMap(5, 5);
      expect(power.isPowered(-1, 0)).toBe(false);
      expect(power.isPowered(0, -1)).toBe(false);
    });

    it('returns false for coordinates >= dimensions', () => {
      const power = new PowerMap(5, 5);
      expect(power.isPowered(5, 0)).toBe(false);
      expect(power.isPowered(0, 5)).toBe(false);
    });
  });

  describe('road on map edge with plant on in-bounds neighbor', () => {
    it('seeds correctly without off-map array reads', () => {
      // Map 5×5. Road at (0,0) — top-left corner.
      // Plant NW anchor at (0,1) occupies (0,1),(1,1),(0,2),(1,2).
      // Plant cell (0,1) is orthogonally adjacent to road (0,0).
      const map = makeMap(5, 5, [{ x: 0, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(5, 5);
      addPlant(structures, 0, 1);
      const power = new PowerMap(5, 5);
      power.recompute(map, structures);

      expect(power.isPowered(0, 0)).toBe(true);
      // Plant cells remain unpowered
      expect(power.isPowered(0, 1)).toBe(false);
    });
  });

  describe('clear()', () => {
    it('zeroes the array; isPowered returns false everywhere after clear', () => {
      const map = makeMap(5, 5, [
        { x: 2, y: 0, type: TileType.ROAD },
        { x: 2, y: 1, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(5, 5);
      addPlant(structures, 2, 2);
      const power = new PowerMap(5, 5);
      power.recompute(map, structures);

      // Verify something is powered before clearing
      expect(power.isPowered(2, 0)).toBe(true);

      power.clear();

      expect(power.isPowered(2, 0)).toBe(false);
      expect(power.isPowered(2, 1)).toBe(false);
      const raw = power.getRaw();
      for (let i = 0; i < raw.length; i++) {
        expect(raw[i]).toBe(0);
      }
    });
  });

  describe('isBuildingPowered helper', () => {
    it('returns true when any one footprint cell is powered', () => {
      // Road at (5,0). Plant at (5,1) seeds that road.
      // A 1×4 "building" with footprint (2,0),(3,0),(4,0),(5,0).
      // Only (5,0) is powered (it is the road cell).
      const map = makeMap(10, 10, [{ x: 5, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 5, 1);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      const building = {
        footprint: [
          { x: 2, y: 0 },
          { x: 3, y: 0 },
          { x: 4, y: 0 },
          { x: 5, y: 0 },
        ],
      };
      expect(isBuildingPowered(building, power)).toBe(true);
    });

    it('returns false when none of the footprint cells are powered', () => {
      // Road at (0,0), plant at (0,1). Building at (8,8)...(9,8) — far away.
      const map = makeMap(10, 10, [{ x: 0, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 0, 1);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      const building = {
        footprint: [
          { x: 8, y: 8 },
          { x: 9, y: 8 },
        ],
      };
      expect(isBuildingPowered(building, power)).toBe(false);
    });
  });
});
