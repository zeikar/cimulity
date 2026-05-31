/**
 * Graded road-network service coverage propagation. Sibling to the binary
 * `propagateThroughRoadNetwork` helper — same seed/sweep SHAPE, but returns a
 * `Uint8Array` of intensity values `0..255` instead of a 0/1 bit.
 *
 * ALGORITHM NOTE — why one visited-flag BFS is exact for MAX-across-stations:
 *   All stations are equal strength. Falloff `1 - d/RANGE` is monotonically
 *   decreasing in road-hop distance `d`. Therefore, for any road cell reachable
 *   from N stations, MAX coverage across stations = falloff(MIN distance to any
 *   station). A multi-source visited-flag FIFO BFS seeded simultaneously from
 *   ALL station-adjacent road cells at distance 0 yields the MIN distance to
 *   ANY station per cell in a single pass — exactly what we need. No
 *   mini-Dijkstra, no per-cell relaxation, no re-enqueue.
 *
 * OFF-ROAD FRONTAGE NOTE:
 *   Road cells receive distance-falloff intensity (Step 4). Off-road cells at
 *   orthogonal-hop distance 1 from a covered road cell receive the road cell's
 *   FULL intensity (offRoadFactor(1) = 1.0) — decay starts BEHIND the frontage,
 *   not at it. Cells at offDist 2 get half; beyond 2 get 0.
 *
 * CLONEABLE SHAPE NOTE:
 *   This helper plus the `ServiceCoverageMap` wrapper pattern are what future
 *   fire/hospital coverage maps reuse. Each will be a sibling file hard-coding
 *   its own source type (e.g. `s.type === 'fire_station'`) — NOT a runtime
 *   source-predicate switch. Fire and hospital are NOT built here.
 */

import type { GameMap } from './Map';
import type { Structure, StructureMap } from './StructureMap';
import { TileType } from './Tile';

/** Road hops from the nearest station at which coverage falls to zero. */
export const SERVICE_RANGE_TILES = 24;

/** Max orthogonal hops into off-road space that still receive any coverage. */
export const OFF_ROAD_RADIUS_TILES = 2;

const ORTHOGONAL = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

/**
 * Multiplier applied to a road cell's intensity for off-road neighbours.
 * offDist 1 (direct frontage) gets the full value; offDist 2 gets half;
 * anything beyond OFF_ROAD_RADIUS_TILES gets 0.
 */
export function offRoadFactor(offDist: number): number {
  if (offDist === 1) return 1.0;
  if (offDist === 2) return 0.5;
  return 0;
}

/**
 * Compute graded service coverage over a road network.
 *
 * `isConductor` selects which tile types form the distribution graph (today:
 * ROAD). `isSourceStructure` selects which placed structures are SERVICE
 * STATIONS for this coverage type — a police station never sources power, a
 * power plant never sources police coverage.
 *
 * Returns a `Uint8Array` of length `w * h`, values `0..255`:
 *   - 255 at distance 0 (adjacent to a station)
 *   - Math.round(255 * (1 - d / SERVICE_RANGE_TILES)) at road-hop distance d
 *   - 0 at d >= SERVICE_RANGE_TILES or unreachable
 *   - Off-road cells (non-road, non-structure) up to OFF_ROAD_RADIUS_TILES
 *     orthogonal hops from a covered road cell receive
 *     Math.round(roadIntensity * offRoadFactor(offDist))
 */
export function propagateServiceCoverage(
  map: GameMap,
  structures: StructureMap,
  isConductor: (type: TileType) => boolean,
  isSourceStructure: (s: Structure) => boolean,
): Uint8Array {
  const w = map.getWidth();
  const h = map.getHeight();
  const out = new Uint8Array(w * h);

  // Step 1: mark every cell owned by ANY structure (utility-agnostic exclusion,
  // mirroring Step 1 of propagateThroughRoadNetwork).
  const structureOwned = new Uint8Array(w * h);
  for (const s of structures.iterStructures()) {
    for (const c of s.footprint) {
      structureOwned[c.y * w + c.x] = 1;
    }
  }

  // Step 2: seed BFS with distance 0 from every CONDUCTOR cell orthogonally
  // adjacent to ANY source-structure footprint cell. Use a sentinel of -1 to
  // detect unvisited cells.
  const dist = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];

  for (const s of structures.iterStructures()) {
    if (!isSourceStructure(s)) continue;
    for (const c of s.footprint) {
      for (const { dx, dy } of ORTHOGONAL) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (dist[nIdx] !== -1) continue; // already seeded/visited
        const seedTile = map.getTile(nx, ny);
        if (!seedTile || !isConductor(seedTile.type)) continue;
        dist[nIdx] = 0;
        queue.push(nIdx);
      }
    }
  }

  // Step 3: BFS-expand conductor → conductor up to SERVICE_RANGE_TILES hops.
  // A visited-flag FIFO BFS yields MIN distance (= MAX coverage) per cell in
  // one pass (see module-level JSDoc for correctness argument).
  let qHead = 0;
  while (qHead < queue.length) {
    const idx = queue[qHead++];
    const cx = idx % w;
    const cy = (idx - cx) / w;
    const d = dist[idx];

    if (d >= SERVICE_RANGE_TILES) continue; // stop expanding past range

    for (const { dx, dy } of ORTHOGONAL) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (dist[nIdx] !== -1) continue; // already visited
      const expandTile = map.getTile(nx, ny);
      if (!expandTile || !isConductor(expandTile.type)) continue;
      dist[nIdx] = d + 1;
      queue.push(nIdx);
    }
  }

  // Step 4: write road-cell intensity for all visited conductor cells.
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    if (d === -1) continue; // not reached
    out[i] = Math.round(255 * Math.max(0, 1 - d / SERVICE_RANGE_TILES));
  }

  // Step 5: off-road sweep — BFS outward from all covered road cells into
  // non-road, non-structure space, up to OFF_ROAD_RADIUS_TILES hops.
  // For each such cell, take MAX over all reachable road sources of
  // (roadIntensity * offRoadFactor(offDist)).
  //
  // We need a separate BFS here because a single off-road cell may be
  // reachable from multiple covered road cells at different intensities/
  // distances, and we must assign the MAX — not first-hit.
  //
  // We track the best (maximum) intensity found per cell and continue
  // expanding at all offDist values within range.

  // offRoadDist[i] = current best offDist at which cell i was reached from a
  // covered road cell (undefined → not yet expanded into).
  const offRoadQueue: Array<{ idx: number; offDist: number; roadIntensity: number }> = [];

  // Seed: every visited road cell is the source for its non-road, non-structure
  // orthogonal neighbours.
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] === -1) continue; // not a covered road cell (road cells keep their Step 4 intensity)

    const cx = i % w;
    const cy = (i - cx) / w;
    const roadIntensity = out[i];
    if (roadIntensity === 0) continue; // no coverage to spread

    for (const { dx, dy } of ORTHOGONAL) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (structureOwned[nIdx] === 1) continue;
      // Skip if this is itself a covered road cell — road cells keep Step 4 value.
      if (dist[nIdx] !== -1) continue;
      offRoadQueue.push({ idx: nIdx, offDist: 1, roadIntensity });
    }
  }

  // Process off-road BFS — take MAX for each cell, expand one more hop if
  // offDist < OFF_ROAD_RADIUS_TILES.
  let oqHead = 0;
  while (oqHead < offRoadQueue.length) {
    const { idx, offDist, roadIntensity } = offRoadQueue[oqHead++];
    const candidate = Math.round(roadIntensity * offRoadFactor(offDist));
    if (candidate > out[idx]) {
      out[idx] = candidate;
    }

    if (offDist >= OFF_ROAD_RADIUS_TILES) continue;

    const cx = idx % w;
    const cy = (idx - cx) / w;
    for (const { dx, dy } of ORTHOGONAL) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (structureOwned[nIdx] === 1) continue;
      // Don't spread into covered road cells.
      if (dist[nIdx] !== -1) continue;
      offRoadQueue.push({ idx: nIdx, offDist: offDist + 1, roadIntensity });
    }
  }

  return out;
}
