/**
 * Pure all-or-nothing static traffic assignment over the ROAD graph.
 *
 * Each non-abandoned residential ORIGIN routes its whole trip volume (= its
 * `level`) to the SINGLE nearest reachable job DESTINATION (commercial OR
 * industrial), measured in road-hop distance, and accumulates that volume on
 * EVERY road tile along ONE shortest path. The result is normalized per road
 * tile against `TRAFFIC_CAPACITY` into a `0..255` congestion value.
 *
 * ALGORITHM:
 *   - Each building's ACCESS NODE is the lowest-cell-index ROAD cell on its
 *     frontage face (mirrors the growth road-access gate). A building whose
 *     frontage face has no road has access node -1 and neither originates nor
 *     attracts trips.
 *   - A SINGLE multi-source REVERSE BFS is seeded from ALL destination access
 *     nodes at once (`destDist = 0`, `nextHop = -1`). At discovery of an
 *     unvisited ROAD (non-structure) neighbour it records
 *     `destDist[n] = destDist[cur] + 1` and `nextHop[n] = cur`, yielding per
 *     road node the hop-distance to the NEAREST destination plus the next hop
 *     toward it.
 *   - For each origin with a reachable access node, walk `nextHop` to the
 *     destination adding `vol = b.level` to every node on the path (incl. the
 *     destination). Termination is guaranteed: `destDist` strictly decreases by
 *     1 each hop, so no per-origin visited guard is needed.
 *
 * DATA-ONLY: this module reads the maps and mutates NOTHING. It is not wired
 * into render or simulation feedback here, and is not persisted. It must NOT
 * import `World` or `zoneGrowth` (both are World-coupled).
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { Building, BuildingMap } from './Building';
import { TileType } from './Tile';
import { lotBboxOf } from './buildingFootprint';

const ORTHOGONAL = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

/**
 * Trip volume (road-tile load) at which a road tile is considered fully
 * congested (normalized value 255). The single normalization knob.
 */
export const TRAFFIC_CAPACITY = 64;

/**
 * Lowest-cell-index ROAD cell on a building's frontage face, or -1 if the
 * frontage face has no road. Mirrors `countRoadsOnFace`'s per-frontage scan
 * (N → row above, S → row below, W → column left, E → column right), reading
 * `map.getTile` directly — never via `World`/`zoneGrowth`.
 */
export function accessNodeFor(map: GameMap, b: Building): number {
  const w = map.getWidth();
  const rect = lotBboxOf(b.footprint);
  let best = -1;

  const consider = (x: number, y: number) => {
    const t = map.getTile(x, y);
    if (t === null || t.type !== TileType.ROAD) return;
    const idx = y * w + x;
    if (best === -1 || idx < best) best = idx;
  };

  switch (b.frontage) {
    case 'N':
      for (let x = rect.x; x < rect.x + rect.w; x++) consider(x, rect.y - 1);
      break;
    case 'S':
      for (let x = rect.x; x < rect.x + rect.w; x++) consider(x, rect.y + rect.h);
      break;
    case 'W':
      for (let y = rect.y; y < rect.y + rect.h; y++) consider(rect.x - 1, y);
      break;
    case 'E':
      for (let y = rect.y; y < rect.y + rect.h; y++) consider(rect.x + rect.w, y);
      break;
  }

  return best;
}

/**
 * Compute per-road-tile traffic congestion `0..255` via all-or-nothing
 * nearest-job static assignment. See module JSDoc for the full algorithm.
 *
 * Returns a `Uint8Array` of length `map.getWidth() * map.getHeight()`.
 */
export function assignTraffic(
  map: GameMap,
  structures: StructureMap,
  buildings: BuildingMap,
): Uint8Array {
  const w = map.getWidth();
  const h = map.getHeight();
  const out = new Uint8Array(w * h);

  // Mark every cell owned by ANY structure so the road graph never routes
  // through a placed structure footprint (mirrors the sibling propagators).
  const structureOwned = new Uint8Array(w * h);
  for (const s of structures.iterStructures()) {
    for (const c of s.footprint) {
      structureOwned[c.y * w + c.x] = 1;
    }
  }

  // Multi-source reverse BFS state: hop-distance to the nearest destination
  // access node, and the next-hop road cell toward it. -1 = unvisited.
  const destDist = new Int32Array(w * h).fill(-1);
  const nextHop = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];

  // Seed every unique destination access node (non-abandoned commercial OR
  // industrial). All-or-nothing assignment is unweighted on the destination
  // side, so a node reached from multiple destinations needs seeding once.
  for (const b of buildings.iterBuildings()) {
    if (b.abandoned) continue;
    if (b.type !== 'commercial' && b.type !== 'industrial') continue;
    const node = accessNodeFor(map, b);
    if (node < 0) continue;
    if (destDist[node] !== -1) continue; // already seeded
    destDist[node] = 0;
    nextHop[node] = -1;
    queue.push(node);
  }

  // Reverse BFS over ROAD (non-structure) cells. Discovery-time parent pointer:
  // when dequeuing `idx`, an unvisited ROAD neighbour records its distance and
  // its next hop back toward the nearest destination.
  let qHead = 0;
  while (qHead < queue.length) {
    const idx = queue[qHead++];
    const cx = idx % w;
    const cy = (idx - cx) / w;
    const d = destDist[idx];

    for (const { dx, dy } of ORTHOGONAL) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (destDist[nIdx] !== -1) continue; // already visited
      if (structureOwned[nIdx] === 1) continue;
      const expandTile = map.getTile(nx, ny);
      if (!expandTile || expandTile.type !== TileType.ROAD) continue;
      destDist[nIdx] = d + 1;
      nextHop[nIdx] = idx;
      queue.push(nIdx);
    }
  }

  // Accumulate raw load: each origin pushes its volume along the single
  // shortest path to the nearest destination.
  const load = new Float64Array(w * h);
  for (const b of buildings.iterBuildings()) {
    if (b.abandoned) continue;
    if (b.type !== 'residential') continue;
    const o = accessNodeFor(map, b);
    if (o < 0 || destDist[o] === -1) continue;
    const vol = b.level;
    let cur = o;
    while (destDist[cur] > 0) {
      load[cur] += vol;
      cur = nextHop[cur];
    }
    load[cur] += vol; // destination node
  }

  // Normalize against capacity, clamped to 255.
  for (let i = 0; i < load.length; i++) {
    if (load[i] === 0) continue;
    out[i] = Math.min(255, Math.round((255 * load[i]) / TRAFFIC_CAPACITY));
  }

  return out;
}
