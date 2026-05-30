/**
 * Binary reachability. Roads are the only conductors. Plants are SOURCES only —
 * they do NOT conduct, and their footprint cells are never marked powered. A road
 * cell is powered iff there exists at least one plant whose footprint has a cell
 * orthogonally adjacent to that road cell AND the road cell is connected to such
 * a seed road cell via a chain of orthogonal road-to-road steps. A non-road cell
 * is powered iff it is orthogonally adjacent to some powered road cell AND it is
 * not inside any structure footprint. Numeric capacity is a planned follow-up; the
 * public API `isPowered(x, y): boolean` keeps room for internal repr to swap later.
 * Not persisted — recomputed on demand.
 *
 * The BFS now lives in `roadNetworkPropagation.ts`. Power seeds only `power_plant`
 * structures; placing a water tower will NOT affect the power grid.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import { TileType } from './Tile';
import { propagateThroughRoadNetwork } from './roadNetworkPropagation';

export class PowerMap {
  private readonly width: number;
  private readonly height: number;
  private readonly powered: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.powered = new Uint8Array(width * height);
  }

  recompute(map: GameMap, structures: StructureMap): void {
    const reachable = propagateThroughRoadNetwork(
      map,
      structures,
      (t) => t === TileType.ROAD,
      (s) => s.type === 'power_plant',
    );
    this.powered.set(reachable);
  }

  isPowered(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.powered[y * this.width + x] === 1;
  }

  clear(): void {
    this.powered.fill(0);
  }

  getRaw(): Uint8Array {
    return this.powered;
  }
}

/**
 * Single canonical predicate. A building is powered iff any of its footprint cells
 * is powered. Anchor is NW and not always road-facing (S/E frontage can sit deeper),
 * so the footprint scan is the authoritative check. Reused by `World.tick` growth
 * gates and by `PowerStatusOverlay`.
 */
export function isBuildingPowered(
  building: { footprint: ReadonlyArray<{ x: number; y: number }> },
  power: PowerMap,
): boolean {
  for (const c of building.footprint) {
    if (power.isPowered(c.x, c.y)) return true;
  }
  return false;
}
