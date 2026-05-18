/**
 * Tile data model and types
 */

/**
 * Tile terrain types (extensible for MVP-1)
 */
export enum TileType {
  GRASS = 'grass',
  DIRT = 'dirt',
  WATER = 'water',
  ROAD = 'road',
  ZONE_RESIDENTIAL = 'zone_residential',
  ZONE_COMMERCIAL = 'zone_commercial',
  ZONE_INDUSTRIAL = 'zone_industrial',
}

/**
 * Immutable tile data structure
 */
export interface Tile {
  readonly x: number;
  readonly y: number;
  readonly type: TileType;
  readonly elevation: number; // Height for future 3D visuals
}

/**
 * Factory function to create tiles
 */
export function createTile(x: number, y: number, type: TileType = TileType.GRASS): Tile {
  return { x, y, type, elevation: 0 };
}
