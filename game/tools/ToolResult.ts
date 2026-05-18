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
}
