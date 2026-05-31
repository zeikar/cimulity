/**
 * Tool commands: pure descriptions of intended mutations
 *
 * Tools build these from world state; the engine dispatcher applies them
 * to core. Tools never mutate core directly.
 *
 * `TileWriteCommand`      — write a tile at a grid coordinate
 * `VertexEditCommand`    — set terrain vertex heights in deterministic order
 * `PlaceStructureCommand` — place a power plant, water tower, police station, fire station, or hospital anchored at (x, y)
 * `RemoveStructureCommand`— atomically remove a structure by id
 * `ToolCommand`           — discriminated union of the above
 */

import type { Tile } from '../core/Tile';

/**
 * A single intended tile write at grid coordinates
 */
export interface TileWriteCommand {
  readonly kind: 'tile';
  readonly x: number;
  readonly y: number;
  readonly tile: Tile;
}

export interface VertexEditCommand {
  readonly kind: 'vertex-edit';
  readonly direction: 'up' | 'down' | 'level';
  readonly writes: ReadonlyArray<{
    readonly vx: number;
    readonly vy: number;
    readonly height: number;
  }>;
}

/**
 * Place a service structure (power plant, water tower, police station, fire station, or hospital)
 * anchored at its NW corner (x, y). Footprint size is derived from the type
 * via the StructureMap registry.
 */
export interface PlaceStructureCommand {
  readonly kind: 'place-structure';
  /** NW anchor x */
  readonly x: number;
  /** NW anchor y */
  readonly y: number;
  readonly structureType: 'power_plant' | 'water_tower' | 'police_station' | 'fire_station' | 'hospital';
}

/**
 * Atomic removal by structure id. Writes DIRT to every footprint cell and
 * unregisters the StructureMap entry. A drag-rect bulldoze that overlaps N
 * cells of one plant produces exactly one of these commands — cost charged once.
 */
export interface RemoveStructureCommand {
  readonly kind: 'remove-structure';
  readonly structureId: number;
}

export type ToolCommand = TileWriteCommand | VertexEditCommand | PlaceStructureCommand | RemoveStructureCommand;
