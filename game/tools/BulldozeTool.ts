/**
 * Bulldoze tool drag-path rule
 *
 * Unlike the road tool's line snap, bulldoze clears a filled rectangular
 * area — the axis-aligned bounding box between the two drag corners,
 * inclusive. Tiles are emitted row-major (y outer, x inner, ascending) so
 * the path order is deterministic regardless of drag direction.
 */

import type { TileCoord } from '../types/coordinates';

export function rectDragPath(
  start: TileCoord,
  end: TileCoord
): TileCoord[] {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  const tiles: TileCoord[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}
