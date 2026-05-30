import { describe, it, expect } from 'vitest';
import { propagateThroughRoadNetwork } from './roadNetworkPropagation';
import { GameMap } from './Map';
import type { Structure } from './StructureMap';
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

/** Canonical 2×2 NW-anchored power_plant. */
function addPlant(sm: StructureMap, ox: number, oy: number) {
  return sm.addStructure({
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

/** Canonical 2×2 NW-anchored water_tower. */
function addTower(sm: StructureMap, ox: number, oy: number) {
  return sm.addStructure({
    type: 'water_tower',
    anchor: { x: ox, y: oy },
    footprint: [
      { x: ox,     y: oy     },
      { x: ox + 1, y: oy     },
      { x: ox,     y: oy + 1 },
      { x: ox + 1, y: oy + 1 },
    ],
  });
}

const isRoad = (t: TileType) => t === TileType.ROAD;
const isPlant = (s: Structure) => s.type === 'power_plant';
const isTower = (s: Structure) => s.type === 'water_tower';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('propagateThroughRoadNetwork', () => {
  describe('empty map — no structures, no roads', () => {
    it('returns all-zero array', () => {
      const map = new GameMap(5, 5);
      const sm = new StructureMap(5, 5);
      const result = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);
      expect(result.every((v) => v === 0)).toBe(true);
      expect(result.length).toBe(25);
    });
  });

  describe('single source touching one road cell', () => {
    it('that road cell plus its non-source orthogonal neighbours are reachable; source cells stay 0', () => {
      // Plant NW at (1,1). Road at (1,0) — adjacent to plant cell (1,1).
      const map = makeMap(10, 10, [{ x: 1, y: 0, type: TileType.ROAD }]);
      const sm = new StructureMap(10, 10);
      addPlant(sm, 1, 1);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);

      // Road cell itself
      expect(r[0 * 10 + 1]).toBe(1); // (1,0)

      // Orthogonal non-structure neighbours of road (1,0): (0,0) and (2,0)
      expect(r[0 * 10 + 0]).toBe(1); // (0,0)
      expect(r[0 * 10 + 2]).toBe(1); // (2,0)

      // Plant footprint cells must stay 0
      expect(r[1 * 10 + 1]).toBe(0); // (1,1)
      expect(r[1 * 10 + 2]).toBe(0); // (2,1)
      expect(r[2 * 10 + 1]).toBe(0); // (1,2)
      expect(r[2 * 10 + 2]).toBe(0); // (2,2)
    });
  });

  describe('5-tile road line, source touching one end', () => {
    it('all 5 road cells and their non-structure neighbours are reachable', () => {
      // Road: (0,0)–(4,0). Plant NW at (0,1).
      const map = makeMap(10, 10, [
        { x: 0, y: 0, type: TileType.ROAD },
        { x: 1, y: 0, type: TileType.ROAD },
        { x: 2, y: 0, type: TileType.ROAD },
        { x: 3, y: 0, type: TileType.ROAD },
        { x: 4, y: 0, type: TileType.ROAD },
      ]);
      const sm = new StructureMap(10, 10);
      addPlant(sm, 0, 1);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);

      // All 5 road cells
      for (let x = 0; x < 5; x++) {
        expect(r[0 * 10 + x]).toBe(1);
      }

      // Neighbour beyond end of line
      expect(r[0 * 10 + 5]).toBe(1); // (5,0)

      // Plant footprint cells stay 0
      expect(r[1 * 10 + 0]).toBe(0);
      expect(r[1 * 10 + 1]).toBe(0);
      expect(r[2 * 10 + 0]).toBe(0);
      expect(r[2 * 10 + 1]).toBe(0);
    });
  });

  describe('split line — middle tile is DIRT (non-conductor)', () => {
    it('only the source-side component is reachable', () => {
      // Road: (0,5),(1,5),(3,5),(4,5) — gap at (2,5). Plant NW at (0,6).
      const map = makeMap(10, 10, [
        { x: 0, y: 5, type: TileType.ROAD },
        { x: 1, y: 5, type: TileType.ROAD },
        { x: 3, y: 5, type: TileType.ROAD },
        { x: 4, y: 5, type: TileType.ROAD },
      ]);
      const sm = new StructureMap(10, 10);
      addPlant(sm, 0, 6);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);

      expect(r[5 * 10 + 0]).toBe(1);
      expect(r[5 * 10 + 1]).toBe(1);
      expect(r[5 * 10 + 3]).toBe(0);
      expect(r[5 * 10 + 4]).toBe(0);
    });
  });

  describe('two sources on shared network — idempotent', () => {
    it('all road cells reachable regardless of which plant is counted', () => {
      // Road: (3,0)–(7,0). Plant A at (3,1); Plant B at (7,1).
      const map = makeMap(10, 10, [
        { x: 3, y: 0, type: TileType.ROAD },
        { x: 4, y: 0, type: TileType.ROAD },
        { x: 5, y: 0, type: TileType.ROAD },
        { x: 6, y: 0, type: TileType.ROAD },
        { x: 7, y: 0, type: TileType.ROAD },
      ]);
      const sm = new StructureMap(10, 10);
      addPlant(sm, 3, 1);
      addPlant(sm, 7, 1);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);

      for (let x = 3; x <= 7; x++) {
        expect(r[0 * 10 + x]).toBe(1);
      }
    });
  });

  describe('two sources on disjoint networks', () => {
    it('each source lights only its own network', () => {
      // Road A: (0,0)–(2,0). Plant A at (0,1).
      // Road B: (7,0)–(9,0). Plant B at (7,1).
      const map = makeMap(10, 10, [
        { x: 0, y: 0, type: TileType.ROAD },
        { x: 1, y: 0, type: TileType.ROAD },
        { x: 2, y: 0, type: TileType.ROAD },
        { x: 7, y: 0, type: TileType.ROAD },
        { x: 8, y: 0, type: TileType.ROAD },
        { x: 9, y: 0, type: TileType.ROAD },
      ]);
      const sm = new StructureMap(10, 10);
      addPlant(sm, 0, 1);
      addPlant(sm, 7, 1);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);

      expect(r[0 * 10 + 0]).toBe(1);
      expect(r[0 * 10 + 1]).toBe(1);
      expect(r[0 * 10 + 2]).toBe(1);

      expect(r[0 * 10 + 7]).toBe(1);
      expect(r[0 * 10 + 8]).toBe(1);
      expect(r[0 * 10 + 9]).toBe(1);

      // Gap between networks
      expect(r[0 * 10 + 4]).toBe(0);
      expect(r[0 * 10 + 5]).toBe(0);
    });
  });

  describe('diagonal-only adjacency', () => {
    it('nothing is reachable when plant is only diagonally adjacent to road', () => {
      // Plant NW at (0,0). Road at (2,2) — diagonal only.
      const map = makeMap(10, 10, [{ x: 2, y: 2, type: TileType.ROAD }]);
      const sm = new StructureMap(10, 10);
      addPlant(sm, 0, 0);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);

      expect(r[2 * 10 + 2]).toBe(0);
    });
  });

  describe('map-edge road with in-bounds source neighbour', () => {
    it('seeds correctly without off-map reads', () => {
      // Map 5×5. Road at (0,0). Plant NW at (0,1).
      const map = makeMap(5, 5, [{ x: 0, y: 0, type: TileType.ROAD }]);
      const sm = new StructureMap(5, 5);
      addPlant(sm, 0, 1);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);

      expect(r[0 * 5 + 0]).toBe(1); // road cell (0,0)
      expect(r[1 * 5 + 0]).toBe(0); // plant cell (0,1) stays 0
    });
  });

  describe('source-selection isolation (Blocker-1 fix)', () => {
    // One power_plant AND one water_tower both road-adjacent on the SAME network.
    function makeMixedSm(sm: StructureMap) {
      // Plant NW at (0,2): footprint (0,2),(1,2),(0,3),(1,3). Adjacent to road (0,1).
      addPlant(sm, 0, 2);
      // Tower NW at (4,2): footprint (4,2),(5,2),(4,3),(5,3). Adjacent to road (4,1).
      addTower(sm, 4, 2);
    }

    function makeMixedMap() {
      // Road line (0,1)–(5,1).
      return makeMap(10, 10, [
        { x: 0, y: 1, type: TileType.ROAD },
        { x: 1, y: 1, type: TileType.ROAD },
        { x: 2, y: 1, type: TileType.ROAD },
        { x: 3, y: 1, type: TileType.ROAD },
        { x: 4, y: 1, type: TileType.ROAD },
        { x: 5, y: 1, type: TileType.ROAD },
      ]);
    }

    it('with power_plant selector: network is reachable', () => {
      const map = makeMixedMap();
      const sm = new StructureMap(10, 10);
      makeMixedSm(sm);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);

      // All road cells lit by the power_plant
      for (let x = 0; x <= 5; x++) {
        expect(r[1 * 10 + x]).toBe(1);
      }
    });

    it('with water_tower selector: network is reachable', () => {
      const map = makeMixedMap();
      const sm = new StructureMap(10, 10);
      makeMixedSm(sm);
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isTower);

      // All road cells lit by the water_tower
      for (let x = 0; x <= 5; x++) {
        expect(r[1 * 10 + x]).toBe(1);
      }
    });

    it('with water_tower selector AND only a power_plant: ALL-ZERO (plant never sources water)', () => {
      const map = makeMixedMap();
      const sm = new StructureMap(10, 10);
      addPlant(sm, 0, 2); // only a plant, no tower

      // No structure passes isTower → BFS never seeds → nothing reachable.
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isTower);
      expect(r.every((v) => v === 0)).toBe(true);
    });

    it('with power_plant selector AND only a water_tower: ALL-ZERO (tower never powers grid)', () => {
      const map = makeMixedMap();
      const sm = new StructureMap(10, 10);
      addTower(sm, 4, 2); // only a tower, no plant

      // No structure passes isPlant → BFS never seeds → nothing reachable.
      const r = propagateThroughRoadNetwork(map, sm, isRoad, isPlant);
      expect(r.every((v) => v === 0)).toBe(true);
    });

    it('structure footprint cells are excluded from reachable in both selector cases', () => {
      const map = makeMixedMap();

      // Test with plant selector
      const sm1 = new StructureMap(10, 10);
      makeMixedSm(sm1);
      const r1 = propagateThroughRoadNetwork(map, sm1, isRoad, isPlant);
      // plant footprint: (0,2),(1,2),(0,3),(1,3) — all must be 0
      expect(r1[2 * 10 + 0]).toBe(0);
      expect(r1[2 * 10 + 1]).toBe(0);
      expect(r1[3 * 10 + 0]).toBe(0);
      expect(r1[3 * 10 + 1]).toBe(0);
      // tower footprint: (4,2),(5,2),(4,3),(5,3) — all must be 0
      expect(r1[2 * 10 + 4]).toBe(0);
      expect(r1[2 * 10 + 5]).toBe(0);
      expect(r1[3 * 10 + 4]).toBe(0);
      expect(r1[3 * 10 + 5]).toBe(0);

      // Test with tower selector
      const sm2 = new StructureMap(10, 10);
      makeMixedSm(sm2);
      const r2 = propagateThroughRoadNetwork(map, sm2, isRoad, isTower);
      expect(r2[2 * 10 + 0]).toBe(0);
      expect(r2[2 * 10 + 1]).toBe(0);
      expect(r2[3 * 10 + 0]).toBe(0);
      expect(r2[3 * 10 + 1]).toBe(0);
      expect(r2[2 * 10 + 4]).toBe(0);
      expect(r2[2 * 10 + 5]).toBe(0);
      expect(r2[3 * 10 + 4]).toBe(0);
      expect(r2[3 * 10 + 5]).toBe(0);
    });
  });
});
