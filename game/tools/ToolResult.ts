/**
 * Result returned by tool action execution
 */

import type { TileCoord } from '../types/coordinates';

/**
 * Describes the outcome of a tool action
 */
export interface ToolResult {
  /** Tiles that were actually written (empty if nothing changed) */
  changedTiles: TileCoord[];
  /** Footprint coords of buildings removed as a side-effect of this action (e.g. overwrite or bulldoze). */
  affectedTiles: ReadonlyArray<TileCoord>;
  /** IDs of buildings removed as a side-effect of this action. */
  removedBuildingIds: ReadonlyArray<number>;
}
