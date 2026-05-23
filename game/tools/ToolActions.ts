/**
 * Tool command builders
 *
 * Tools read world state to decide intent and return pure ToolCommand
 * objects; the engine dispatcher applies them. Tools never mutate core.
 */

import { Tool } from './Tool';
import { TileType, createTile, isZoneType } from '../core/Tile';
import type { Tile } from '../core/Tile';
import { SEA_LEVEL, MAX_ELEVATION } from '../core/Terrain';
import type { TileCoord } from '../types/coordinates';
import type { World } from '../core/World';
import type { ToolCommand } from './ToolCommand';

function isStructuredCell(world: World, tile: Tile, x: number, y: number): boolean {
  if (tile.type === TileType.ROAD) return true;
  if (isZoneType(tile.type)) return true;
  return world.getMap().getBuildings().getBuildingAt(x, y) !== null;
}

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
    case Tool.TERRAIN_UP:
      return buildTerrainUpCommands(tiles, world);
    case Tool.TERRAIN_DOWN:
      return buildTerrainDownCommands(tiles, world);
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
 * Build terrain-raise commands.
 * Allow-list: skips OOB, structured cells (road/zone/building), already-clamped
 *   tiles (elevation >= MAX_ELEVATION), and slope-blocked cells.
 * Single-elevation branch only: emits one elevation command per qualifying tile.
 * Atomicity: per-tile — skipped tiles produce no output; qualifying tiles emit exactly one command.
 * Reads world only to decide intent; never mutates core.
 */
function buildTerrainUpCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const commands: ToolCommand[] = [];
  for (const { x, y } of tiles) {
    const tile = world.getMap().getTile(x, y);
    if (!tile) continue;
    if (isStructuredCell(world, tile, x, y)) continue;
    const current = world.getTerrain().getTileElevation(x, y);
    const next = current + 1;
    if (next > MAX_ELEVATION) continue;
    if (!world.getTerrain().canSetElevation(x, y, next)) continue;
    commands.push({ kind: 'elevation', x, y, elevation: next });
  }
  return commands;
}

/**
 * Build terrain-lower commands.
 * Allow-list: skips OOB, structured cells (road/zone/building), already-clamped
 *   tiles (next elevation < SEA_LEVEL), and slope-blocked cells.
 * DIRT→SEA_LEVEL paired write: when a DIRT tile would land exactly at SEA_LEVEL,
 *   emits a tile command (DIRT→GRASS) before the elevation command — both or neither
 *   (the slope preflight earlier ensures atomicity of the pair).
 * Reads world only to decide intent; never mutates core.
 */
function buildTerrainDownCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const commands: ToolCommand[] = [];
  for (const { x, y } of tiles) {
    const tile = world.getMap().getTile(x, y);
    if (!tile) continue;
    if (isStructuredCell(world, tile, x, y)) continue;
    const current = world.getTerrain().getTileElevation(x, y);
    const next = current - 1;
    if (next < SEA_LEVEL) continue;
    if (!world.getTerrain().canSetElevation(x, y, next)) continue;
    if (tile.type === TileType.DIRT && next <= SEA_LEVEL) {
      commands.push({ kind: 'tile', x, y, tile: createTile(x, y, TileType.GRASS) });
    }
    commands.push({ kind: 'elevation', x, y, elevation: next });
  }
  return commands;
}
