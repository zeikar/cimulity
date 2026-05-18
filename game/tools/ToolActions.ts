/**
 * Tool command builders
 *
 * Tools read world state to decide intent and return pure ToolCommand
 * objects; the engine dispatcher applies them. Tools never mutate core.
 */

import { Tool } from './Tool';
import { TileType, createTile } from '../core/Tile';
import type { TileCoord } from '../types/coordinates';
import type { World } from '../core/World';
import type { ToolCommand } from './ToolCommand';

/**
 * Build the commands a tool would apply on a set of tiles
 * @returns the intended tile writes (empty if the tool changes nothing)
 */
export function buildToolCommands(
  tool: Tool,
  tiles: TileCoord[],
  world: World
): ToolCommand[] {
  switch (tool) {
    case Tool.ROAD:
      return buildRoadCommands(tiles, world);
    case Tool.BULLDOZE:
      return buildBulldozeCommands(tiles, world);
    case Tool.BUILDING:
      return buildBuildingCommands(tiles, world);
    case Tool.SELECT:
      // Selection doesn't modify tiles
      return [];
    case Tool.ZONE_RESIDENTIAL:
      // Not implemented yet
      return [];
    default:
      return [];
  }
}

/**
 * Build road-placement commands
 * Cannot place on water tiles, existing roads, or buildings
 */
function buildRoadCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];

  for (const coord of tiles) {
    const currentTile = map.getTile(coord.x, coord.y);

    // Skip if tile doesn't exist or is already a road
    if (!currentTile || currentTile.type === TileType.ROAD) {
      continue;
    }

    // Cannot place roads on water or buildings
    if (currentTile.type === TileType.WATER || currentTile.type === TileType.BUILDING) {
      continue;
    }

    commands.push({
      x: coord.x,
      y: coord.y,
      tile: createTile(coord.x, coord.y, TileType.ROAD),
    });
  }

  return commands;
}

/**
 * Build bulldoze commands
 * Reverts placed roads to a dirt scar that the simulation regrows to grass on
 * the next tick; natural terrain (water, dirt) and already-grass tiles are
 * left untouched.
 */
function buildBulldozeCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];

  for (const coord of tiles) {
    const currentTile = map.getTile(coord.x, coord.y);

    if (!currentTile || currentTile.type !== TileType.ROAD) {
      continue;
    }

    commands.push({
      x: coord.x,
      y: coord.y,
      tile: createTile(coord.x, coord.y, TileType.DIRT),
    });
  }

  return commands;
}

/**
 * Build building-placement commands
 * Places a building only on GRASS or DIRT; any other tile (water, road,
 * existing building, future types) is left untouched.
 * Reads world only to decide intent; never mutates core.
 */
function buildBuildingCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];

  for (const coord of tiles) {
    const currentTile = map.getTile(coord.x, coord.y);
    if (!currentTile) continue; // missing/oob
    if (
      currentTile.type !== TileType.GRASS &&
      currentTile.type !== TileType.DIRT
    ) continue;
    commands.push({
      x: coord.x,
      y: coord.y,
      tile: createTile(coord.x, coord.y, TileType.BUILDING),
    });
  }

  return commands;
}
