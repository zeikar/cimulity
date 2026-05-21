/**
 * Isometric transformation utilities for diamond (classic) projection
 *
 * Diamond isometric uses 45° rotation where:
 * - Screen X increases when moving tile +X or -Y
 * - Screen Y increases when moving both +X and +Y
 */

import type { TileCoord, ScreenCoord } from '../types/coordinates';
import { ELEVATION_HEIGHT, MAX_ELEVATION, type Terrain } from '@/game/core';

export const ISO_CONFIG = {
  TILE_WIDTH: 64,
  TILE_HEIGHT: 32,
} as const;

/**
 * Convert tile grid coordinates to screen coordinates (without camera transform)
 *
 * Algorithm:
 * screenX = (tileX - tileY) * (TILE_WIDTH / 2)
 * screenY = (tileX + tileY) * (TILE_HEIGHT / 2)
 */
export function tileToScreen(tile: TileCoord): ScreenCoord {
  const screenX = (tile.x - tile.y) * (ISO_CONFIG.TILE_WIDTH / 2);
  const screenY = (tile.x + tile.y) * (ISO_CONFIG.TILE_HEIGHT / 2);
  return { x: screenX, y: screenY };
}

/**
 * Convert tile grid coordinates to screen coordinates accounting for elevation.
 * At height=0 this is identical to tileToScreen.
 *
 * Algorithm:
 * screenX = (tileX - tileY) * (TILE_WIDTH / 2)
 * screenY = (tileX + tileY) * (TILE_HEIGHT / 2) - height * ELEVATION_HEIGHT
 */
export function tileToScreenWithHeight(tile: TileCoord, height: number): ScreenCoord {
  const screenX = (tile.x - tile.y) * (ISO_CONFIG.TILE_WIDTH / 2);
  const screenY = (tile.x + tile.y) * (ISO_CONFIG.TILE_HEIGHT / 2) - height * ELEVATION_HEIGHT;
  return { x: screenX, y: screenY };
}

/**
 * Fractional inverse of the iso projection — returns unfloored tile coordinates.
 *
 * Inverse derivation from:
 *   sx = (tx - ty) * TILE_WIDTH/2
 *   sy = (tx + ty) * TILE_HEIGHT/2
 * Solving: tx = (sx/(TILE_WIDTH/2) + sy/(TILE_HEIGHT/2)) / 2
 *          ty = (sy/(TILE_HEIGHT/2) - sx/(TILE_WIDTH/2)) / 2
 */
export function screenToTileRaw(sx: number, sy: number): { x: number; y: number } {
  const halfW = ISO_CONFIG.TILE_WIDTH / 2;
  const halfH = ISO_CONFIG.TILE_HEIGHT / 2;
  return {
    x: (sx / halfW + sy / halfH) / 2,
    y: (sy / halfH - sx / halfW) / 2,
  };
}

/**
 * Convert screen coordinates to tile grid coordinates (inverse transform)
 *
 * Algorithm (derived from linear algebra):
 * tileX = (screenX / (TILE_WIDTH / 2) + screenY / (TILE_HEIGHT / 2)) / 2
 * tileY = (screenY / (TILE_HEIGHT / 2) - screenX / (TILE_WIDTH / 2)) / 2
 */
export function screenToTile(screen: ScreenCoord): TileCoord {
  const r = screenToTileRaw(screen.x, screen.y);
  return { x: Math.floor(r.x), y: Math.floor(r.y) };
}

/**
 * Elevation-aware screen-to-tile picking.
 *
 * Scans candidate tiles from MAX_ELEVATION down to 0 (topmost-wins).
 * For each elevation h, shifts the screen point up by h * ELEVATION_HEIGHT
 * (undoing the vertical lift) and checks if the cursor falls inside the
 * lifted diamond. First hit returns the candidate; flat fallback is used
 * when no elevated tile claims the cursor.
 *
 * Flat fallback: returns screenToTile(screen) — may be OOB (preserves
 * current contract).
 *
 * center.y = top.y + TILE_HEIGHT/2 where top = tileToScreenWithHeight(cand, h)
 */
export function screenToTileWithTerrain(
  screen: ScreenCoord,
  terrain: Terrain,
  mapWidth: number,
  mapHeight: number,
): TileCoord {
  const halfW = ISO_CONFIG.TILE_WIDTH / 2;
  const halfH = ISO_CONFIG.TILE_HEIGHT / 2;

  for (let h = MAX_ELEVATION; h >= 0; h--) {
    const rawH = screenToTileRaw(screen.x, screen.y + h * ELEVATION_HEIGHT);
    const cand = { x: Math.floor(rawH.x), y: Math.floor(rawH.y) };

    if (cand.x < 0 || cand.x >= mapWidth || cand.y < 0 || cand.y >= mapHeight) continue;
    if (terrain.getTileElevation(cand.x, cand.y) !== h) continue;

    // Lifted diamond center: top corner + half tile height down
    const top = tileToScreenWithHeight(cand, h);
    const cx = top.x;
    const cy = top.y + halfH;

    // Point-in-diamond test (inclusive <=)
    if (Math.abs(screen.x - cx) / halfW + Math.abs(screen.y - cy) / halfH <= 1) {
      return cand;
    }
  }

  // Flat fallback — preserves current contract (may be OOB)
  return screenToTile(screen);
}

/**
 * Get the center screen position of a tile
 */
export function tileCenterToScreen(tile: TileCoord): ScreenCoord {
  const corner = tileToScreen(tile);
  return {
    x: corner.x,
    y: corner.y + ISO_CONFIG.TILE_HEIGHT / 2,
  };
}
