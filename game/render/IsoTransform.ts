/**
 * Isometric transformation utilities for diamond (classic) projection
 *
 * Diamond isometric uses 45° rotation where:
 * - Screen X increases when moving tile +X or -Y
 * - Screen Y increases when moving both +X and +Y
 */

import type { TileCoord, ScreenCoord } from '../types/coordinates';

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
 * Convert screen coordinates to tile grid coordinates (inverse transform)
 *
 * Algorithm (derived from linear algebra):
 * tileX = (screenX / (TILE_WIDTH / 2) + screenY / (TILE_HEIGHT / 2)) / 2
 * tileY = (screenY / (TILE_HEIGHT / 2) - screenX / (TILE_WIDTH / 2)) / 2
 */
export function screenToTile(screen: ScreenCoord): TileCoord {
  const tileX = (screen.x / (ISO_CONFIG.TILE_WIDTH / 2) + screen.y / (ISO_CONFIG.TILE_HEIGHT / 2)) / 2;
  const tileY = (screen.y / (ISO_CONFIG.TILE_HEIGHT / 2) - screen.x / (ISO_CONFIG.TILE_WIDTH / 2)) / 2;

  // Round to nearest integer for discrete tiles
  return {
    x: Math.floor(tileX),
    y: Math.floor(tileY),
  };
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
