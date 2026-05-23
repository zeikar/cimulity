/**
 * Command dispatcher: the seam between input intent and core mutation
 *
 * Given the current tool and a click or raw drag, resolves the tool's
 * path, bounds-filters it, asks the tool to build commands, then applies
 * those commands to core. Resolving the path with the current tool at
 * call time avoids stale-rule bugs. Tools never mutate core; the engine
 * applies their commands here.
 */

import { Tool } from '../tools/Tool';
import { snapRoadDragPath } from '../tools/RoadTool';
import { rectDragPath } from '../tools/BulldozeTool';
import { buildToolCommands } from '../tools';
import { ROAD_COST, ZONE_COST, BULLDOZE_COST } from '../core/World';
import { TileType, isZoneType } from '../core/Tile';
import type { World } from '../core/World';
import type { TileCoord } from '../types/coordinates';
import type { ToolCommand, ToolResult } from '../tools';

/**
 * Single place tool→path mapping lives. Each drag tool owns its own path
 * rule: ROAD snaps to H/V/45° lines, BULLDOZE and all zone tools share the
 * filled-rectangle rule (rectDragPath).
 */
function pathForTool(
  tool: Tool,
  start: TileCoord,
  end: TileCoord
): TileCoord[] {
  switch (tool) {
    case Tool.ROAD:
      return snapRoadDragPath(start, end);
    case Tool.ZONE_RESIDENTIAL:
    case Tool.ZONE_COMMERCIAL:
    case Tool.ZONE_INDUSTRIAL:
    case Tool.BULLDOZE:
    case Tool.PAINT_WATER:
    case Tool.PAINT_GRASS:
      return rectDragPath(start, end);
    default:
      return [];
  }
}

/**
 * Cost for a single command, keyed on the tile type being written.
 * DIRT is the tile bulldoze writes for both ROAD→DIRT and ZONE→DIRT clears,
 * so BULLDOZE_COST is charged for any bulldoze command regardless of the
 * source tile type. Zone types share ZONE_COST when being placed.
 * Elevation writes are always free.
 */
function commandCost(cmd: ToolCommand): number {
  if (cmd.kind === 'elevation') return 0;
  const t = cmd.tile.type;
  if (t === TileType.ROAD) return ROAD_COST;
  if (isZoneType(t)) return ZONE_COST;
  if (t === TileType.DIRT) return BULLDOZE_COST;
  // paint terrain writes (water/grass) are intentionally free; pinned by paint-terrain cost tests
  return 0;
}

/**
 * Apply tool commands to core state; report tiles actually written.
 * This is the only place tool-driven mutation reaches core.
 *
 * Cost is charged on the whole batch before any tile write (all-or-nothing).
 * Same-zone repaint emits no commands → zero total → free, no trySpend call.
 * Insufficient funds → silent no-op, empty changedTiles.
 */
function applyCommands(commands: ToolCommand[], world: World): ToolResult {
  if (commands.length === 0) return { changedTiles: [], affectedTiles: [], removedBuildingIds: [] };

  const total = commands.reduce((s, c) => s + commandCost(c), 0);
  // Never call trySpend(0) — only charge when there is an actual cost.
  if (total > 0 && !world.trySpend(total)) {
    return { changedTiles: [], affectedTiles: [], removedBuildingIds: [] };
  }

  const map = world.getMap();
  const changedTiles: TileCoord[] = [];
  const affectedTiles: TileCoord[] = [];
  const removedBuildingIds: number[] = [];
  let landValueInvalidated = false;
  for (const cmd of commands) {
    if (cmd.kind === 'elevation') {
      // Slope-constraint violations are silent no-ops (setElevation returns false).
      // Elevation writes never trigger land-value invalidation.
      const changed = world.getTerrain().setElevation(cmd.x, cmd.y, cmd.elevation);
      if (changed) {
        changedTiles.push({ x: cmd.x, y: cmd.y });
      }
    } else {
      const prevTile = map.getTile(cmd.x, cmd.y);
      const rec = map.setTileAndReconcile(cmd.x, cmd.y, cmd.tile);
      if (rec.changed) {
        changedTiles.push({ x: cmd.x, y: cmd.y });
        // Mark land value dirty when a ROAD or ZONE tile is placed or replaced.
        if (
          !landValueInvalidated &&
          (cmd.tile.type === TileType.ROAD ||
            isZoneType(cmd.tile.type) ||
            (prevTile !== null && (prevTile.type === TileType.ROAD || isZoneType(prevTile.type))))
        ) {
          landValueInvalidated = true;
        }
      }
      if (rec.removedBuilding !== null) {
        removedBuildingIds.push(rec.removedBuilding.id);
        for (const coord of rec.removedBuilding.footprint) {
          affectedTiles.push(coord);
        }
      }
    }
  }
  if (landValueInvalidated) {
    world.markLandValueDirty();
  }
  return { changedTiles, affectedTiles, removedBuildingIds };
}

export function executeClick(
  tool: Tool,
  tile: TileCoord,
  world: World
): ToolResult {
  return applyCommands(buildToolCommands(tool, [tile], world), world);
}

export function executeDrag(
  tool: Tool,
  start: TileCoord,
  end: TileCoord,
  world: World
): ToolResult {
  const tiles = pathForTool(tool, start, end).filter((t) =>
    world.getMap().getTile(t.x, t.y)
  );
  if (tiles.length === 0) {
    return { changedTiles: [], affectedTiles: [], removedBuildingIds: [] };
  }
  return applyCommands(buildToolCommands(tool, tiles, world), world);
}

export function previewDrag(
  tool: Tool,
  start: TileCoord,
  end: TileCoord,
  world: World
): TileCoord[] {
  return pathForTool(tool, start, end).filter((t) =>
    world.getMap().getTile(t.x, t.y)
  );
}
