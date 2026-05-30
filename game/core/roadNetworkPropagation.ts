/**
 * Shared binary road-network reachability. Conductors (today: ROAD) form the
 * distribution graph. `structures` provides cell OWNERSHIP for ALL placed
 * structures (their footprint cells never become reachable, so no building can
 * grow on top of any structure). `isSourceStructure` selects which structures
 * SEED the network for THIS utility — power passes a `power_plant` selector,
 * water passes a `water_tower` selector, so a plant never sources water and a
 * tower never powers the grid. A conductor cell is reachable iff a chain of
 * orthogonal conductor steps connects it to a conductor cell orthogonally
 * adjacent to a SOURCE structure's footprint. A non-conductor cell is reachable
 * iff orthogonally adjacent to a reachable conductor AND not inside ANY
 * structure footprint. First consumer: PowerMap. Second: WaterMap.
 */

import type { GameMap } from './Map';
import type { Structure, StructureMap } from './StructureMap';
import { TileType } from './Tile';

const ORTHOGONAL = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

/**
 * Compute binary reachability over a conductor network.
 *
 * Ownership of ALL structure footprint cells is excluded from reachable — the
 * exclusion is utility-agnostic so no building grows on any structure cell.
 * Only structures matching `isSourceStructure` SEED the BFS, so power plants
 * never source water and water towers never power the grid.
 *
 * Returns a Uint8Array of length `map.getWidth() * map.getHeight()` where 1
 * means reachable and 0 means not.
 */
export function propagateThroughRoadNetwork(
  map: GameMap,
  structures: StructureMap,
  isConductor: (type: TileType) => boolean,
  isSourceStructure: (s: Structure) => boolean,
): Uint8Array {
  const w = map.getWidth();
  const h = map.getHeight();
  const reachable = new Uint8Array(w * h);

  // Step 1: mark every cell owned by ANY structure (utility-agnostic exclusion).
  const structureOwned = new Uint8Array(w * h);
  for (const s of structures.iterStructures()) {
    for (const c of s.footprint) {
      structureOwned[c.y * w + c.x] = 1;
    }
  }

  // Step 2: BFS-seed — only from SOURCE structures.
  const visitedConductor = new Uint8Array(w * h);
  const queue: number[] = [];

  for (const s of structures.iterStructures()) {
    // Only seed from structures selected by the caller's predicate.
    if (!isSourceStructure(s)) continue;
    for (const c of s.footprint) {
      for (const { dx, dy } of ORTHOGONAL) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (visitedConductor[nIdx] === 1) continue;
        const seedTile = map.getTile(nx, ny);
        if (!seedTile || !isConductor(seedTile.type)) continue;
        visitedConductor[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  // Step 3: BFS-expand conductor-to-conductor.
  let qHead = 0;
  while (qHead < queue.length) {
    const idx = queue[qHead++];
    const cx = idx % w;
    const cy = (idx - cx) / w;

    for (const { dx, dy } of ORTHOGONAL) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (visitedConductor[nIdx] === 1) continue;
      const expandTile = map.getTile(nx, ny);
      if (!expandTile || !isConductor(expandTile.type)) continue;
      visitedConductor[nIdx] = 1;
      queue.push(nIdx);
    }
  }

  // Step 4: mark all visited conductor cells reachable.
  for (let i = 0; i < visitedConductor.length; i++) {
    if (visitedConductor[i] === 1) reachable[i] = 1;
  }

  // Step 5: adjacency sweep — non-structure neighbours of visited conductors.
  for (let i = 0; i < visitedConductor.length; i++) {
    if (visitedConductor[i] !== 1) continue;
    const cx = i % w;
    const cy = (i - cx) / w;

    for (const { dx, dy } of ORTHOGONAL) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (structureOwned[nIdx] === 1) continue;
      reachable[nIdx] = 1;
    }
  }

  return reachable;
}
