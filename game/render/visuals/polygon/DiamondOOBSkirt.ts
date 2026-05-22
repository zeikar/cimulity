/**
 * OOB (out-of-bounds) skirt helpers for south-edge and east-edge map tiles.
 *
 * The skirt is a vertical quad that drops from the tile's deformed bottom/left/right
 * corners DOWN to a floor Y. The floor sits below the lowest possible tile bottom by
 * MAX_ELEVATION * ELEVATION_HEIGHT pixels, so the skirt always extends well below the
 * world regardless of per-tile elevation — it visually anchors the map to a "floor".
 *
 * Pixi-free: only imports types from IsoTransform and constants from core.
 */

import { tileToScreenWithHeight, ISO_CONFIG } from '@/game/render/IsoTransform';
import type { ScreenCoord } from '@/game/types/coordinates';
import { MAX_ELEVATION, ELEVATION_HEIGHT } from '@/game/core';

/**
 * Floor Y for the OOB skirt of the given tile.
 *
 * Formula: screen0.y + TILE_HEIGHT + MAX_ELEVATION * ELEVATION_HEIGHT
 * where screen0 = tileToScreenWithHeight(tile, 0) (unlifted top corner).
 *
 * The unlifted tile bottom is at screen0.y + TILE_HEIGHT (when bottomH = 0).
 * Adding MAX_ELEVATION * ELEVATION_HEIGHT ensures the floor is always below
 * the deepest possible lifted tile, regardless of per-tile elevation.
 */
export function oobFloorY(tile: { x: number; y: number }): number {
  const screen0 = tileToScreenWithHeight(tile, 0);
  return screen0.y + ISO_CONFIG.TILE_HEIGHT + MAX_ELEVATION * ELEVATION_HEIGHT;
}

/**
 * South-edge OOB skirt vertices: [bottom, left, leftFloor, bottomFloor].
 *
 * `bottom` and `left` are the deformed corner positions from the caller
 * (already deformed by cornerHeights). The floor variants share X with their
 * top counterparts and use oobFloorY(tile) for Y.
 */
export function southSkirtVertices(
  tile: { x: number; y: number },
  bottom: ScreenCoord,
  left: ScreenCoord,
): ScreenCoord[] {
  const floorY = oobFloorY(tile);
  return [
    bottom,
    left,
    { x: left.x,   y: floorY },
    { x: bottom.x, y: floorY },
  ];
}

/**
 * East-edge OOB skirt vertices: [right, bottom, bottomFloor, rightFloor].
 *
 * `right` and `bottom` are the deformed corner positions from the caller
 * (already deformed by cornerHeights). The floor variants share X with their
 * top counterparts and use oobFloorY(tile) for Y.
 */
export function eastSkirtVertices(
  tile: { x: number; y: number },
  right: ScreenCoord,
  bottom: ScreenCoord,
): ScreenCoord[] {
  const floorY = oobFloorY(tile);
  return [
    right,
    bottom,
    { x: bottom.x, y: floorY },
    { x: right.x,  y: floorY },
  ];
}
