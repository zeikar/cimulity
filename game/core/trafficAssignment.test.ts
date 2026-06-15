import { describe, it, expect } from 'vitest';
import { assignTraffic, TRAFFIC_CAPACITY } from './trafficAssignment';
import { GameMap } from './Map';
import { BuildingMap, type BuildingType } from './Building';
import { StructureMap } from './StructureMap';
import { TileType, createTile } from './Tile';
import type { Frontage } from './buildingFootprint';

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

/**
 * Add a 1×1 building at (x,y). For a 1×1 lot any frontage pins the
 * structureRect to the whole lot, so the rect is always {x,y,1,1}.
 */
function addBuilding(
  bm: BuildingMap,
  x: number,
  y: number,
  type: BuildingType,
  frontage: Frontage,
  opts: { level?: number; abandoned?: boolean } = {},
) {
  return bm.addBuilding({
    type,
    level: opts.level ?? 1,
    density: 0,
    age: 0,
    abandoned: opts.abandoned ?? false,
    frontage,
    footprint: [{ x, y }],
    anchor: { x, y },
    structureRect: { x, y, w: 1, h: 1 },
  });
}

const idxOf = (w: number, x: number, y: number) => y * w + x;

/** A straight road row at `y` spanning `[x0, x1]` inclusive. */
function roadRow(y: number, x0: number, x1: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

// ---------------------------------------------------------------------------
// assignTraffic
// ---------------------------------------------------------------------------

describe('assignTraffic — empty world', () => {
  it('yields all-zero congestion with no buildings or roads', () => {
    const map = new GameMap(8, 8);
    const sm = new StructureMap(8, 8);
    const bm = new BuildingMap(8, 8);
    const result = assignTraffic(map, sm, bm);
    expect(result.length).toBe(64);
    expect(result.every((v) => v === 0)).toBe(true);
  });
});

describe('assignTraffic — straight road origin → destination', () => {
  it('loads every road tile of the path with the residential level', () => {
    // Residential at (1,0) frontage S → access (1,1).
    // Commercial at (5,0) frontage S → access (5,1).
    // Road row y=1 from x=1..5 connects them.
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
    addBuilding(bm, 5, 0, 'commercial', 'S', { level: 1 });

    const result = assignTraffic(map, sm, bm);

    // level=1, capacity=64 → Math.round(255*1/64) = 4 on every path road tile.
    const expected = Math.round((255 * 1) / TRAFFIC_CAPACITY);
    for (let x = 1; x <= 5; x++) {
      expect(result[idxOf(w, x, 1)]).toBe(expected);
    }
  });
});

describe('assignTraffic — observable shortest path & termination', () => {
  it('loads exactly the shortest-path tiles and zero on a dead-end branch', () => {
    // L-shaped road. Origin access at (1,1), destination access at (3,3).
    // Path road tiles: (1,1)->(1,2)->(1,3)->(2,3)->(3,3).
    // Dead-end branch off the corner: (1,4),(1,5) — never on the route.
    //
    // Residential at (1,0) frontage S → access (1,1).
    // Commercial at (3,4) frontage N → access (3,3).
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
    const bm = new BuildingMap(w, h);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
    addBuilding(bm, 3, 4, 'commercial', 'N', { level: 1 });

    const result = assignTraffic(map, sm, bm);

    for (const { x, y } of path) {
      expect(result[idxOf(w, x, y)]).toBeGreaterThan(0);
    }
    for (const { x, y } of deadEnd) {
      expect(result[idxOf(w, x, y)]).toBe(0);
    }
  });
});

describe('assignTraffic — abandoned buildings', () => {
  it('adds no load when the origin is abandoned', () => {
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 1, abandoned: true });
    addBuilding(bm, 5, 0, 'commercial', 'S', { level: 1 });

    const result = assignTraffic(map, sm, bm);
    expect(result.every((v) => v === 0)).toBe(true);
  });

  it('adds no load when the only destination is abandoned', () => {
    const w = 10;
    const map = makeMap(w, 8, roadRow(1, 1, 5));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 1 });
    addBuilding(bm, 5, 0, 'commercial', 'S', { level: 1, abandoned: true });

    const result = assignTraffic(map, sm, bm);
    expect(result.every((v) => v === 0)).toBe(true);
  });
});

describe('assignTraffic — no reachable destination', () => {
  it('adds no load when the residential cannot reach any job', () => {
    // Origin road segment and destination road segment are disconnected.
    const w = 12;
    const map = makeMap(w, 8, [
      { x: 1, y: 1 }, // origin access only
      { x: 9, y: 1 }, // destination access only — separate segment
    ]);
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 0, 'residential', 'S', { level: 3 });
    addBuilding(bm, 9, 0, 'commercial', 'S', { level: 1 });

    const result = assignTraffic(map, sm, bm);
    expect(result.every((v) => v === 0)).toBe(true);
  });
});

describe('assignTraffic — frontage-derived access', () => {
  it('a building whose frontage face has no road commutes nothing', () => {
    // Road only to the WEST of both buildings; frontage is S for both, so
    // neither has a frontage-face road → no access node → no trips.
    const w = 10;
    const map = makeMap(w, 8, [
      { x: 0, y: 3 }, // west of residential (1,3)
      { x: 4, y: 3 }, // west of commercial (5,3)
    ]);
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 1, 3, 'residential', 'S', { level: 2 });
    addBuilding(bm, 5, 3, 'commercial', 'S', { level: 1 });

    const result = assignTraffic(map, sm, bm);
    expect(result.every((v) => v === 0)).toBe(true);
  });
});

describe('assignTraffic — nearest of two destinations', () => {
  it('routes to the nearer job, leaving the far branch empty', () => {
    // Origin access (5,1). Near commercial access (3,1) — 2 hops.
    // Far industrial access (9,1) — 4 hops. Road row y=1 from x=3..9.
    const w = 14;
    const map = makeMap(w, 8, roadRow(1, 3, 9));
    const sm = new StructureMap(w, 8);
    const bm = new BuildingMap(w, 8);
    addBuilding(bm, 5, 0, 'residential', 'S', { level: 1 });
    addBuilding(bm, 3, 0, 'commercial', 'S', { level: 1 }); // near
    addBuilding(bm, 9, 0, 'industrial', 'S', { level: 1 }); // far

    const result = assignTraffic(map, sm, bm);

    const expected = Math.round((255 * 1) / TRAFFIC_CAPACITY);
    // Near side (3..5) carries load.
    for (let x = 3; x <= 5; x++) {
      expect(result[idxOf(w, x, 1)]).toBe(expected);
    }
    // Far side (6..9) stays empty.
    for (let x = 6; x <= 9; x++) {
      expect(result[idxOf(w, x, 1)]).toBe(0);
    }
  });
});

describe('assignTraffic — capacity clamp', () => {
  it('clamps over-capacity accumulation at 255', () => {
    // Many residential origins share a single road bottleneck to one job so
    // the combined load far exceeds TRAFFIC_CAPACITY at the bottleneck tile.
    const w = 12;
    const h = 12;
    // Road column x=1 from y=1..10, the last cell being the destination access.
    const roads: Array<{ x: number; y: number }> = [];
    for (let y = 1; y <= 10; y++) roads.push({ x: 1, y });
    const map = makeMap(w, h, roads);
    const sm = new StructureMap(w, h);
    const bm = new BuildingMap(w, h);
    // Residential buildings to the WEST of the column, frontage E → access on x=1.
    for (let y = 1; y <= 9; y++) {
      addBuilding(bm, 0, y, 'residential', 'E', { level: 8 });
    }
    // Destination commercial south of the column tail, frontage N → access (1,10).
    addBuilding(bm, 1, 11, 'commercial', 'N', { level: 1 });

    const result = assignTraffic(map, sm, bm);

    // The bottleneck tile (1,10) carries every origin's volume (9 * 8 = 72),
    // 72/64 normalized far exceeds 255 → clamped to 255.
    expect(result[idxOf(w, 1, 10)]).toBe(255);
  });
});

describe('assignTraffic — load scales with origin level', () => {
  it('higher-level origin produces proportionally higher load', () => {
    const w = 10;
    const roads = roadRow(1, 1, 5);

    const build = (level: number) => {
      const map = makeMap(w, 8, roads);
      const sm = new StructureMap(w, 8);
      const bm = new BuildingMap(w, 8);
      addBuilding(bm, 1, 0, 'residential', 'S', { level });
      addBuilding(bm, 5, 0, 'commercial', 'S', { level: 1 });
      return assignTraffic(map, sm, bm)[idxOf(w, 3, 1)];
    };

    const low = build(2);
    const high = build(6);
    expect(high).toBe(Math.round((255 * 6) / TRAFFIC_CAPACITY));
    expect(low).toBe(Math.round((255 * 2) / TRAFFIC_CAPACITY));
    expect(high).toBeGreaterThan(low);
  });
});
