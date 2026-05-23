/**
 * Core module public API exports
 */

export { TileType, type Tile, createTile } from './Tile';
export { GameMap } from './Map';
export { World } from './World';
export { GameLoop } from './GameLoop';
export {
  Terrain,
  ELEVATION_HEIGHT,
  MAX_ELEVATION,
  SEA_LEVEL,
  MIN_LAND_ELEVATION,
  type HeightMode,
  type BaseTerrain,
  type TerrainData,
} from './Terrain';
