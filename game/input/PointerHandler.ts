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
  onTileDrag?: (start: TileCoord, end: TileCoord) => void;
  onDragPreview?: (start: TileCoord, end: TileCoord | null) => void;
}

export class PointerHandler {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private map: GameMap;
  private callbacks: PointerCallbacks;
  private lastHoverTile: TileCoord | null = null;

  // Drag state
  private isDragging: boolean = false;
  private dragStartTile: TileCoord | null = null;
  private dragEndTile: TileCoord | null = null;
  private justDragged: boolean = false; // Flag to suppress click after drag

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
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
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

  private handlePointerDown = (event: PointerEvent): void => {
    // Only handle left mouse button
    if (event.button !== 0) return;

    // Reset drag flag on new pointer down
    this.justDragged = false;

    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    const tile = this.canvasToTile(canvasX, canvasY);
    if (tile) {
      this.isDragging = true;
      this.dragStartTile = tile;
      this.dragEndTile = tile;
    }
  };

  private handlePointerUp = (): void => {
    if (!this.isDragging) return;

    // Fire drag callback only for a true multi-tile drag (start != end).
    // A single-tile pointer-up is left for the subsequent click to select.
    if (
      this.dragStartTile &&
      this.dragEndTile &&
      !this.tilesEqual(this.dragStartTile, this.dragEndTile)
    ) {
      this.callbacks.onTileDrag?.(this.dragStartTile, this.dragEndTile);
      this.justDragged = true; // Mark that we just completed a drag
    }

    // Clear drag preview
    if (this.dragStartTile) {
      this.callbacks.onDragPreview?.(this.dragStartTile, null);
    }

    // Reset drag state
    this.isDragging = false;
    this.dragStartTile = null;
    this.dragEndTile = null;
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    const tile = this.canvasToTile(canvasX, canvasY);

    // Handle dragging: straight line from start to current tile
    if (this.isDragging && tile && this.dragStartTile) {
      this.dragEndTile = tile;

      // Emit raw drag endpoints; path resolution lives in the dispatcher
      this.callbacks.onDragPreview?.(this.dragStartTile, this.dragEndTile);
    }

    // Handle hover (only if not dragging or tile changed)
    if (!this.isDragging && !this.tilesEqual(tile, this.lastHoverTile)) {
      this.lastHoverTile = tile;
      this.callbacks.onTileHover(tile);
    }
  };

  private handleClick = (event: MouseEvent): void => {
    // Suppress click if we just completed a drag
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }

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
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('click', this.handleClick);
  }
}
