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
import type { Terrain } from '@/game/core/Terrain';

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
  /**
   * Road auto-tile neighbourhood probe: returns true iff the tile at offset
   * (dx, dy) is a ROAD. Supplied by the renderer for ROAD tiles only
   * (auto-tiling); omitted for other tile types and test fixtures (a missing
   * probe yields an `isolated` road). Pure read — the visual never mutates
   * core through it.
   */
  roadNeighbors?: (dx: number, dy: number) => boolean;
  /**
   * Developed-land neighbourhood probe: supplied by the renderer for ROAD
   * tiles only; true iff the neighbour at (dx, dy) is DEVELOPED land = a zone
   * tile OR any player-placed structure tile (POWER_PLANT, WATER_TOWER,
   * POLICE_STATION, FIRE_STATION, HOSPITAL, SCHOOL, PARK); OOB → false.
   * Drives the road-tile sidewalk apron. Pure read, never mutates core.
   */
  developedNeighbors?: (dx: number, dy: number) => boolean;
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
  // Sub-rect of footprint where the actual building geometry stands; cube pipeline reads from this. Lot cells outside structureRect are yards.
  structureRect: Rect;
  /** Render reads core state; muted derelict variant when true. */
  abandoned: boolean;
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
  /** Returns the screen-y of the building's top face for the given building, in the same
   * coordinate frame `mount()` uses for the wrapper. The overlay layer reads this to anchor
   * floating icons (e.g. no-power lightning bolt) above the building top without duplicating
   * geometry math. For level-0 buildings (no cube drawn), returns the terrain-top screen-y. */
  getCubeTopScreenY(building: BuildingVisualInput, terrain: Terrain): number;
}
