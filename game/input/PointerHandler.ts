/**
 * Pointer event handler with camera-aware coordinate translation
 */

import type { Camera } from '../render/Camera';
import { screenToTileWithTerrain } from '../render/IsoTransform';
import type { TileCoord, ScreenCoord } from '../types/coordinates';
import type { World } from '../core/World';

export interface PointerCallbacks {
  onTileHover: (tile: TileCoord | null) => void;
  /** `screen` is the viewport-relative click position, used to anchor the inspector panel near the cursor. */
  onTileClick: (tile: TileCoord, screen: ScreenCoord) => void;
  onTileDrag?: (start: TileCoord, end: TileCoord) => void;
  onDragPreview?: (start: TileCoord, end: TileCoord | null) => void;
}

export class PointerHandler {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private world: World;
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
    world: World,
    callbacks: PointerCallbacks
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.world = world;
    this.callbacks = callbacks;

    this.attachListeners();
  }

  private attachListeners(): void {
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.addEventListener('click', this.handleClick);
  }

  /**
   * Convert canvas coordinates to tile coordinates using elevation-aware picking.
   * Map dims are read per-pick (cheap; guards against HMR/reset dimension changes).
   */
  private canvasToTile(canvasX: number, canvasY: number): TileCoord | null {
    // 1. Canvas coordinates (relative to canvas element)
    const canvasCoord: ScreenCoord = { x: canvasX, y: canvasY };

    // 2. Apply camera transform to get world coordinates
    const worldCoord = this.camera.screenToWorld(canvasCoord);

    // 3. Convert world coordinates to tile coordinates (elevation-aware)
    const map = this.world.getMap();
    const mapWidth = map.getWidth();
    const mapHeight = map.getHeight();
    const tileCoord = screenToTileWithTerrain(worldCoord, this.world.getTerrain(), mapWidth, mapHeight);

    // 4. Validate tile is within map bounds
    const tile = map.getTile(tileCoord.x, tileCoord.y);
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
      // Capture so pointerup fires even if the pointer leaves the canvas.
      this.canvas.setPointerCapture(event.pointerId);
      // Drag takes over the shared preview layer immediately so the hover ghost
      // doesn't linger until the first pointermove.
      this.callbacks.onDragPreview?.(tile, tile);
    }
  };

  /**
   * Single source of drag-end cleanup so pointerup and pointercancel cannot
   * drift apart.  A cancelled drag does NOT commit (no onTileDrag).
   */
  private endDrag(pointerId: number, commit: boolean): void {
    if (!this.isDragging) return;

    // Release pointer capture before resetting drag state.
    if (this.canvas.hasPointerCapture?.(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }

    if (commit) {
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
    }

    // Clear drag preview regardless of commit/cancel.
    if (this.dragStartTile) {
      this.callbacks.onDragPreview?.(this.dragStartTile, null);
    }

    // Reset drag state.
    this.isDragging = false;
    this.dragStartTile = null;
    this.dragEndTile = null;
  }

  private handlePointerUp = (event: PointerEvent): void => {
    this.endDrag(event.pointerId, /* commit= */ true);
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    // An interrupted drag (e.g. touch cancel, OS gesture) — release capture and
    // clear the preview but do NOT commit the drag.
    this.endDrag(event.pointerId, /* commit= */ false);
  };

  private handlePointerLeave = (): void => {
    // A captured drag owns the preview layer; pointerup/pointercancel clears it.
    if (this.isDragging) return;
    if (this.lastHoverTile !== null) {
      this.lastHoverTile = null;
      this.callbacks.onTileHover(null);
    }
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
      this.callbacks.onTileClick(tile, { x: event.clientX, y: event.clientY });
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
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('click', this.handleClick);
  }
}
