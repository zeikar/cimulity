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
import type { World } from '../core/World';
import type { TileCoord } from '../types/coordinates';
import type { ToolCommand, ToolResult } from '../tools';

/**
 * Single place tool→path mapping lives. Each drag tool owns its own path
 * rule: ROAD snaps to H/V/45° lines, BULLDOZE clears a filled rectangle.
 * Other drag tools add a case here later (YAGNI).
 */
function pathForTool(
  tool: Tool,
  start: TileCoord,
  end: TileCoord
): TileCoord[] {
  switch (tool) {
    case Tool.ROAD:
      return snapRoadDragPath(start, end);
    case Tool.BULLDOZE:
      return rectDragPath(start, end);
    default:
      return [];
  }
}

/**
 * Apply tool commands to core state; report tiles actually written.
 * This is the only place tool-driven mutation reaches core.
 */
function applyCommands(commands: ToolCommand[], world: World): ToolResult {
  const map = world.getMap();
  const changedTiles: TileCoord[] = [];
  for (const cmd of commands) {
    if (map.setTile(cmd.x, cmd.y, cmd.tile)) {
      changedTiles.push({ x: cmd.x, y: cmd.y });
    }
  }
  return { changedTiles };
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
    return { changedTiles: [] };
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
