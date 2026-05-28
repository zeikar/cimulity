/**
 * PixiJS Application wrapper with lifecycle management
 * Handles initialization, cleanup, and React integration
 */

import { Application, Container } from 'pixi.js';
import { Camera, type CameraConstraints } from './Camera';
import { TileRenderer, buildPixiAppRegistry } from './TileRenderer';
import { SelectionRenderer } from './SelectionRenderer';
import { PowerStatusOverlay } from './overlays/PowerStatusOverlay';
import { tileCornerHeights } from './terrain/tileCornerHeights';
import { mapWorldExtent, cameraBounds, centerOffset } from './cameraConstraints';
import { visibleTileBounds, type VisibleTileBounds } from './viewportCulling';
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
  private powerOverlay: PowerStatusOverlay | null = null;
  private terrainContainer: Container | null = null;
  private buildingContainer: Container | null = null;
  private overlayContainer: Container | null = null;
  private selectionContainer: Container | null = null;
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

    const registry = buildPixiAppRegistry();

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

    // Create explicit layer containers in draw order: terrain → building → overlay → selection.
    // addChild order enforces z-layering; no zIndex tricks needed for cross-layer ordering.
    this.terrainContainer = new Container();
    // Elevation-aware iso depth sort: higher cells (and their south/east walls)
    // must draw after lower neighbors. See DiamondTileVisual.computeTerrainZIndex.
    this.terrainContainer.sortableChildren = true;

    this.buildingContainer = new Container();
    this.buildingContainer.sortableChildren = true; // buildings sort within their own layer

    this.overlayContainer = new Container();
    this.overlayContainer.sortableChildren = false;

    this.selectionContainer = new Container();
    this.selectionContainer.sortableChildren = false;

    this.app.stage.addChild(this.terrainContainer);
    this.app.stage.addChild(this.buildingContainer);
    this.app.stage.addChild(this.overlayContainer);
    this.app.stage.addChild(this.selectionContainer);

    // Initialize renderers, each bound to its own container.
    this.tileRenderer = new TileRenderer(this.terrainContainer, this.buildingContainer, registry);
    this.powerOverlay = new PowerStatusOverlay(this.overlayContainer, registry);
    this.selectionRenderer = new SelectionRenderer(this.selectionContainer);

    // Render initial frame
    this.centerCameraOnMap();
    this.tileRenderer.render(this.world, this.computeVisibleBounds());

    // Setup render loop
    this.app.ticker.add(() => {
      const visibleBounds = this.computeVisibleBounds();
      if (this.tileRenderer && this.world) {
        this.tileRenderer.render(this.world, visibleBounds);
      }
      if (this.powerOverlay && this.world) {
        this.powerOverlay.render(this.world, visibleBounds);
      }
      if (this.selectionRenderer && this.world) {
        const rev = this.world.getTerrainRevision();
        const terrain = this.world.getTerrain();
        this.selectionRenderer.refreshIfDirty(
          rev,
          (x, y) => terrain.getRenderHeight(x, y),
          (x, y) => tileCornerHeights(terrain, x, y),
        );
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

  private computeVisibleBounds(): VisibleTileBounds | undefined {
    if (!this.camera || !this.app || !this.world) return undefined;
    const pos = this.camera.getPosition();
    const map = this.world.getMap();
    return visibleTileBounds({
      cameraX: pos.x,
      cameraY: pos.y,
      zoom: this.camera.getZoom(),
      viewportW: this.app.screen.width,
      viewportH: this.app.screen.height,
      mapWidth: map.getWidth(),
      mapHeight: map.getHeight(),
    });
  }

  /**
   * Update hover tile highlight. When footprintCells is provided and non-empty,
   * the whole building footprint is outlined.
   */
  setHoverTile(tile: TileCoord | null, footprintCells?: ReadonlyArray<TileCoord>): void {
    this.selectionRenderer?.setHover(tile, footprintCells);
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
    this.tileRenderer?.markDirty();
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
    this.powerOverlay?.destroy();
    this.selectionRenderer?.destroy();

    // Explicitly destroy each layer container before app.destroy().
    // Pixi 8 app.destroy({ children: true }) does cascade to app.stage children,
    // so this is a defensive double-cleanup — it ensures any shared-cache
    // scenarios (e.g. visuals holding refs to these containers) are released
    // deterministically, before the renderer context is torn down.
    this.terrainContainer?.destroy({ children: true });
    this.buildingContainer?.destroy({ children: true });
    this.overlayContainer?.destroy({ children: true });
    this.selectionContainer?.destroy({ children: true });
    // When sprite-based visuals land, destroy spritesheets here with
    // `destroy({ texture: true, textureSource: true })`.

    if (this.app) {
      // removeView: true — Pixi owns this canvas; remove it so the next
      // init() creates a fresh canvas with a fresh WebGL context.
      this.app.destroy({ removeView: true }, { children: true });
      this.app = null;
    }

    this.camera = null;
    this.tileRenderer = null;
    this.powerOverlay = null;
    this.selectionRenderer = null;
    this.terrainContainer = null;
    this.buildingContainer = null;
    this.overlayContainer = null;
    this.selectionContainer = null;
  }
}
