/**
 * Visual interface contracts for terrain tiles and buildings.
 * Type-only — no runtime exports.
 *
 * In Pixi 8, Container is the base scene-graph node (DisplayObject was removed).
 */

import type { Container } from 'pixi.js';
import type { TileType } from '@/game/core/Tile';
import type { BuildingType } from '@/game/core/Building';
import type { Frontage, Rect } from '@/game/core/buildingFootprint';
import type { CornerHeights } from '../terrain/tileCornerHeights';
import type { TerrainShape } from '../../core/terrainSlope';

export interface MapBounds { width: number; height: number }

export interface TileVisualInput {
  x: number;
  y: number;
  type: TileType;
  level: number;
  /** Raw tile elevation (integer steps). Used to derive water appearance for GRASS tiles at or below SEA_LEVEL. */
  tileElevation: number;
  /** Pre-projected elevation height. Renderer populates via world.getTerrain().getRenderHeight(x,y). Test fixtures may omit (treated as 0). */
  renderHeight?: number;
  cornerHeights?: CornerHeights;
  shape?: TerrainShape;
  mapBounds?: MapBounds;
}

export interface BuildingVisualInput {
  buildingId: number;
  type: BuildingType;
  anchor: { x: number; y: number };
  footprint: ReadonlyArray<{ x: number; y: number }>;
  level: number;
  density: 0 | 1 | 2;
  frontage: Frontage;
  /** Pre-projected elevation height. Renderer populates via world.getTerrain().getRenderHeight(x,y). Test fixtures may omit (treated as 0). */
  renderHeight?: number;
  // Sub-rect of footprint where the actual building geometry stands; cube/facade pipeline reads from this. Lot cells outside structureRect are yards (Task 8).
  structureRect: Rect;
}

export interface TerrainTileVisual {
  readonly layer: 'terrain';
  mount(input: TileVisualInput, parent: Container): Container;
  update(input: TileVisualInput, displayObject: Container): void;
  unmount(displayObject: Container): void;
  dispose?(): void;
}

export interface BuildingVisual {
  readonly layer: 'building';
  mount(input: BuildingVisualInput, parent: Container): Container;
  update(input: BuildingVisualInput, displayObject: Container): void;
  unmount(displayObject: Container): void;
  dispose?(): void;
}
