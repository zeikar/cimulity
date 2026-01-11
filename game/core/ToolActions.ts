/**
 * Tool action execution logic
 * Centralizes game state mutations for all tools
 */

import { Tool } from '../input/ToolManager';
import type { TileCoord } from '../types/coordinates';
import type { World } from './World';
import { TileType, createTile } from './Tile';

/**
 * Execute a tool action on a set of tiles
 * @returns true if any tiles were modified
 */
export function executeToolAction(
  tool: Tool,
  tiles: TileCoord[],
  world: World
): boolean {
  switch (tool) {
    case Tool.ROAD:
      return placeRoads(tiles, world);
    case Tool.SELECT:
      // Selection doesn't modify tiles
      return false;
    case Tool.BULLDOZE:
    case Tool.ZONE_RESIDENTIAL:
      // Not implemented yet
      return false;
    default:
      return false;
  }
}

/**
 * Place roads on the specified tiles
 * Cannot place on water tiles
 */
function placeRoads(tiles: TileCoord[], world: World): boolean {
  const map = world.getMap();
  let modified = false;

  for (const coord of tiles) {
    const currentTile = map.getTile(coord.x, coord.y);

    // Skip if tile doesn't exist or is already a road
    if (!currentTile || currentTile.type === TileType.ROAD) {
      continue;
    }

    // Cannot place roads on water
    if (currentTile.type === TileType.WATER) {
      continue;
    }

    // Create new road tile
    const roadTile = createTile(coord.x, coord.y, TileType.ROAD);
    map.setTile(coord.x, coord.y, roadTile);
    modified = true;
  }

  return modified;
}
