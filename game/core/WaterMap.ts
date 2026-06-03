/**
 * Binary reachability for clean water — a mechanical clone of PowerMap.
 * Conductors are roads; only WATER_TOWER structures seed the BFS (power plants
 * do not). Tower footprint cells never become watered themselves. Reuses
 * propagateThroughRoadNetwork.
 *
 * **Scope note (mirrors PowerMap's deferred-capacity note):** unified clean
 * water only. Sewage / waste-water is an explicitly DEFERRED follow-up — no
 * second network, no numeric capacity, no separate pipe tool, no water-body
 * adjacency requirement (towers place on any flat buildable grass; water-body
 * adjacency is a future refinement). Not persisted — recomputed on demand.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import { TileType } from './Tile';
import { propagateThroughRoadNetwork } from './roadNetworkPropagation';

export class WaterMap {
  private readonly width: number;
  private readonly height: number;
  private readonly watered: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.watered = new Uint8Array(width * height);
  }

  recompute(map: GameMap, structures: StructureMap): void {
    const reachable = propagateThroughRoadNetwork(
      map,
      structures,
      (t) => t === TileType.ROAD,
      (s) => s.type === 'water_tower',
    );
    this.watered.set(reachable);
  }

  isWatered(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.watered[y * this.width + x] === 1;
  }

  clear(): void {
    this.watered.fill(0);
  }

  getRaw(): Uint8Array {
    return this.watered;
  }
}

/**
 * Single canonical predicate. A building is watered iff any of its footprint
 * cells is watered. Anchor is NW and not always road-facing (S/E frontage can
 * sit deeper), so the footprint scan is the authoritative check. Reused by
 * `World.tick` growth gates.
 */
export function isBuildingWatered(
  building: { footprint: ReadonlyArray<{ x: number; y: number }> },
  water: WaterMap,
): boolean {
  for (const c of building.footprint) {
    if (water.isWatered(c.x, c.y)) return true;
  }
  return false;
}

const ORTHOGONAL_OFFSETS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
] as const;

/**
 * Grid-connectivity predicate for player-placed STRUCTURES — water mirror of
 * `isStructurePowered`. A structure's footprint cells are never marked watered
 * (the propagation excludes all structure-owned cells), so a structure is
 * connected to the water grid iff any cell orthogonally adjacent to its
 * footprint is a watered ROAD cell. A road is required (not just any watered
 * cell): the propagation also waters the 1-tile halo around watered roads, so
 * an "any watered neighbour" check would falsely report a structure two tiles
 * from the road as watered. Used by the inspect-tile panel for service
 * structures.
 */
export function isStructureWatered(
  structure: { footprint: ReadonlyArray<{ x: number; y: number }> },
  water: WaterMap,
  map: GameMap,
): boolean {
  for (const c of structure.footprint) {
    for (const o of ORTHOGONAL_OFFSETS) {
      const nx = c.x + o.dx;
      const ny = c.y + o.dy;
      const tile = map.getTile(nx, ny);
      if (tile !== null && tile.type === TileType.ROAD && water.isWatered(nx, ny)) return true;
    }
  }
  return false;
}
