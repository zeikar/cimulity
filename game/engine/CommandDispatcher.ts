/**
 * Command dispatcher: the seam between raw input drags and tool actions
 *
 * Given the current tool and a raw drag, resolves the tool's path,
 * bounds-filters it against the map, and runs the tool action. Resolving
 * the path with the current tool at drag time avoids stale-rule bugs.
 */

import { Tool } from '../tools/Tool';
import { snapRoadDragPath } from '../tools/RoadTool';
import { executeToolAction } from '../tools';
import type { World } from '../core/World';
import type { TileCoord } from '../types/coordinates';
import type { ToolResult } from '../tools';

/**
 * Single place tool→path mapping lives. ROAD is the only tool with a drag
 * path today; other drag tools add a branch here later (YAGNI).
 */
function pathForTool(
  tool: Tool,
  start: TileCoord,
  end: TileCoord
): TileCoord[] {
  return tool === Tool.ROAD ? snapRoadDragPath(start, end) : [];
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
  return tiles.length > 0
    ? executeToolAction(tool, tiles, world)
    : { changedTiles: [] };
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
