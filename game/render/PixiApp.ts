/**
 * PixiJS Application wrapper with lifecycle management
 * Handles initialization, cleanup, and React integration
 */

import { Application } from 'pixi.js';
import { Camera, type CameraConstraints } from './Camera';
import { TileRenderer } from './TileRenderer';
import { SelectionRenderer } from './SelectionRenderer';
import { GridRenderer } from './GridRenderer';
import { tileToScreen } from './IsoTransform';
import type { World } from '../core/World';
import type { TileCoord } from '../types/coordinates';

export interface PixiAppCallbacks {
  onTileHover: (tile: TileCoord | null) => void;
  onTileClick: (tile: TileCoord) => void;
  onFpsUpdate: (fps: number) => void;
  onCameraUpdate: (x: number, y: number, zoom: number) => void;
}

export class PixiApp {
  private app: Application | null = null;
  private camera: Camera | null = null;
  private tileRenderer: TileRenderer | null = null;
  private selectionRenderer: SelectionRenderer | null = null;
  private gridRenderer: GridRenderer | null = null;
  private world: World;
  private callbacks: PixiAppCallbacks;
  private fpsUpdateInterval: number = 0;

  constructor(world: World, callbacks: PixiAppCallbacks) {
    this.world = world;
    this.callbacks = callbacks;
  }

  /**
   * Initialize PixiJS application
   * Safe for React StrictMode (idempotent)
   */
  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    if (this.app) {
      console.warn('PixiApp already initialized');
      return;
    }

    // Create PixiJS app with auto-detected renderer
    this.app = new Application();
    await this.app.init({
      canvas,
      width,
      height,
      backgroundColor: 0x1a1a1a,
      antialias: true,
      autoStart: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    // Setup camera with constraints based on map size
    const map = this.world.getMap();
    const constraints: CameraConstraints = {
      minX: -width,
      maxX: width * 2,
      minY: -height,
      maxY: height * 2,
      minZoom: 0.25,
      maxZoom: 2,
    };

    this.camera = new Camera(this.app.stage, constraints);

    // Initialize renderers
    this.tileRenderer = new TileRenderer(this.app.stage);
    this.selectionRenderer = new SelectionRenderer(this.app.stage);
    this.gridRenderer = new GridRenderer(this.app.stage, map);

    // Render initial frame
    this.tileRenderer.render(map);
    this.gridRenderer.render();

    // Center camera on map
    this.centerCameraOnMap();

    // Setup render loop
    this.app.ticker.add(() => {
      if (this.tileRenderer && this.world) {
        this.tileRenderer.render(this.world.getMap());
      }
    });

    // Setup FPS counter
    this.fpsUpdateInterval = window.setInterval(() => {
      if (this.app) {
        this.callbacks.onFpsUpdate(Math.round(this.app.ticker.FPS));
      }
    }, 500);

    // Initial camera callback
    this.notifyCameraUpdate();
  }

  /**
   * Center camera on the map
   */
  private centerCameraOnMap(): void {
    if (!this.camera || !this.app) return;

    const map = this.world.getMap();
    const centerTile = { x: map.getWidth() / 2, y: map.getHeight() / 2 };
    const centerScreen = tileToScreen(centerTile);

    // Center in viewport
    const viewportCenterX = this.app.screen.width / 2;
    const viewportCenterY = this.app.screen.height / 2;

    this.camera.pan(
      viewportCenterX - centerScreen.x,
      viewportCenterY - centerScreen.y - 200 // Offset up slightly for better view
    );
  }

  /**
   * Update hover tile highlight
   */
  setHoverTile(tile: TileCoord | null): void {
    this.selectionRenderer?.setHover(tile);
  }

  /**
   * Update selected tile highlight
   */
  setSelectedTile(tile: TileCoord | null): void {
    this.selectionRenderer?.setSelected(tile);
  }

  /**
   * Get camera instance for input handling
   */
  getCamera(): Camera | null {
    return this.camera;
  }

  /**
   * Get tile renderer instance for marking dirty
   */
  getTileRenderer(): TileRenderer | null {
    return this.tileRenderer;
  }

  /**
   * Get selection renderer instance for drag preview
   */
  getSelectionRenderer(): SelectionRenderer | null {
    return this.selectionRenderer;
  }

  /**
   * Notify React of camera updates
   */
  notifyCameraUpdate(): void {
    if (!this.camera) return;
    const pos = this.camera.getPosition();
    this.callbacks.onCameraUpdate(pos.x, pos.y, this.camera.getZoom());
  }

  /**
   * Handle window resize
   */
  resize(width: number, height: number): void {
    this.app?.renderer.resize(width, height);
  }

  /**
   * Clean up resources
   * Safe for React StrictMode (idempotent)
   */
  destroy(): void {
    if (this.fpsUpdateInterval) {
      clearInterval(this.fpsUpdateInterval);
      this.fpsUpdateInterval = 0;
    }

    this.tileRenderer?.destroy();
    this.selectionRenderer?.destroy();
    this.gridRenderer?.destroy();

    if (this.app) {
      // removeView: false — the canvas is owned by React, not Pixi.
      // Removing it from the DOM here breaks HMR/Fast Refresh re-init.
      this.app.destroy({ removeView: false }, { children: true });
      this.app = null;
    }

    this.camera = null;
    this.tileRenderer = null;
    this.selectionRenderer = null;
    this.gridRenderer = null;
  }
}
