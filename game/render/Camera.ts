/**
 * Camera system with pan and zoom
 * Uses transform matrix for efficient coordinate conversion
 */

import { Container } from 'pixi.js';
import type { ScreenCoord } from '../types/coordinates';

export interface CameraConstraints {
  minZoom: number;
  maxZoom: number;
  /**
   * Live, zoom-aware position bounds. The valid _x/_y window changes on every
   * zoom step, so this is queried after pan AND zoom (not cached at construction).
   */
  boundsProvider: (zoom: number) => {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

export class Camera {
  private container: Container;
  private _x: number = 0;
  private _y: number = 0;
  private _zoom: number = 1;
  private constraints: CameraConstraints;

  constructor(container: Container, constraints: CameraConstraints) {
    this.container = container;
    this.constraints = constraints;
  }

  /**
   * Pan camera by delta (in screen space)
   */
  pan(deltaX: number, deltaY: number): void {
    // Apply delta in screen space (inverse zoom scaling)
    this._x += deltaX;
    this._y += deltaY;

    this.clampPosition();
    this.updateTransform();
  }

  /**
   * Clamp _x/_y into the live bounds for the CURRENT zoom level.
   */
  private clampPosition(): void {
    const bounds = this.constraints.boundsProvider(this._zoom);
    this._x = Math.max(bounds.minX, Math.min(bounds.maxX, this._x));
    this._y = Math.max(bounds.minY, Math.min(bounds.maxY, this._y));
  }

  /**
   * Zoom camera around a specific screen point
   * @param delta - Zoom delta (positive = zoom in)
   * @param pivotScreen - Screen point to zoom around
   */
  zoomAround(delta: number, pivotScreen: ScreenCoord): void {
    const oldZoom = this._zoom;
    const newZoom = Math.max(
      this.constraints.minZoom,
      Math.min(this.constraints.maxZoom, this._zoom + delta)
    );

    if (newZoom === this._zoom) return;

    // Calculate world position of pivot before zoom
    const worldBeforeX = (pivotScreen.x - this._x) / oldZoom;
    const worldBeforeY = (pivotScreen.y - this._y) / oldZoom;

    // Update zoom
    this._zoom = newZoom;

    // Calculate world position of pivot after zoom
    const worldAfterX = (pivotScreen.x - this._x) / newZoom;
    const worldAfterY = (pivotScreen.y - this._y) / newZoom;

    // Adjust camera position to keep pivot point stable
    this._x += (worldAfterX - worldBeforeX) * newZoom;
    this._y += (worldAfterY - worldBeforeY) * newZoom;

    this.clampPosition();
    this.updateTransform();
  }

  /**
   * Convert screen coordinates to world coordinates (accounting for camera)
   */
  screenToWorld(screen: ScreenCoord): ScreenCoord {
    return {
      x: (screen.x - this._x) / this._zoom,
      y: (screen.y - this._y) / this._zoom,
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(world: ScreenCoord): ScreenCoord {
    return {
      x: world.x * this._zoom + this._x,
      y: world.y * this._zoom + this._y,
    };
  }

  /**
   * Apply transform to PixiJS container
   */
  private updateTransform(): void {
    this.container.position.set(this._x, this._y);
    this.container.scale.set(this._zoom);
  }

  // Getters for HUD display
  getPosition(): ScreenCoord {
    return { x: this._x, y: this._y };
  }

  getZoom(): number {
    return this._zoom;
  }

  // Reset camera to default view
  reset(): void {
    this._x = 0;
    this._y = 0;
    this._zoom = 1;
    this.clampPosition();
    this.updateTransform();
  }
}
