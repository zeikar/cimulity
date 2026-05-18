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
  readonly level: number; // Zone growth level; non-zone tiles are always 0
}

/**
 * Factory function to create tiles
 */
export function createTile(x: number, y: number, type: TileType = TileType.GRASS, level: number = 0): Tile {
  return { x, y, type, elevation: 0, level };
}

/** Zone tile types — single source of truth for zone membership checks. */
export const ZONE_TYPES: ReadonlySet<TileType> = new Set([
  TileType.ZONE_RESIDENTIAL,
  TileType.ZONE_COMMERCIAL,
  TileType.ZONE_INDUSTRIAL,
]);

export function isZoneType(type: TileType): boolean {
  return ZONE_TYPES.has(type);
}
