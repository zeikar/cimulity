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
  onTileDrag?: (tiles: TileCoord[]) => void;
  onDragPreview?: (tiles: TileCoord[] | null) => void;
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

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.isDragging) return;

    // Calculate all tiles from start to end
    const tiles = this.getTilesInLine(this.dragStartTile, this.dragEndTile);

    // Fire drag callback if more than one tile
    if (tiles.length > 1 && this.callbacks.onTileDrag) {
      this.callbacks.onTileDrag(tiles);
      this.justDragged = true; // Mark that we just completed a drag
    }

    // Clear drag preview
    if (this.callbacks.onDragPreview) {
      this.callbacks.onDragPreview(null);
    }

    // Reset drag state
    this.isDragging = false;
    this.dragStartTile = null;
    this.dragEndTile = null;
  };

  /**
   * Calculate all tiles on the road drag path. The cursor is snapped to the
   * nearest of three shapes: horizontal, vertical, or a perfect 45° (1:1)
   * diagonal — no arbitrary-angle staircases.
   */
  private getTilesInLine(
    start: TileCoord | null,
    end: TileCoord | null
  ): TileCoord[] {
    if (!start || !end) return [];

    const tiles: TileCoord[] = [];
    const push = (x: number, y: number): void => {
      if (this.map.getTile(x, y)) {
        tiles.push({ x, y });
      }
    };

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // Snap the end point: dominant horizontal/vertical, else 45° diagonal
    let endX: number, endY: number;
    if (adx > ady * 2) {
      endX = end.x;
      endY = start.y;
    } else if (ady > adx * 2) {
      endX = start.x;
      endY = end.y;
    } else {
      const len = Math.round((adx + ady) / 2);
      endX = start.x + Math.sign(dx) * len;
      endY = start.y + Math.sign(dy) * len;
    }

    const stepX = Math.sign(endX - start.x);
    const stepY = Math.sign(endY - start.y);
    const steps = Math.max(
      Math.abs(endX - start.x),
      Math.abs(endY - start.y)
    );

    for (let i = 0; i <= steps; i++) {
      push(start.x + stepX * i, start.y + stepY * i);
    }

    return tiles;
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    const tile = this.canvasToTile(canvasX, canvasY);

    // Handle dragging: straight line from start to current tile
    if (this.isDragging && tile && this.dragStartTile) {
      this.dragEndTile = tile;

      // Calculate and update drag preview
      if (this.callbacks.onDragPreview) {
        const previewTiles = this.getTilesInLine(this.dragStartTile, this.dragEndTile);
        this.callbacks.onDragPreview(previewTiles);
      }
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
