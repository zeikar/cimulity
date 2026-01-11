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
  private dragDirection: 'horizontal' | 'vertical' | null = null;
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
      this.dragDirection = null;
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.isDragging) return;

    // Calculate all tiles from start to end
    const tiles = this.getTilesInLine(this.dragStartTile, this.dragEndTile, this.dragDirection);

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
    this.dragDirection = null;
  };

  /**
   * Calculate all tiles in a line from start to end
   */
  private getTilesInLine(
    start: TileCoord | null,
    end: TileCoord | null,
    direction: 'horizontal' | 'vertical' | null
  ): TileCoord[] {
    if (!start || !end) return [];

    const tiles: TileCoord[] = [];

    if (direction === 'horizontal') {
      // Horizontal line: same y, varying x
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      for (let x = minX; x <= maxX; x++) {
        if (this.map.getTile(x, start.y)) {
          tiles.push({ x, y: start.y });
        }
      }
    } else if (direction === 'vertical') {
      // Vertical line: same x, varying y
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      for (let y = minY; y <= maxY; y++) {
        if (this.map.getTile(start.x, y)) {
          tiles.push({ x: start.x, y });
        }
      }
    } else {
      // No direction yet, just the start tile
      tiles.push(start);
    }

    return tiles;
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    const tile = this.canvasToTile(canvasX, canvasY);

    // Handle dragging with direction locking (SimCity-style)
    if (this.isDragging && tile && this.dragStartTile) {
      const deltaX = Math.abs(tile.x - this.dragStartTile.x);
      const deltaY = Math.abs(tile.y - this.dragStartTile.y);

      // Determine drag direction on first move
      if (!this.dragDirection && (deltaX > 0 || deltaY > 0)) {
        this.dragDirection = deltaX > deltaY ? 'horizontal' : 'vertical';
      }

      // Apply directional constraint and validate
      let constrainedTile: TileCoord | null = null;
      if (this.dragDirection === 'horizontal') {
        // Keep y fixed at start tile's y, use current x
        constrainedTile = { x: tile.x, y: this.dragStartTile.y };
      } else if (this.dragDirection === 'vertical') {
        // Keep x fixed at start tile's x, use current y
        constrainedTile = { x: this.dragStartTile.x, y: tile.y };
      } else {
        // No direction yet
        constrainedTile = tile;
      }

      // Only update dragEndTile if the constrained tile is valid
      if (constrainedTile && this.map.getTile(constrainedTile.x, constrainedTile.y)) {
        this.dragEndTile = constrainedTile;
      }

      // Calculate and update drag preview
      if (this.callbacks.onDragPreview) {
        const previewTiles = this.getTilesInLine(this.dragStartTile, this.dragEndTile, this.dragDirection);
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
