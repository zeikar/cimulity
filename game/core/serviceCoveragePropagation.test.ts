import { describe, it, expect } from 'vitest';
import {
  propagateServiceCoverage,
  SERVICE_RANGE_TILES,
  OFF_ROAD_RADIUS_TILES,
  offRoadFactor,
} from './serviceCoveragePropagation';
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

/** Canonical 2×2 NW-anchored police_station. */
function addStation(sm: StructureMap, ox: number, oy: number) {
  return sm.addStructure({
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

const isRoad = (t: TileType) => t === TileType.ROAD;
const isStation = (s: Structure) => s.type === 'police_station';

// ---------------------------------------------------------------------------
// Helpers for single-seed scenarios
// ---------------------------------------------------------------------------

/**
 * Build a scenario where exactly ONE road cell is seeded at distance 0.
 *
 * Station at anchor (0,0) → footprint (0,0),(1,0),(0,1),(1,1).
 * Road runs east from (2,0). The only footprint cell adjacent to a road cell
 * is (1,0) → (2,0). All other non-footprint neighbours of the footprint
 * ((0,2),(2,1),(1,2)) are not road, and (-1,*) / (*,-1) are OOB.
 *
 * So (2,0) is the sole seed (d=0). Cell at x = 2+d has road distance d.
 */
function makeSingleSeedSetup(roadLen: number): { map: GameMap; sm: StructureMap; w: number; h: number; seedX: number } {
  const w = roadLen + 5;
  const h = 10;
  const overrides: Array<{ x: number; y: number; type: TileType }> = [];
  for (let x = 2; x < 2 + roadLen; x++) {
    overrides.push({ x, y: 0, type: TileType.ROAD });
  }
  const map = makeMap(w, h, overrides);
  const sm = new StructureMap(w, h);
  addStation(sm, 0, 0);
  return { map, sm, w, h, seedX: 2 };
}

// ---------------------------------------------------------------------------
// offRoadFactor unit tests
// ---------------------------------------------------------------------------

describe('offRoadFactor', () => {
  it('returns 1.0 at offDist 1', () => {
    expect(offRoadFactor(1)).toBe(1.0);
  });

  it('returns 0.5 at offDist 2', () => {
    expect(offRoadFactor(2)).toBe(0.5);
  });

  it('returns 0 at offDist 3 (beyond OFF_ROAD_RADIUS_TILES)', () => {
    expect(offRoadFactor(3)).toBe(0);
  });

  it('returns 0 at offDist 0', () => {
    expect(offRoadFactor(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Linear falloff tests (single-seed setup to get exact distances)
// ---------------------------------------------------------------------------

describe('propagateServiceCoverage — linear falloff', () => {
  it('d=0 (adjacent to station) yields intensity 255', () => {
    // Single-seed: station at (0,0), road starts at (2,0). Seed cell is (2,0) at d=0.
    const { map, sm, w } = makeSingleSeedSetup(25);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 2]).toBe(255); // (2,0) d=0
  });

  it('d=12 (mid-range) yields intensity 128', () => {
    // Single-seed setup: seed at (2,0) → d=0. Cell (14,0) → d=12.
    // Math.round(255 * (1 - 12/24)) = Math.round(255 * 0.5) = Math.round(127.5) = 128.
    const { map, sm, w } = makeSingleSeedSetup(26);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 14]).toBe(128); // (14,0) d=12
  });

  it('d=SERVICE_RANGE_TILES (24) yields intensity 0', () => {
    // Seed at (2,0) → d=0. Cell (26,0) → d=24.
    // Math.round(255 * (1 - 24/24)) = Math.round(0) = 0.
    const { map, sm, w } = makeSingleSeedSetup(26);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 2 + SERVICE_RANGE_TILES]).toBe(0); // d=24 → 0
  });

  it('coverage stays 0 for road cells beyond SERVICE_RANGE_TILES', () => {
    // Road runs 27 cells from (2,0). Cell (2+25,0)=(27,0) → d=25 → BFS does
    // not expand past d=24, so (27,0) stays 0.
    const { map, sm, w } = makeSingleSeedSetup(27);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 27]).toBe(0); // d=25 — not reached
  });
});

// ---------------------------------------------------------------------------
// MAX-across-two-stations = falloff(min distance)
// ---------------------------------------------------------------------------

describe('propagateServiceCoverage — MAX-across-two-stations', () => {
  it('tile reachable from two stations gets falloff(min distance)', () => {
    // Two single-seed stations on a shared road line.
    // Station A at (0,0): seed → (2,0) at d=0.
    // Station B at (22,0): footprint (22,0),(23,0),(22,1),(23,1).
    //   Footprint cell (22,0) is a structure cell, NOT a road cell. We need
    //   road from x=2..21 (stations own x=0..1 and x=22..23).
    //   Station B adjacent non-footprint cells: (21,0) left of (22,0) — that's a road cell ✓.
    //   So station B seeds (21,0) at d=0.
    // Road: (2,0)–(21,0) = 20 road cells (width 20).
    // Seed from A: (2,0) d=0. Seed from B: (21,0) d=0.
    // Cell (10,0): d from A seed = 8, d from B seed = 11 → min = 8.
    // Expected: Math.round(255 * (1 - 8/24)).
    const w = 30;
    const h = 10;
    const overrides: Array<{ x: number; y: number; type: TileType }> = [];
    for (let x = 2; x <= 21; x++) {
      overrides.push({ x, y: 0, type: TileType.ROAD });
    }
    const map = makeMap(w, h, overrides);
    const sm = new StructureMap(w, h);
    addStation(sm, 0, 0); // footprint (0,0),(1,0),(0,1),(1,1); seeds (2,0)
    addStation(sm, 22, 0); // footprint (22,0),(23,0),(22,1),(23,1); seeds (21,0)
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    // (10,0): d=8 from A, d=11 from B → min=8
    const expected = Math.round(255 * (1 - 8 / SERVICE_RANGE_TILES));
    expect(result[0 * w + 10]).toBe(expected);
  });

  it('cell closer to station B gets falloff from B (min distance wins)', () => {
    // Same setup as above. Cell (18,0): d from A seed (2,0) = 16, d from B seed (21,0) = 3.
    // Min = 3. Expected: Math.round(255 * (1 - 3/24)).
    const w = 30;
    const h = 10;
    const overrides: Array<{ x: number; y: number; type: TileType }> = [];
    for (let x = 2; x <= 21; x++) {
      overrides.push({ x, y: 0, type: TileType.ROAD });
    }
    const map = makeMap(w, h, overrides);
    const sm = new StructureMap(w, h);
    addStation(sm, 0, 0);
    addStation(sm, 22, 0);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    const expected = Math.round(255 * (1 - 3 / SERVICE_RANGE_TILES));
    expect(result[0 * w + 18]).toBe(expected);
  });

  it('midpoint between two equidistant stations gets falloff(equidistant distance)', () => {
    // Station A seeds (2,0), Station B seeds (21,0).
    // Midpoint: (11,0) or (12,0). Check (11,0): d from A=9, d from B=10 → min=9.
    // Math.round(255*(1-9/24)).
    const w = 30;
    const h = 10;
    const overrides: Array<{ x: number; y: number; type: TileType }> = [];
    for (let x = 2; x <= 21; x++) {
      overrides.push({ x, y: 0, type: TileType.ROAD });
    }
    const map = makeMap(w, h, overrides);
    const sm = new StructureMap(w, h);
    addStation(sm, 0, 0);
    addStation(sm, 22, 0);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    // Without station B, (11,0) would be at d=9 from A → same value.
    // With station B, (11,0) is still min(9,10)=9. The MAX-across-stations
    // property means we never get a WORSE value than without station B.
    const expected = Math.round(255 * (1 - 9 / SERVICE_RANGE_TILES));
    expect(result[0 * w + 11]).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Station with no road-adjacent cell → all zero
// ---------------------------------------------------------------------------

describe('propagateServiceCoverage — no road-adjacent station', () => {
  it('yields all-zero coverage when no road cell is adjacent to the station', () => {
    // Station at (5,5)-(6,6). No roads placed.
    const map = makeMap(15, 15, []);
    const sm = new StructureMap(15, 15);
    addStation(sm, 5, 5);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result.every((v) => v === 0)).toBe(true);
  });

  it('yields all-zero coverage on empty map with no structures', () => {
    const map = new GameMap(10, 10);
    const sm = new StructureMap(10, 10);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result.every((v) => v === 0)).toBe(true);
    expect(result.length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Off-road sweep tests
// ---------------------------------------------------------------------------

describe('propagateServiceCoverage — off-road sweep', () => {
  /**
   * Isolated off-road sweep scenario:
   * Station at (0,0) → footprint (0,0),(1,0),(0,1),(1,1).
   * Single road cell at (2,0) — the sole seed at d=0 → intensity 255.
   * Non-road cells to the right/above/below (2,0) are off-road.
   */
  function makeOffRoadSetup(): { map: GameMap; sm: StructureMap; w: number; h: number } {
    const w = 15;
    const h = 10;
    const map = makeMap(w, h, [{ x: 2, y: 0, type: TileType.ROAD }]);
    const sm = new StructureMap(w, h);
    addStation(sm, 0, 0);
    return { map, sm, w, h };
  }

  it('non-road cell at offDist 1 gets full road intensity (offRoadFactor=1.0)', () => {
    // (2,0) is road (d=0, intensity 255). (3,0) is non-road, offDist=1 from (2,0).
    // Expected: Math.round(255 * 1.0) = 255.
    const { map, sm, w } = makeOffRoadSetup();
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 3]).toBe(255); // (3,0): offDist 1
  });

  it('non-road cell at offDist 2 gets half road intensity (offRoadFactor=0.5)', () => {
    // (4,0) is offDist 2 from road (2,0). Expected: Math.round(255 * 0.5) = 128.
    const { map, sm, w } = makeOffRoadSetup();
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 4]).toBe(128); // (4,0): offDist 2
  });

  it('non-road cell at offDist 3 stays 0 (beyond OFF_ROAD_RADIUS_TILES)', () => {
    // (5,0) is offDist 3 from road (2,0). offRoadFactor(3)=0 → stays 0.
    const { map, sm, w } = makeOffRoadSetup();
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 5]).toBe(0); // (5,0): offDist 3
  });

  it('OFF_ROAD_RADIUS_TILES constant equals 2', () => {
    expect(OFF_ROAD_RADIUS_TILES).toBe(2);
  });

  it('off-road cell reachable from two covered roads at offDist 1 each takes MAX (255)', () => {
    // Station A seeds (2,0) at d=0 → intensity 255.
    // Station B seeds (4,0) at d=0 → intensity 255.
    // Off-road cell (3,0) is at offDist 1 from (2,0) AND offDist 1 from (4,0).
    // MAX(255*1.0, 255*1.0) = 255.
    const w = 15;
    const h = 10;
    const map = makeMap(w, h, [
      { x: 2, y: 0, type: TileType.ROAD },
      { x: 4, y: 0, type: TileType.ROAD },
    ]);
    const sm = new StructureMap(w, h);
    // Station A at (0,0) seeds (2,0). Station B at (5,0) seeds (4,0).
    // Station B footprint: (5,0),(6,0),(5,1),(6,1). Adjacent non-footprint: (4,0) ✓.
    addStation(sm, 0, 0);
    addStation(sm, 5, 0);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 3]).toBe(255); // (3,0): offDist 1 from two 255-intensity roads
  });

  it('off-road cell gets value from nearest highest-intensity road', () => {
    // Single-seed station. Road: (2,0)–(6,0). Station at (0,0) seeds (2,0) at d=0.
    // (2,0) d=0 → 255. (3,0) d=1 → Math.round(255*(1-1/24)) = Math.round(244.375) = 244.
    // Off-road cell (3,1): offDist 1 from road (3,0) AND offDist 2 from road (2,0).
    // From (3,0) at intensity 244: Math.round(244*1.0)=244.
    // From (2,0) at intensity 255: Math.round(255*0.5)=128.
    // MAX = 244.
    const w = 15;
    const h = 10;
    const overrides: Array<{ x: number; y: number; type: TileType }> = [];
    for (let x = 2; x <= 6; x++) {
      overrides.push({ x, y: 0, type: TileType.ROAD });
    }
    const map = makeMap(w, h, overrides);
    const sm = new StructureMap(w, h);
    addStation(sm, 0, 0);
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    const roadIntensityAt3 = Math.round(255 * (1 - 1 / SERVICE_RANGE_TILES));
    // offDist 1 from (3,0): Math.round(roadIntensityAt3 * 1.0)
    const expected = Math.round(roadIntensityAt3 * offRoadFactor(1));
    expect(result[1 * w + 3]).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Structure-owned cells excluded from off-road sweep
// ---------------------------------------------------------------------------

describe('propagateServiceCoverage — structure cells excluded', () => {
  it('source station footprint cells themselves are 0', () => {
    // Station at (0,0) → road at (2,0) seeded. Footprint (0,0),(1,0),(0,1),(1,1) stay 0.
    const { map, sm, w } = (() => {
      const w = 10;
      const h = 10;
      const map = makeMap(w, h, [{ x: 2, y: 0, type: TileType.ROAD }]);
      const sm = new StructureMap(w, h);
      addStation(sm, 0, 0);
      return { map, sm, w };
    })();
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    expect(result[0 * w + 2]).toBe(255); // road seeded at d=0 → full intensity
    expect(result[0 * w + 0]).toBe(0); // footprint (0,0)
    expect(result[0 * w + 1]).toBe(0); // footprint (1,0)
    expect(result[1 * w + 0]).toBe(0); // footprint (0,1)
    expect(result[1 * w + 1]).toBe(0); // footprint (1,1)
  });

  it('non-source structure footprint cells stay 0 even when adjacent to covered road', () => {
    // Source station A at (0,0): seeds (2,0). Road from (2,0)–(8,0).
    // Non-source structure B (a power_plant) at (5,1): footprint (5,1),(6,1),(5,2),(6,2).
    // Road (5,0) is adjacent to structure B footprint cell (5,1), but structure B
    // is NOT a police_station → isStation(B)=false → B just has its footprint excluded.
    const w = 15;
    const h = 10;
    const overrides: Array<{ x: number; y: number; type: TileType }> = [];
    for (let x = 2; x <= 8; x++) {
      overrides.push({ x, y: 0, type: TileType.ROAD });
    }
    const map = makeMap(w, h, overrides);
    const sm = new StructureMap(w, h);
    addStation(sm, 0, 0); // source
    sm.addStructure({    // non-source structure, footprint should stay 0
      type: 'power_plant',
      anchor: { x: 5, y: 1 },
      footprint: [
        { x: 5, y: 1 }, { x: 6, y: 1 },
        { x: 5, y: 2 }, { x: 6, y: 2 },
      ],
    });
    const result = propagateServiceCoverage(map, sm, isRoad, isStation);

    // Road cells should be covered — (5,0) is 3 hops from the seed at (2,0):
    // Math.round(255 * (1 - 3/24)) = 223
    expect(result[0 * w + 5]).toBe(223);

    // Power plant footprint cells stay 0
    expect(result[1 * w + 5]).toBe(0);
    expect(result[1 * w + 6]).toBe(0);
    expect(result[2 * w + 5]).toBe(0);
    expect(result[2 * w + 6]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('SERVICE_RANGE_TILES is 24', () => {
    expect(SERVICE_RANGE_TILES).toBe(24);
  });

  it('OFF_ROAD_RADIUS_TILES is 2', () => {
    expect(OFF_ROAD_RADIUS_TILES).toBe(2);
  });
});
