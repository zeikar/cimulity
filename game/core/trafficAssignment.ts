/**
 * Pure flow-driven static traffic assignment over the ROAD graph.
 *
 * Consumes precomputed aggregate commute O-D flows (origin access node →
 * destination access node, worker count; see `CommuteFlow`) and loads each
 * flow's `count` on EVERY road tile along the shortest road path from its
 * origin to its EXACT destination. The result is normalized per road tile
 * against `TRAFFIC_CAPACITY` into a `0..255` congestion value.
 *
 * ALGORITHM:
 *   - Flows are GROUPED by `destNode`. For each distinct destination a SINGLE
 *     reverse BFS is run, seeded from THAT one node (`destDist = 0`,
 *     `nextHop = -1`). At discovery of an unvisited ROAD (non-structure)
 *     neighbour it records `destDist[n] = destDist[cur] + 1` and
 *     `nextHop[n] = cur`, yielding per road node the hop-distance to that exact
 *     destination plus the next hop toward it.
 *   - For each flow in the group, walk `nextHop` from `flow.originNode` to the
 *     destination adding `flow.count` to every node on the path (incl. the
 *     destination). Termination is guaranteed: `destDist` strictly decreases by
 *     1 each hop, so no per-flow visited guard is needed. A flow whose origin is
 *     unreachable from its destination (`destDist === -1`) is skipped — this
 *     should not happen for honest flows produced by the labor matcher.
 *
 * Per-destination routing is REQUIRED: an overflow flow whose origin was matched
 * to a FARTHER job must load that farther path, not the nearest destination in
 * the set. A destination-agnostic multi-source BFS would route it to the wrong
 * destination, so each destination is solved independently.
 *
 * DATA-ONLY: this module reads the maps and mutates NOTHING. It is not wired
 * into render or simulation feedback here, and is not persisted. It must NOT
 * import `World` or `zoneGrowth` (both are World-coupled).
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { CommuteFlow } from './laborMarket';
import { ORTHOGONAL, buildStructureOwned, isRoadNode } from './roadGraph';

/**
 * Trip volume (road-tile load) at which a road tile is considered fully
 * congested (normalized value 255). The single normalization knob.
 */
export const TRAFFIC_CAPACITY = 64;

/**
 * Compute per-road-tile traffic congestion `0..255` by loading precomputed
 * commute O-D flows along their exact shortest road paths. See module JSDoc for
 * the full algorithm.
 *
 * Returns a `Uint8Array` of length `map.getWidth() * map.getHeight()`.
 */
export function assignTraffic(
  map: GameMap,
  structures: StructureMap,
  flows: ReadonlyArray<CommuteFlow>,
): Uint8Array {
  const w = map.getWidth();
  const h = map.getHeight();
  const out = new Uint8Array(w * h);

  // Mark every cell owned by ANY structure so the road graph never routes
  // through a placed structure footprint (mirrors the sibling propagators).
  const structureOwned = buildStructureOwned(map, structures);

  // Group flows by destination node so one reverse BFS serves every flow that
  // shares a destination, while keeping routing EXACT per destination.
  const byDest = new Map<number, CommuteFlow[]>();
  for (const flow of flows) {
    const group = byDest.get(flow.destNode);
    if (group === undefined) byDest.set(flow.destNode, [flow]);
    else group.push(flow);
  }

  // Reverse BFS state, reused across destinations. -1 = unvisited.
  const destDist = new Int32Array(w * h);
  const nextHop = new Int32Array(w * h);
  const queue: number[] = [];
  const load = new Float64Array(w * h);

  for (const [destNode, group] of byDest) {
    // Reset BFS state for this destination.
    destDist.fill(-1);
    nextHop.fill(-1);
    queue.length = 0;
    destDist[destNode] = 0;
    queue.push(destNode);

    // Reverse BFS over ROAD (non-structure) cells from this single destination.
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
        if (!isRoadNode(map, structureOwned, nIdx)) continue;
        destDist[nIdx] = d + 1;
        nextHop[nIdx] = idx;
        queue.push(nIdx);
      }
    }

    // Walk each flow's path from its origin to THIS destination, adding count.
    for (const flow of group) {
      // Guard: an honest flow always has a reachable origin; skip if not.
      if (destDist[flow.originNode] === -1) continue;
      let cur = flow.originNode;
      while (destDist[cur] > 0) {
        load[cur] += flow.count;
        cur = nextHop[cur];
      }
      load[cur] += flow.count; // destination node
    }
  }

  // Normalize against capacity, clamped to 255.
  for (let i = 0; i < load.length; i++) {
    if (load[i] === 0) continue;
    out[i] = Math.min(255, Math.round((255 * load[i]) / TRAFFIC_CAPACITY));
  }

  return out;
}
