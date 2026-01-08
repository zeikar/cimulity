/**
 * Coordinate system type definitions
 */

/**
 * Tile grid coordinates (integer, 0-based)
 */
export interface TileCoord {
  x: number;
  y: number;
}

/**
 * Screen/world coordinates (floating point, pixels)
 */
export interface ScreenCoord {
  x: number;
  y: number;
}

/**
 * Canvas-relative coordinates (for input)
 */
export interface CanvasCoord {
  x: number;
  y: number;
}
