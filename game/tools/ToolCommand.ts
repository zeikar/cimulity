/**
 * Tool commands: pure descriptions of intended mutations
 *
 * Tools build these from world state; the engine dispatcher applies them
 * to core. Tools never mutate core directly.
 *
 * `TileWriteCommand`      — write a tile at a grid coordinate
 * `VertexEditCommand`    — set terrain vertex heights in deterministic order
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

export type ToolCommand = TileWriteCommand | VertexEditCommand;
