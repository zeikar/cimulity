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
 * gates and by `UtilityStatusOverlay`.
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

const ORTHOGONAL_OFFSETS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
] as const;

/**
 * Grid-connectivity predicate for player-placed STRUCTURES. Unlike a building,
 * a structure's own footprint cells are never marked powered (the propagation
 * excludes all structure-owned cells), so scanning the footprint like
 * `isBuildingPowered` would always be false. A structure is connected to the
 * power grid iff any cell orthogonally adjacent to its footprint is a powered
 * ROAD cell — i.e. it sits directly next to a road carrying power. We require a
 * road specifically (not just any powered cell): the propagation also powers
 * the 1-tile grass halo around powered roads, so an "any powered neighbour"
 * check would falsely report a structure two tiles from the road (touching the
 * halo, not the road) as powered. Used by the inspect-tile panel for service
 * structures (police/fire/hospital/school).
 */
export function isStructurePowered(
  structure: { footprint: ReadonlyArray<{ x: number; y: number }> },
  power: PowerMap,
  map: GameMap,
): boolean {
  for (const c of structure.footprint) {
    for (const o of ORTHOGONAL_OFFSETS) {
      const nx = c.x + o.dx;
      const ny = c.y + o.dy;
      const tile = map.getTile(nx, ny);
      if (tile !== null && tile.type === TileType.ROAD && power.isPowered(nx, ny)) return true;
    }
  }
  return false;
}
