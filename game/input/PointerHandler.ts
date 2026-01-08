/**
 * Pointer event handler with camera-aware coordinate translation
 */

import type { Camera } from '../render/Camera';
import { screenToTile } from '../render/IsoTransform';
import type { TileCoord, ScreenCoord } from '../types/coordinates';
import type { GameMap } from '../core/Map';

export interface PointerCallbacks {
  onTileHover: (tile: TileCoord | null) => void;
  onTileClick: (tile: TileCoord) => void;
}

export class PointerHandler {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private map: GameMap;
  private callbacks: PointerCallbacks;
  private lastHoverTile: TileCoord | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    map: GameMap,
    callbacks: PointerCallbacks
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.map = map;
    this.callbacks = callbacks;

    this.attachListeners();
  }

  private attachListeners(): void {
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('click', this.handleClick);
  }

  /**
   * Convert canvas coordinates to tile coordinates
   */
  private canvasToTile(canvasX: number, canvasY: number): TileCoord | null {
    // 1. Canvas coordinates (relative to canvas element)
    const canvasCoord: ScreenCoord = { x: canvasX, y: canvasY };

    // 2. Apply camera transform to get world coordinates
    const worldCoord = this.camera.screenToWorld(canvasCoord);

    // 3. Convert world coordinates to tile coordinates
    const tileCoord = screenToTile(worldCoord);

    // 4. Validate tile is within map bounds
    const tile = this.map.getTile(tileCoord.x, tileCoord.y);
    return tile ? tileCoord : null;
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    const tile = this.canvasToTile(canvasX, canvasY);

    // Only notify if tile changed
    if (this.tilesEqual(tile, this.lastHoverTile)) return;

    this.lastHoverTile = tile;
    this.callbacks.onTileHover(tile);
  };

  private handleClick = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    const tile = this.canvasToTile(canvasX, canvasY);
    if (tile) {
      this.callbacks.onTileClick(tile);
    }
  };

  private tilesEqual(a: TileCoord | null, b: TileCoord | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.x === b.x && a.y === b.y;
  }

  detach(): void {
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('click', this.handleClick);
  }
}
