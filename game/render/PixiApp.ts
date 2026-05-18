/**
 * PixiJS Application wrapper with lifecycle management
 * Handles initialization, cleanup, and React integration
 */

import { Application } from 'pixi.js';
import { Camera, type CameraConstraints } from './Camera';
import { TileRenderer } from './TileRenderer';
import { SelectionRenderer } from './SelectionRenderer';
import { GridRenderer } from './GridRenderer';
import { mapWorldExtent, cameraBounds, centerOffset } from './cameraConstraints';
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
  private extent: ReturnType<typeof mapWorldExtent> | null = null;

  constructor(world: World, callbacks: PixiAppCallbacks) {
    this.world = world;
    this.callbacks = callbacks;
  }

  /**
   * Initialize PixiJS application
   * Safe for React StrictMode (idempotent)
   */
  async init(container: HTMLElement, width: number, height: number): Promise<void> {
    if (this.app) {
      console.warn('PixiApp already initialized');
      return;
    }

    // Create PixiJS app with auto-detected renderer. Pixi creates and owns
    // its own canvas (a fresh WebGL context every init) — React only owns
    // the container, so HMR/Fast Refresh re-init is clean.
    this.app = new Application();
    await this.app.init({
      width,
      height,
      backgroundColor: 0x1a1a1a,
      antialias: true,
      autoStart: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    this.app.canvas.style.display = 'block';
    container.appendChild(this.app.canvas);

    // Setup camera with constraints based on map size
    const map = this.world.getMap();
    this.extent = mapWorldExtent(map.getWidth(), map.getHeight());
    const constraints: CameraConstraints = {
      minZoom: 0.25,
      maxZoom: 2,
      boundsProvider: (zoom) =>
        this.extent
          ? cameraBounds(this.extent, this.app!.screen.width, this.app!.screen.height, zoom)
          : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
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
    if (!this.camera || !this.app || !this.extent) return;

    const offset = centerOffset(this.extent, this.app.screen.width, this.app.screen.height, this.camera.getZoom());
    // pan-delta from current pos because Camera has no setPosition; clamping is centralized in pan.
    const cur = this.camera.getPosition();
    this.camera.pan(offset.x - cur.x, offset.y - cur.y);
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
   * Get the Pixi-owned canvas (for attaching input handlers)
   */
  getCanvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null;
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
    // recenter on resize (simplest, predictable)
    if (this.camera && this.app) {
      this.centerCameraOnMap();
      this.notifyCameraUpdate();
    }
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
      // removeView: true — Pixi owns this canvas; remove it so the next
      // init() creates a fresh canvas with a fresh WebGL context.
      this.app.destroy({ removeView: true }, { children: true });
      this.app = null;
    }

    this.camera = null;
    this.tileRenderer = null;
    this.selectionRenderer = null;
    this.gridRenderer = null;
  }
}
