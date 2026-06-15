/**
 * Shared road-graph primitives used by both trafficAssignment and the labor
 * market module.
 *
 * Pure: no World, no zoneGrowth, no laborMarket, no trafficAssignment imports.
 * Reads only GameMap / StructureMap / Building / TileType / lotBboxOf.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { Building } from './Building';
import { TileType } from './Tile';
import { lotBboxOf } from './buildingFootprint';

/** The four orthogonal step directions (N, S, W, E). */
export const ORTHOGONAL = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
] as const;

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
 * Build a flat bitmask (1 = owned, 0 = free) marking every cell that belongs
 * to any placed structure footprint. The road BFS must never route through
 * these cells (mirrors the sibling propagators).
 */
export function buildStructureOwned(map: GameMap, structures: StructureMap): Uint8Array {
  const w = map.getWidth();
  const h = map.getHeight();
  const owned = new Uint8Array(w * h);
  for (const s of structures.iterStructures()) {
    for (const c of s.footprint) {
      owned[c.y * w + c.x] = 1;
    }
  }
  return owned;
}

/**
 * Returns true when the cell at `idx` is a traversable ROAD node: not owned
 * by any placed structure AND the underlying tile is a ROAD tile.
 *
 * `x = idx % width`, `y = (idx - x) / width`.
 */
export function isRoadNode(
  map: GameMap,
  structureOwned: Uint8Array,
  idx: number,
): boolean {
  if (structureOwned[idx] === 1) return false;
  const w = map.getWidth();
  const x = idx % w;
  const y = (idx - x) / w;
  const tile = map.getTile(x, y);
  return tile !== null && tile.type === TileType.ROAD;
}
