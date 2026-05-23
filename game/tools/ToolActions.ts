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

type CascadeDirection = 'up' | 'down';

interface CascadeCell {
  x: number;
  y: number;
  originalElev: number;
  newElev: number;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * BFS the closure of cells that must change by ±1 to satisfy the canSetElevation
 * delta-1 8-neighbor invariant when the source cell is raised or lowered by 1.
 *
 * Each cell in the closure changes by exactly 1 in the same direction as the
 * source — a smooth "ring" cascade that pulls lower neighbors up (raise) or
 * higher neighbors down (lower). Returns the cells in apply order: ascending
 * originalElev for raise, descending for lower, so each setElevation passes
 * canSetElevation against the partial state during dispatch.
 *
 * Returns null (and the caller skips the tile, no partial mutation) when:
 *   - source is OOB or structured (road / zone / building footprint),
 *   - any cascade cell would exceed [SEA_LEVEL, MAX_ELEVATION],
 *   - a cell that needs to cascade is structured,
 *   - a pre-existing cliff in the "wrong" direction (raise vs above-neighbor,
 *     lower vs below-neighbor) leaves delta > 1 after the ±1 change,
 *   - lower direction only: a cascade cell sits adjacent to a non-cascade
 *     structured cardinal whose flatness would break (cell ends up below the
 *     structured cell's still-fixed elevation → slope-mask bit set).
 *
 * Pure read against world; never mutates.
 */
function computeCascade(
  world: World,
  sourceX: number,
  sourceY: number,
  direction: CascadeDirection
): CascadeCell[] | null {
  const terrain = world.getTerrain();
  const map = world.getMap();
  const w = terrain.getWidth();
  const h = terrain.getHeight();
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h;
  const dir = direction === 'up' ? 1 : -1;

  if (!inBounds(sourceX, sourceY)) return null;
  const sourceTile = map.getTile(sourceX, sourceY);
  if (!sourceTile) return null;
  if (isStructuredCell(world, sourceTile, sourceX, sourceY)) return null;

  const sourceOriginal = terrain.getTileElevation(sourceX, sourceY);
  const sourceNew = sourceOriginal + dir;
  if (sourceNew < SEA_LEVEL || sourceNew > MAX_ELEVATION) return null;

  const cascade = new Map<string, CascadeCell>();
  cascade.set(cellKey(sourceX, sourceY), {
    x: sourceX,
    y: sourceY,
    originalElev: sourceOriginal,
    newElev: sourceNew,
  });
  const queue: Array<{ x: number; y: number }> = [{ x: sourceX, y: sourceY }];

  while (queue.length > 0) {
    const head = queue.shift()!;
    const cell = cascade.get(cellKey(head.x, head.y))!;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (!inBounds(nx, ny)) continue;

        const nKey = cellKey(nx, ny);
        const neighborInCascade = cascade.get(nKey);
        const neighborOriginal = neighborInCascade
          ? neighborInCascade.originalElev
          : terrain.getTileElevation(nx, ny);
        const neighborFinal = neighborInCascade
          ? neighborInCascade.newElev
          : neighborOriginal;

        if (Math.abs(cell.newElev - neighborFinal) <= 1) continue;

        const wantsCascade =
          dir > 0
            ? neighborOriginal < cell.originalElev
            : neighborOriginal > cell.originalElev;
        if (!wantsCascade) return null; // pre-existing cliff in the wrong direction

        if (neighborInCascade) continue; // already accounted for; cascade is monotonic

        const neighborTile = map.getTile(nx, ny);
        if (!neighborTile) return null;
        if (isStructuredCell(world, neighborTile, nx, ny)) return null;

        const neighborNew = neighborOriginal + dir;
        if (neighborNew < SEA_LEVEL || neighborNew > MAX_ELEVATION) return null;

        cascade.set(nKey, {
          x: nx,
          y: ny,
          originalElev: neighborOriginal,
          newElev: neighborNew,
        });
        queue.push({ x: nx, y: ny });
      }
    }
  }

  // Lower-only: cardinal-structured-neighbor flatness check.
  // Raising can never break a structured cell's flatness — slopeMaskFor only
  // flags cardinals LOWER than center, and cascade-on-raise only moves cells
  // UP. Lowering can pull a cardinal of a structured cell below it, setting
  // the bit. Reject when any cascade cell ends up below a non-cascade
  // structured cardinal.
  if (dir < 0) {
    const cardinalOffsets: ReadonlyArray<readonly [number, number]> = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    for (const cell of cascade.values()) {
      for (const [ox, oy] of cardinalOffsets) {
        const cx = cell.x + ox;
        const cy = cell.y + oy;
        if (!inBounds(cx, cy)) continue;
        if (cascade.has(cellKey(cx, cy))) continue;
        const neighborTile = map.getTile(cx, cy);
        if (!neighborTile) continue;
        if (!isStructuredCell(world, neighborTile, cx, cy)) continue;
        const neighborElev = terrain.getTileElevation(cx, cy);
        if (cell.newElev < neighborElev) return null;
      }
    }
  }

  const sorted = [...cascade.values()];
  sorted.sort((a, b) =>
    dir > 0 ? a.originalElev - b.originalElev : b.originalElev - a.originalElev
  );
  return sorted;
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
 * Computes a cascade closure per source tile via `computeCascade('up')` —
 * the source plus any 8-neighbor whose original elevation would violate the
 * delta-1 invariant against the raised source, recursively. Cascade aborts
 * (no partial mutation) on OOB / structured / clamp / wrong-direction cliff.
 * Emits one elevation command per cascade cell in ascending originalElev
 * order so each `setElevation` passes against the partial dispatch state.
 * Reads world only to decide intent; never mutates core.
 */
function buildTerrainUpCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const commands: ToolCommand[] = [];
  for (const { x, y } of tiles) {
    const cascade = computeCascade(world, x, y, 'up');
    if (!cascade) continue;
    for (const c of cascade) {
      commands.push({ kind: 'elevation', x: c.x, y: c.y, elevation: c.newElev });
    }
  }
  return commands;
}

/**
 * Build terrain-lower commands.
 * Computes a cascade closure per source tile via `computeCascade('down')` —
 * the source plus any 8-neighbor whose original elevation would violate the
 * delta-1 invariant against the lowered source, recursively. Cascade aborts
 * on OOB / structured / clamp / wrong-direction cliff / would-break-structured-
 * cardinal-flatness (lower-only). Emits commands in descending originalElev
 * order (highest first) so each `setElevation` passes during dispatch.
 *
 * DIRT→SEA_LEVEL paired write: when a cascade cell that's DIRT lands at
 * SEA_LEVEL, emit a tile-write (DIRT→GRASS) immediately before its elevation
 * command to preserve the `elevation <= SEA_LEVEL ⇒ GRASS` save/render
 * invariant. The slope/cascade preflight already gates atomicity of the pair.
 * Reads world only to decide intent; never mutates core.
 */
function buildTerrainDownCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const commands: ToolCommand[] = [];
  for (const { x, y } of tiles) {
    const cascade = computeCascade(world, x, y, 'down');
    if (!cascade) continue;
    for (const c of cascade) {
      const tile = world.getMap().getTile(c.x, c.y);
      if (tile && tile.type === TileType.DIRT && c.newElev <= SEA_LEVEL) {
        commands.push({ kind: 'tile', x: c.x, y: c.y, tile: createTile(c.x, c.y, TileType.GRASS) });
      }
      commands.push({ kind: 'elevation', x: c.x, y: c.y, elevation: c.newElev });
    }
  }
  return commands;
}
