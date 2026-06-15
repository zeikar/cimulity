import { describe, it, expect } from 'vitest';
import { assignTraffic, TRAFFIC_CAPACITY } from './trafficAssignment';
import { GameMap } from './Map';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';
import type { CommuteFlow } from './laborMarket';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMap(
  w: number,
  h: number,
  roads: Array<{ x: number; y: number }>,
): GameMap {
  const map = new GameMap(w, h);
  for (const { x, y } of roads) {
    map.setTile(x, y, createTile(x, y, TileType.ROAD));
  }
  return map;
}

const idxOf = (w: number, x: number, y: number) => y * w + x;

/** A straight road row at `y` spanning `[x0, x1]` inclusive. */
function roadRow(y: number, x0: number, x1: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

// ---------------------------------------------------------------------------
// assignTraffic — flow-driven loading
// ---------------------------------------------------------------------------

describe('assignTraffic — empty flows', () => {
  it('yields all-zero congestion with no flows', () => {
    const map = makeMap(8, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(8, 8);
    const result = assignTraffic(map, sm, []);
    expect(result.length).toBe(64);
    expect(result.every((v) => v === 0)).toBe(true);
  });
});

describe('assignTraffic — straight path', () => {
  it('loads every road tile of the path with the flow count', () => {
    // Road row y=1 from x=1..5. Flow origin (1,1) → dest (5,1), count=1.
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const flows: CommuteFlow[] = [
      { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 5, 1), count: 1 },
    ];

    const result = assignTraffic(map, sm, flows);

    // count=1, capacity=64 → Math.round(255*1/64) = 4 on every path road tile.
    const expected = Math.round((255 * 1) / TRAFFIC_CAPACITY);
    for (let x = 1; x <= 5; x++) {
      expect(result[idxOf(w, x, 1)]).toBe(expected);
    }
  });
});

describe('assignTraffic — L-shape shortest path + dead-end', () => {
  it('loads exactly the shortest-path tiles and zero on a dead-end branch', () => {
    // L-shaped road. Origin access (1,1), destination access (3,3).
    // Path: (1,1)->(1,2)->(1,3)->(2,3)->(3,3). Dead-end (1,4),(1,5) off the corner.
    const w = 12;
    const h = 12;
    const path = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];
    const deadEnd = [
      { x: 1, y: 4 },
      { x: 1, y: 5 },
    ];
    const map = makeMap(w, h, [...path, ...deadEnd]);
    const sm = new StructureMap(w, h);
    const flows: CommuteFlow[] = [
      { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 3, 3), count: 1 },
    ];

    const result = assignTraffic(map, sm, flows);

    for (const { x, y } of path) {
      expect(result[idxOf(w, x, y)]).toBeGreaterThan(0);
    }
    for (const { x, y } of deadEnd) {
      expect(result[idxOf(w, x, y)]).toBe(0);
    }
  });
});

describe('assignTraffic — exact per-destination routing (overflow)', () => {
  it('routes to the FARTHER destNode when the flow names it, NOT the nearer node', () => {
    // Origin access (5,1). A near job at (3,1) — 2 hops — and a far job at (9,1)
    // — 4 hops. The flow's destNode is the FAR node (9,1), proving exact
    // per-destination routing: the load must follow the far path (6..9), not
    // collapse to the nearest node in the set.
    const w = 14;
    const map = makeMap(w, 8, roadRow(1, 3, 9));
    const sm = new StructureMap(w, 8);
    const flows: CommuteFlow[] = [
      { originNode: idxOf(w, 5, 1), destNode: idxOf(w, 9, 1), count: 1 },
    ];

    const result = assignTraffic(map, sm, flows);

    const expected = Math.round((255 * 1) / TRAFFIC_CAPACITY);
    // Far side (5..9) carries the load.
    for (let x = 5; x <= 9; x++) {
      expect(result[idxOf(w, x, 1)]).toBe(expected);
    }
    // Near branch (3..4), the WRONG (nearer) direction, stays empty.
    for (let x = 3; x <= 4; x++) {
      expect(result[idxOf(w, x, 1)]).toBe(0);
    }
  });
});

describe('assignTraffic — capacity clamp', () => {
  it('clamps over-capacity accumulation at 255', () => {
    // A single flow whose count far exceeds TRAFFIC_CAPACITY clamps to 255.
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const flows: CommuteFlow[] = [
      { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 5, 1), count: 1000 },
    ];

    const result = assignTraffic(map, sm, flows);

    for (let x = 1; x <= 5; x++) {
      expect(result[idxOf(w, x, 1)]).toBe(255);
    }
  });
});

describe('assignTraffic — load scales with flow count', () => {
  it('higher count produces proportionally higher load', () => {
    const w = 10;
    const roads = roadRow(1, 1, 5);

    const build = (count: number) => {
      const map = makeMap(w, 8, roads);
      const sm = new StructureMap(w, 8);
      const flows: CommuteFlow[] = [
        { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 5, 1), count },
      ];
      return assignTraffic(map, sm, flows)[idxOf(w, 3, 1)];
    };

    const low = build(2);
    const high = build(6);
    expect(high).toBe(Math.round((255 * 6) / TRAFFIC_CAPACITY));
    expect(low).toBe(Math.round((255 * 2) / TRAFFIC_CAPACITY));
    expect(high).toBeGreaterThan(low);
  });
});

describe('assignTraffic — unreachable origin/destination guard', () => {
  it('adds no load when the origin cannot reach the destination', () => {
    // Origin road segment and destination road segment are disconnected, so the
    // reverse BFS from destNode never reaches originNode (destDist === -1).
    const w = 12;
    const map = makeMap(w, 8, [
      { x: 1, y: 1 }, // origin access only
      { x: 9, y: 1 }, // destination access only — separate segment
    ]);
    const sm = new StructureMap(w, 8);
    const flows: CommuteFlow[] = [
      { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 9, 1), count: 3 },
    ];

    const result = assignTraffic(map, sm, flows);
    expect(result.every((v) => v === 0)).toBe(true);
  });
});

describe('assignTraffic — capacity-limited total load', () => {
  it('fewer commuters yield strictly less summed road load than every worker', () => {
    // Same road geometry, same single O-D pair. A flow carrying fewer workers
    // must produce strictly less total road load than one carrying every worker.
    const w = 10;
    const roads = roadRow(1, 1, 5);

    const totalLoad = (count: number) => {
      const map = makeMap(w, 8, roads);
      const sm = new StructureMap(w, 8);
      const flows: CommuteFlow[] = [
        { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 5, 1), count },
      ];
      const result = assignTraffic(map, sm, flows);
      let sum = 0;
      for (const v of result) sum += v;
      return sum;
    };

    const partial = totalLoad(2); // capacity-limited matching: only some workers commute
    const full = totalLoad(8); // every worker commutes
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(full);
  });
});

describe('assignTraffic — output shape', () => {
  it('returns a Uint8Array of length w*h with every value in 0..255', () => {
    const w = 10;
    const h = 8;
    const map = makeMap(w, h, roadRow(1, 1, 5));
    const sm = new StructureMap(w, h);
    const flows: CommuteFlow[] = [
      { originNode: idxOf(w, 1, 1), destNode: idxOf(w, 5, 1), count: 1000 },
    ];

    const result = assignTraffic(map, sm, flows);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(w * h);
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
