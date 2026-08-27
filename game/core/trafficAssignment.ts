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
 * Pure: reads the maps and mutates NOTHING, and is not persisted. Must not
 * import `World` or `zoneGrowth` (both are World-coupled).
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { CommuteFlow } from './laborMarket';
import { POPULATION_PER_TILE_LEVEL } from './growthConstants';
import { ORTHOGONAL, buildStructureOwned, isRoadNode } from './roadGraph';

/**
 * Trip volume (road-tile load) at which a road tile is considered fully
 * congested (normalized value 255). The single normalization knob, expressed in
 * `POPULATION_PER_TILE_LEVEL` units: a trip IS a commuting worker, so the knob
 * CHAINS to the same per-structure-tile-per-level commuter unit `buildingCapacity`
 * (buildingCapacity.ts) multiplies for every residential/job building, instead of
 * re-deriving from the display constant in parallel. The number stays exactly
 * 500 — `buildingCapacity` was calibrated so a modal building's commuter count is
 * numerically unchanged from before that module existed, so this knob needs no
 * retuning. If labor participation is ever modelled — the density-0 commuter unit
 * becoming some fraction of `POPULATION_PER_TILE_LEVEL` — capacity follows the
 * commuters automatically, which is exactly the drift this constant was
 * recalibrated to end.
 *
 * Calibrated against two cities MEASURED in a play-verification, by reading the
 * un-normalized per-tile trip load straight off the matched commute flows (the
 * byte alone cannot calibrate anything once it clamps):
 *   - Adversarial: one straight 59-tile road, no loops, no alternate route,
 *     housing at the west end and industry/commerce at the east, 91 zone tiles.
 *     Every employed worker crosses the middle, so the mid-corridor tiles carry
 *     the WHOLE employed population — 380 trips at the size the city stalled at,
 *     and more as it grows. This load is GLOBAL: it scales with the city.
 *   - Ordinary: an 8-block lattice with jobs interleaved among the homes, so
 *     every matched commute is 0–5 tiles. Its busiest street still carried 130
 *     trips, because a dozen SHORT commutes overlap on the same block face. This
 *     load is LOCAL: it is set by how many lots share one street, and it grows
 *     far more slowly than the city does.
 *
 * The split between those two is what the constant has to sit in. At 500 the
 * ordinary street reads `round(255 · 130 / 500) = 66` — a land-value penalty of
 * `0.20 · (66/255) · 6/7 ≈ 0.044`, below the smallest margin any building there
 * held over its `LEVEL_THRESHOLDS` gate (≈ 0.09), so an ordinary layout is nudged
 * without pushing anything measured there below its growth gate. The corridor city
 * reads near-saturated but un-clamped at the sizes measured —
 * `round(255 · 380 / 500) = 194` at the 380-trip stall, and a re-measured 360-trip
 * corridor read 184 — for a penalty of `0.20 · (194/255) · 6/7 ≈ 0.130`, roughly
 * one whole `LEVEL_THRESHOLDS` band: enough to FREEZE the level-up, structure-grow,
 * and density rungs on a marginal building, which is the intended bite. It never
 * abandons one: the sweep reads the uncongested land value instead
 * (LandValueMap.getUncongestedValue — why, once, at the sweep in World.tick).
 * Because that load is GLOBAL it keeps climbing with the city and does clamp once
 * the corridor's employed population passes 500; the band is deliberately entered
 * before the byte flattens, so the gradient still carries information at the sizes
 * a player actually reaches.
 *
 * Rejected by the same measurement: 120 (the value this replaces) pinned the
 * ORDINARY city's busiest street at a clamped 255 and drove it into a permanent
 * boom/bust cycle — 21 of 36 buildings abandoned, recovering, abandoning again —
 * i.e. exactly the "constant tax" this knob exists to avoid. That exact boom/bust is
 * unreachable now that congestion cannot abandon, but 120 stays rejected for the
 * same underlying reason, restated in the freeze rule's terms: a clamped-255
 * ordinary street costs the full ≈ 0.171 anchor penalty, well past the ≈ 0.09 margin
 * measured there, and a congested value below a building's own level threshold is
 * necessarily below the next one too (LEVEL_THRESHOLDS is increasing) — so every
 * building the old rule condemned this one instead freezes. Same constant tax, paid
 * as a permanent freeze rather than an oscillation. Assignment is exactly linear in
 * the worker unit, so the same measured loads project 160 to byte 207 and 240 to
 * byte 138 on that ordinary street: both still far past a tolerable ordinary
 * reading. Going the other way, capacity above ~1.4× the
 * corridor load (≈ 530 at the 380-trip size measured) drops that corridor out of
 * the near-saturated reading this knob targets. Re-measure BOTH loads before
 * retuning.
 */
export const TRAFFIC_CAPACITY = 100 * POPULATION_PER_TILE_LEVEL;

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
