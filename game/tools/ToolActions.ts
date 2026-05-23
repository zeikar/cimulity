/**
 * Tool command builders
 *
 * Tools read world state to decide intent and return pure ToolCommand
 * objects; the engine dispatcher applies them. Tools never mutate core.
 */

import { Tool } from './Tool';
import { TileType, createTile, isZoneType } from '../core/Tile';
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
      return buildPaintTerrainCommands(TileType.WATER, tiles, world);
    case Tool.PAINT_GRASS:
      return buildPaintTerrainCommands(TileType.GRASS, tiles, world);
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

    // Cannot place roads on water or zoned land
    // Belt-and-suspenders: world.canBuildRoadAt already injects isWater, but the tile-type
    // guard below also keeps roads off zone tiles (which canBuildRoadAt does not check).
    if (currentTile.type === TileType.WATER || isZoneType(currentTile.type)) {
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
 * Build terrain-paint commands for WATER or GRASS.
 * Per-target allowlists: PAINT_WATER accepts GRASS/DIRT; PAINT_GRASS accepts
 * GRASS/DIRT/WATER (so water painted by PAINT_WATER can be restored).
 * Roads and zones always require bulldoze first. Same-type is a no-op.
 * Reads world only to decide intent; never mutates core.
 *
 * v1: water lives on tile layer; terrain.baseTiles is RESERVED (all-grass). PAINT_WATER does not touch terrain.
 */
function buildPaintTerrainCommands(
  targetType: TileType.WATER | TileType.GRASS,
  tiles: TileCoord[],
  world: World
): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];

  for (const coord of tiles) {
    const currentTile = map.getTile(coord.x, coord.y);
    if (!currentTile) continue;
    if (currentTile.type === targetType) continue;
    const paintable =
      targetType === TileType.GRASS
        ? currentTile.type === TileType.DIRT || currentTile.type === TileType.WATER
        : currentTile.type === TileType.GRASS || currentTile.type === TileType.DIRT;
    if (!paintable) continue;
    commands.push({
      kind: 'tile',
      x: coord.x,
      y: coord.y,
      tile: createTile(coord.x, coord.y, targetType),
    });
  }

  return commands;
}
