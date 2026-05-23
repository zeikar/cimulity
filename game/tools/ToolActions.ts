/**
 * Tool command builders
 *
 * Tools read world state to decide intent and return pure ToolCommand
 * objects; the engine dispatcher applies them. Tools never mutate core.
 */

import { Tool } from './Tool';
import { TileType, createTile, isZoneType } from '../core/Tile';
import { SEA_LEVEL, MIN_LAND_ELEVATION } from '../core/Terrain';
import type { TileCoord } from '../types/coordinates';
import type { World } from '../core/World';
import type { ToolCommand } from './ToolCommand';

/** Narrow union of the three placeable zone tile types. */
type ZoneTileType = TileType.ZONE_RESIDENTIAL | TileType.ZONE_COMMERCIAL | TileType.ZONE_INDUSTRIAL;

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
    case Tool.SELECT:
      // Selection doesn't modify tiles
      return [];
    case Tool.ROAD:
      return buildRoadCommands(tiles, world);
    case Tool.BULLDOZE:
      return buildBulldozeCommands(tiles, world);
    case Tool.ZONE_RESIDENTIAL:
      return buildZoneCommands(TileType.ZONE_RESIDENTIAL, tiles, world);
    case Tool.ZONE_COMMERCIAL:
      return buildZoneCommands(TileType.ZONE_COMMERCIAL, tiles, world);
    case Tool.ZONE_INDUSTRIAL:
      return buildZoneCommands(TileType.ZONE_INDUSTRIAL, tiles, world);
    case Tool.PAINT_WATER:
      return buildPaintWaterCommands(tiles, world);
    case Tool.PAINT_GRASS:
      return buildPaintGrassCommands(tiles, world);
    default:
      return [];
  }
}

/**
 * Build road-placement commands
 * Cannot place on water, existing roads, or zoned land.
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

    // Cannot place roads on zoned land.
    // water rejection is handled by world.canBuildRoadAt (elevation-derived) below.
    if (isZoneType(currentTile.type)) {
      continue;
    }

    // Skip slope/water tiles — terrain buildability gate.
    if (!world.canBuildRoadAt(coord.x, coord.y)) continue;

    commands.push({
      kind: 'tile',
      x: coord.x,
      y: coord.y,
      tile: createTile(coord.x, coord.y, TileType.ROAD),
    });
  }

  return commands;
}

/**
 * Build bulldoze commands
 * Clears roads and zone tiles to a dirt scar that the simulation regrows to
 * grass on the next tick. Natural terrain (water, grass, dirt) is left
 * untouched.
 */
function buildBulldozeCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];

  for (const coord of tiles) {
    const currentTile = map.getTile(coord.x, coord.y);

    if (!currentTile) continue;

    const clearable = currentTile.type === TileType.ROAD || isZoneType(currentTile.type);
    if (!clearable) continue;

    commands.push({
      kind: 'tile',
      x: coord.x,
      y: coord.y,
      tile: createTile(coord.x, coord.y, TileType.DIRT),
    });
  }

  return commands;
}

/**
 * Build zone-placement commands.
 * Places a zone on GRASS, DIRT, or an existing zone of a different type
 * (R/C/I freely repaint over each other). Water, road, and other types
 * are implicitly rejected; repainting the same zone is skipped as a no-op.
 * Reads world only to decide intent; never mutates core.
 */
function buildZoneCommands(zoneType: ZoneTileType, tiles: TileCoord[], world: World): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];

  for (const coord of tiles) {
    const currentTile = map.getTile(coord.x, coord.y);
    if (!currentTile) continue;
    if (currentTile.type === zoneType) continue;
    const paintable =
      currentTile.type === TileType.GRASS ||
      currentTile.type === TileType.DIRT ||
      isZoneType(currentTile.type);
    if (!paintable) continue;
    // Skip slope/water tiles — terrain buildability gate.
    if (!world.canBuildAt(coord.x, coord.y, 1, 1)) continue;
    commands.push({
      kind: 'tile',
      x: coord.x,
      y: coord.y,
      tile: createTile(coord.x, coord.y, zoneType),
    });
  }

  return commands;
}

/**
 * Build paint-water commands.
 * Allow-list (all three must hold or the tile is skipped):
 *   1. Tile type is GRASS.
 *   2. No building footprint covers this cell.
 *   3. Not already at sea level (no-op short-circuit).
 * Emits an elevation command to SEA_LEVEL; no tile write.
 * Reads world only to decide intent; never mutates core.
 */
function buildPaintWaterCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];

  for (const { x, y } of tiles) {
    const currentTile = map.getTile(x, y);
    if (!currentTile) continue;
    if (currentTile.type !== TileType.GRASS) continue;
    if (map.getBuildings().getBuildingAt(x, y) !== null) continue;
    if (world.isWater(x, y)) continue;
    commands.push({ kind: 'elevation', x, y, elevation: SEA_LEVEL });
  }

  return commands;
}

/**
 * Build paint-grass commands.
 * Allow-list: tile type must be GRASS or DIRT.
 * DIRT branch: emit a tile write to GRASS; elevation is left untouched.
 * GRASS branch: if the cell is currently water (elevation <= SEA_LEVEL), emit an
 *   elevation command to MIN_LAND_ELEVATION. If already above sea level, skip (no-op).
 * Reads world only to decide intent; never mutates core.
 */
function buildPaintGrassCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];

  for (const { x, y } of tiles) {
    const currentTile = map.getTile(x, y);
    if (!currentTile) continue;
    if (currentTile.type === TileType.DIRT) {
      commands.push({ kind: 'tile', x, y, tile: createTile(x, y, TileType.GRASS) });
    } else if (currentTile.type === TileType.GRASS) {
      const currentElev = world.getTerrain().getTileElevation(x, y);
      if (currentElev <= SEA_LEVEL) {
        commands.push({ kind: 'elevation', x, y, elevation: MIN_LAND_ELEVATION });
      }
      // else: already above sea level — no-op
    }
    // All other tile types (road, zone, etc.) are implicitly skipped
  }

  return commands;
}
