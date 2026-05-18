/**
 * Tool command: a pure description of an intended tile mutation
 *
 * Tools build these from world state; the engine dispatcher applies them
 * to core. Tools never mutate core directly.
 */

import type { Tile } from '../core/Tile';

/**
 * A single intended tile write at grid coordinates
 */
export interface ToolCommand {
  readonly x: number;
  readonly y: number;
  readonly tile: Tile;
}
