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
