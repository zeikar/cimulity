/**
 * Visual interface contracts for terrain tiles and buildings.
 * Type-only — no runtime exports.
 *
 * In Pixi 8, Container is the base scene-graph node (DisplayObject was removed).
 */

import type { Container } from 'pixi.js';
import type { TileType } from '@/game/core/Tile';
import type { BuildingType } from '@/game/core/Building';

export interface TileVisualInput {
  x: number;
  y: number;
  type: TileType;
  level: number;
  /** Pre-projected elevation height. Renderer populates via world.getTerrain().getRenderHeight(x,y). Test fixtures may omit (treated as 0). */
  renderHeight?: number;
}

export interface BuildingVisualInput {
  buildingId: number;
  type: BuildingType;
  anchor: { x: number; y: number };
  footprint: ReadonlyArray<{ x: number; y: number }>;
  level: number;
  density: 0 | 1 | 2;
  /** Pre-projected elevation height. Renderer populates via world.getTerrain().getRenderHeight(x,y). Test fixtures may omit (treated as 0). */
  renderHeight?: number;
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
