/**
 * Tool action execution logic
 * Centralizes game state mutations for all tools
 */

import { Tool } from './Tool';
import { TileType, createTile } from '../core/Tile';
import type { TileCoord } from '../types/coordinates';
import type { World } from '../core/World';
import type { ToolResult } from './ToolResult';

/**
 * Execute a tool action on a set of tiles
 * @returns ToolResult with the tiles that were actually modified
 */
export function executeToolAction(
  tool: Tool,
  tiles: TileCoord[],
  world: World
): ToolResult {
  switch (tool) {
    case Tool.ROAD:
      return placeRoads(tiles, world);
    case Tool.SELECT:
      // Selection doesn't modify tiles
      return { changedTiles: [] };
    case Tool.BULLDOZE:
    case Tool.ZONE_RESIDENTIAL:
      // Not implemented yet
      return { changedTiles: [] };
    default:
      return { changedTiles: [] };
  }
}

/**
 * Place roads on the specified tiles
 * Cannot place on water tiles
 */
function placeRoads(tiles: TileCoord[], world: World): ToolResult {
  const map = world.getMap();
  const changedTiles: TileCoord[] = [];

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
    if (map.setTile(coord.x, coord.y, roadTile)) {
      changedTiles.push({ x: coord.x, y: coord.y });
    }
  }

  return { changedTiles };
}
