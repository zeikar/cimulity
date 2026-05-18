/**
 * GameSession: composition root for World/PixiApp/handlers/dispatch
 *
 * Owns execution state (ToolManager, World, Pixi, input handlers). React
 * keeps only mount/unmount + the tool bridge and passes stable forwarder
 * callbacks so the session never holds a stale prop closure.
 */

import { PixiApp } from '../render/PixiApp';
import { getWorld } from '../core/worldStore';
import { PointerHandler } from '../input/PointerHandler';
import { CameraController } from '../input/CameraController';
import { ToolManager } from '../input/ToolManager';
import { Tool } from '../tools/Tool';
import { KeyboardHandler } from '../input/KeyboardHandler';
import { executeClick, executeDrag, previewDrag } from './CommandDispatcher';
import type { World } from '../core/World';
import type { TileCoord } from '../types/coordinates';
import type { ToolResult } from '../tools';

export interface GameSessionCallbacks {
  onTileHover: (tile: TileCoord | null) => void;
  onTileClick: (tile: TileCoord) => void;
  onFpsUpdate: (fps: number) => void;
  onCameraUpdate: (x: number, y: number, zoom: number) => void;
  onToolChange?: (tool: Tool) => void;
}

export class GameSession {
  private callbacks: GameSessionCallbacks;
  private toolManager = new ToolManager();
  private pixiApp: PixiApp | null = null;
  private world: World | null = null;
  private pointerHandler: PointerHandler | null = null;
  private cameraController: CameraController | null = null;
  private keyboardHandler: KeyboardHandler | null = null;
  private disposed = false;

  constructor(callbacks: GameSessionCallbacks) {
    this.callbacks = callbacks;
  }

  setTool(tool: Tool): void {
    this.toolManager.setTool(tool);
  }

  // Redraw tiles only if a tool command actually changed core state
  private markIfChanged(result: ToolResult): void {
    if (result.changedTiles.length > 0) {
      this.pixiApp?.getTileRenderer()?.markDirty();
    }
  }

  async start(container: HTMLElement, width: number, height: number): Promise<void> {
    console.log('GameCanvas: Initializing world...');
    // Reuse the process-wide World so HMR/Fast Refresh keeps placed tiles
    const world = getWorld();
    this.world = world;
    console.log('GameCanvas: World created');

    // Initialize PixiJS app
    const pixiApp = new PixiApp(world, {
      onTileHover: (tile) => {
        pixiApp.setHoverTile(tile);
        this.callbacks.onTileHover(tile);
      },
      onTileClick: (tile) => {
        pixiApp.setSelectedTile(tile);
        this.callbacks.onTileClick(tile);
      },
      onFpsUpdate: (fps) => this.callbacks.onFpsUpdate(fps),
      onCameraUpdate: (x, y, zoom) => this.callbacks.onCameraUpdate(x, y, zoom),
    });
    this.pixiApp = pixiApp;

    // Initialize PixiJS (async)
    await pixiApp.init(container, width, height);

    // Cleanup already ran while init() was pending — discard this app.
    if (this.disposed) {
      pixiApp.destroy();
      return;
    }

    const camera = pixiApp.getCamera();
    const canvas = pixiApp.getCanvas();
    if (!camera || !canvas) return;

    // Setup input handlers
    const pointerHandler = new PointerHandler(canvas, camera, world.getMap(), {
      onTileHover: (tile) => {
        pixiApp.setHoverTile(tile);
        this.callbacks.onTileHover(tile);
      },
      onTileClick: (tile) => {
        // Single-tile execution goes through the dispatcher, same as drags
        const tool = this.toolManager.getCurrentTool();
        this.markIfChanged(executeClick(tool, tile, world));
        pixiApp.setSelectedTile(tile);
        this.callbacks.onTileClick(tile);
      },
      onTileDrag: (start, end) => {
        // Resolve path with the current tool at drag time
        const tool = this.toolManager.getCurrentTool();
        this.markIfChanged(executeDrag(tool, start, end, world));
      },
      onDragPreview: (start, end) => {
        // Only show preview for ROAD tool
        const tool = this.toolManager.getCurrentTool();
        const selectionRenderer = pixiApp.getSelectionRenderer();
        if (end === null || tool !== Tool.ROAD) {
          selectionRenderer?.clearDragPreview();
          return;
        }
        selectionRenderer?.setDragPreview(previewDrag(tool, start, end, world));
      },
    });
    this.pointerHandler = pointerHandler;

    const cameraController = new CameraController(canvas, camera, {
      onCameraUpdate: (x, y, zoom) => this.callbacks.onCameraUpdate(x, y, zoom),
    });
    this.cameraController = cameraController;

    // Setup keyboard handler for tool shortcuts
    const keyboardHandler = new KeyboardHandler({
      onToolChange: (tool) => {
        this.toolManager.setTool(tool);
        this.callbacks.onToolChange?.(tool);
      },
    });
    this.keyboardHandler = keyboardHandler;
  }

  /**
   * Handle window resize
   */
  resize(width: number, height: number): void {
    this.pixiApp?.resize(width, height);
  }

  dispose(): void {
    this.disposed = true;

    this.pointerHandler?.detach();
    this.cameraController?.detach();
    this.keyboardHandler?.detach();
    this.pixiApp?.destroy();

    this.pixiApp = null;
    this.pointerHandler = null;
    this.cameraController = null;
    this.keyboardHandler = null;
    this.world = null;
  }
}
