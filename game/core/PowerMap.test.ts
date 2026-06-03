import { describe, it, expect, beforeEach } from 'vitest';
import { PowerMap, isBuildingPowered, isStructurePowered } from './PowerMap';
import { GameMap } from './Map';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
//
// PowerMap.recompute delegates entirely to propagateThroughRoadNetwork (with a
// `power_plant` source selector). The full BFS topology matrix — empty map,
// road lines, splits, disjoint networks, diagonal adjacency, map edges — lives
// in roadNetworkPropagation.test.ts (the single source of BFS truth). These
// tests cover only PowerMap's own surface: the delegation wiring (real plant +
// road through the class), the `power_plant` source selector, isPowered OOB,
// clear(), and the isBuildingPowered footprint helper.

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

/** Place a canonical 1×1 water tower at (ox, oy). */
function addTower(structures: StructureMap, ox: number, oy: number) {
  return structures.addStructure({
    type: 'water_tower',
    anchor: { x: ox, y: oy },
    footprint: [{ x: ox, y: oy }],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PowerMap', () => {
  describe('delegation wiring — plant adjacent to one road cell', () => {
    let power: PowerMap;
    // Plant NW anchor at (1,1) occupies (1,1),(2,1),(1,2),(2,2).
    // Road placed at (1,0) — orthogonally adjacent to (1,1), a plant cell.
    // Proves PowerMap drives the BFS through the real class: the power_plant
    // seeds the network, the footprint cells are excluded, neighbours light up.
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

  describe('isStructurePowered helper (grid connectivity for service structures)', () => {
    // A 2×2 service structure (e.g. police_station) at NW anchor (ox, oy).
    const policeFootprint = (ox: number, oy: number) => [
      { x: ox,     y: oy     },
      { x: ox + 1, y: oy     },
      { x: ox,     y: oy + 1 },
      { x: ox + 1, y: oy + 1 },
    ];

    it('returns true when the structure is orthogonally adjacent to a POWERED road', () => {
      // Powered road (2,0),(3,0) seeded by a plant at (2,1). Police at (4,0)..(5,1):
      // its cell (4,0) is adjacent to powered road (3,0).
      const map = makeMap(10, 10, [
        { x: 2, y: 0, type: TileType.ROAD },
        { x: 3, y: 0, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 2, 1);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      expect(power.isPowered(3, 0)).toBe(true); // sanity: road is on the grid
      expect(isStructurePowered({ footprint: policeFootprint(4, 0) }, power, map)).toBe(true);
    });

    it('returns false when adjacent only to an UNpowered road (no plant connected)', () => {
      // Road at (5,0) with NO plant → unpowered. Police at (5,1)..(6,2) touches it but
      // gets no power — matches "built next to a road but the grid has no power yet".
      const map = makeMap(10, 10, [{ x: 5, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      expect(isStructurePowered({ footprint: policeFootprint(5, 1) }, power, map)).toBe(false);
    });

    it('returns false when adjacent ONLY to powered grass halo, not a powered road (two tiles from the road)', () => {
      // Powered road (5,5),(6,5) seeded by a plant at (5,6). The propagation also powers
      // the 1-tile grass halo above it: (5,4) and (6,4) become powered grass. A police at
      // (5,2)..(6,3) touches that halo (cells (5,3)/(6,3) ↔ (5,4)/(6,4)) but is NOT adjacent
      // to any road, so it must read NOT powered.
      const map = makeMap(10, 10, [
        { x: 5, y: 5, type: TileType.ROAD },
        { x: 6, y: 5, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 5, 6);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      expect(power.isPowered(5, 4)).toBe(true); // sanity: grass halo IS powered
      expect(isStructurePowered({ footprint: policeFootprint(5, 2) }, power, map)).toBe(false);
    });

    it('returns false when far from any powered cell', () => {
      const map = makeMap(10, 10, [
        { x: 0, y: 0, type: TileType.ROAD },
      ]);
      const structures = new StructureMap(10, 10);
      addPlant(structures, 0, 1);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      expect(isStructurePowered({ footprint: policeFootprint(7, 7) }, power, map)).toBe(false);
    });
  });

  describe('source-selector isolation: water_tower does NOT power its network', () => {
    it('a water_tower in the StructureMap does not power roads — only power_plant sources do', () => {
      // Road at (1,0). Water tower at (1,1) — adjacent to the road.
      // PowerMap uses power_plant as source predicate, so the tower must NOT seed power.
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const structures = new StructureMap(10, 10);
      addTower(structures, 1, 1);
      const power = new PowerMap(10, 10);
      power.recompute(map, structures);

      expect(power.isPowered(1, 0)).toBe(false);
      expect(power.isPowered(0, 0)).toBe(false);
      expect(power.isPowered(2, 0)).toBe(false);
    });
  });
});
