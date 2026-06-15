/**
 * Pure aggregate labor-market matching over the ROAD graph.
 *
 * Each non-abandoned residential building is a worker ORIGIN; each
 * non-abandoned commercial/industrial building is a job DESTINATION with finite
 * capacity. Workers are matched to jobs greedily, nearest-with-overflow: from
 * an origin's access node a forward BFS ranks reachable job nodes by road-hop
 * distance, and the origin's workers fill the nearest job-with-remaining-
 * capacity first, spilling to the next nearest when it fills. Leftover workers
 * are unemployed.
 *
 * Capacity is GLOBAL and consumed in deterministic origin order (ascending
 * access-node index, then ascending building id); this order-dependence is
 * accepted and reproducible. The result is a set of aggregate commute flows
 * (origin access node → destination access node, worker count) plus the city
 * employment / job-capacity scalars.
 *
 * DATA-ONLY: reads the maps and mutates NOTHING. Not wired into render or
 * simulation feedback here, and not persisted. It must NOT import `World` or
 * `zoneGrowth` (both are World-coupled).
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { BuildingMap } from './Building';
import { ORTHOGONAL, accessNodeFor, buildStructureOwned, isRoadNode } from './roadGraph';

/**
 * Jobs provided per commercial/industrial building level. Tunable basis,
 * consistent with the `level`-sum jobs proxy used by `Demand` / `getPopulation`.
 */
export const JOBS_PER_LEVEL = 1;

/**
 * Workers supplied per residential building level. Tunable basis, consistent
 * with the `level`-sum workers proxy used by `Demand` / `getPopulation`.
 */
export const WORKERS_PER_LEVEL = 1;

/** One aggregate commute: `count` workers route from `originNode` to `destNode`. */
export interface CommuteFlow {
  /** Origin residential access node (flat cell index `y * width + x`). */
  originNode: number;
  /** Destination job access node (flat cell index `y * width + x`). */
  destNode: number;
  /** Number of workers commuting along this origin → destination pair. */
  count: number;
}

/** Aggregate labor-market outcome for the whole city. */
export interface LaborResult {
  /** One entry per matched (origin, destination) pair with a positive count. */
  flows: CommuteFlow[];
  /** Workers that found a job (== Σ flow counts). */
  employed: number;
  /**
   * Workers with no job. Includes road-less residential workers (no access
   * node) plus workers who reached no job with remaining capacity.
   */
  unemployed: number;
  /**
   * Total jobs that EXIST: Σ non-abandoned C/I capacity, INCLUDING buildings
   * with no road access (which can never actually be filled).
   */
  jobsCapacity: number;
  /** Jobs actually filled (== `employed`; jobs are never over-filled). */
  jobsFilled: number;
}

interface Origin {
  node: number;
  workers: number;
  id: number;
}

/**
 * Compute the aggregate labor market via capacity-respecting nearest-with-
 * overflow matching. See module JSDoc for the full algorithm.
 *
 * Invariant (by construction): `employed + unemployed ===` Σ non-abandoned
 * residential workers — every residential worker is either matched or counted
 * as unemployed, including road-less ones.
 */
export function computeLaborMarket(
  map: GameMap,
  structures: StructureMap,
  buildings: BuildingMap,
): LaborResult {
  const w = map.getWidth();
  const h = map.getHeight();

  // Mark every structure-owned cell so the road BFS never routes through a
  // placed structure footprint (mirrors the sibling propagators).
  const structureOwned = buildStructureOwned(map, structures);

  // Remaining job capacity per (access-only) destination node. Two job
  // buildings sharing an access node merge into one entry.
  const capByNode = new Map<number, number>();
  const origins: Origin[] = [];
  let jobsCapacity = 0;
  let unemployed = 0;

  for (const b of buildings.iterBuildings()) {
    if (b.abandoned) continue;

    if (b.type === 'commercial' || b.type === 'industrial') {
      const cap = b.level * JOBS_PER_LEVEL;
      jobsCapacity += cap; // counts even when there is no road access
      const node = accessNodeFor(map, b);
      if (node >= 0) capByNode.set(node, (capByNode.get(node) ?? 0) + cap);
      continue;
    }

    if (b.type === 'residential') {
      const workers = b.level * WORKERS_PER_LEVEL;
      const node = accessNodeFor(map, b);
      if (node < 0) {
        unemployed += workers; // road-less worker → straight to unemployed
      } else {
        origins.push({ node, workers, id: b.id });
      }
    }
  }

  // Deterministic consumption order: ascending access node, tie-break id.
  origins.sort((a, b) => (a.node - b.node) || (a.id - b.id));

  const flows: CommuteFlow[] = [];
  let employed = 0;

  // Per-origin forward BFS over road nodes; visited via -1 dist sentinel.
  const dist = new Int32Array(w * h);
  const queue: number[] = [];

  for (const origin of origins) {
    let workersLeft = origin.workers;

    // Fresh BFS from the origin access node. The access node IS a road cell
    // (accessNodeFor returns a ROAD cell), so seed dist = 0 there.
    dist.fill(-1);
    queue.length = 0;
    dist[origin.node] = 0;
    queue.push(origin.node);

    // Reachable job nodes with remaining capacity, paired with hop distance.
    const reachable: Array<{ node: number; dist: number }> = [];

    let qHead = 0;
    while (qHead < queue.length) {
      const idx = queue[qHead++];
      const d = dist[idx];

      if ((capByNode.get(idx) ?? 0) > 0) reachable.push({ node: idx, dist: d });

      const cx = idx % w;
      const cy = (idx - cx) / w;
      for (const { dx, dy } of ORTHOGONAL) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (dist[nIdx] !== -1) continue; // already visited
        if (!isRoadNode(map, structureOwned, nIdx)) continue;
        dist[nIdx] = d + 1;
        queue.push(nIdx);
      }
    }

    // Nearest-first, tie-break by node index for determinism.
    reachable.sort((a, b) => (a.dist - b.dist) || (a.node - b.node));

    for (const { node } of reachable) {
      if (workersLeft === 0) break;
      const avail = capByNode.get(node) ?? 0;
      const take = Math.min(workersLeft, avail);
      if (take > 0) {
        flows.push({ originNode: origin.node, destNode: node, count: take });
        capByNode.set(node, avail - take);
        workersLeft -= take;
        employed += take;
      }
    }

    unemployed += workersLeft; // any workers with no reachable job
  }

  return {
    flows,
    employed,
    unemployed,
    jobsCapacity,
    jobsFilled: employed, // jobs are never over-filled
  };
}
