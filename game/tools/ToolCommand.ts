/**
 * Tool commands: pure descriptions of intended mutations
 *
 * Tools build these from world state; the engine dispatcher applies them
 * to core. Tools never mutate core directly.
 *
 * `TileWriteCommand`      — write a tile at a grid coordinate
 * `ElevationWriteCommand` — set the terrain elevation at a grid coordinate
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

/**
 * A single intended elevation write at grid coordinates
 */
export interface ElevationWriteCommand {
  readonly kind: 'elevation';
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

export type ToolCommand = TileWriteCommand | ElevationWriteCommand;
