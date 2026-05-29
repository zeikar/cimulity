/**
 * GameSession: composition root for World/PixiApp/handlers/dispatch
 *
 * Owns execution state (ToolManager, World, Pixi, input handlers). React
 * keeps only mount/unmount + the tool bridge and passes stable forwarder
 * callbacks so the session never holds a stale prop closure.
 */

import { PixiApp } from '../render/PixiApp';
import { getWorld, saveWorld, clearSave } from '../core/worldStore';
import { PointerHandler } from '../input/PointerHandler';
import { CameraController } from '../input/CameraController';
import { ToolManager } from '../input/ToolManager';
import { Tool } from '../tools/Tool';
import { KeyboardHandler } from '../input/KeyboardHandler';
import { executeClick, executeDrag, previewDrag, previewClick } from './CommandDispatcher';
import { GameLoop, DEFAULT_SPEED_MULTIPLIER } from '../core/GameLoop';
import type { World, WorldDate } from '../core/World';
import type { DemandVector } from '../core/Demand';
import { STARTING_FUNDS } from '../core/World';
import type { TileCoord } from '../types/coordinates';
import type { ToolResult, ToolPreview } from '../tools';
import type { GameLoopTickInfo, SpeedMultiplier } from '../core/GameLoop';
import { TILE_COLORS } from '../render/visuals/palette';
import { installDevApi, uninstallDevApi } from './devApi';

// Drag-preview colors sourced from the shared palette so there's one source of truth.
const DRAG_PREVIEW_COLORS: Partial<Record<Tool, number>> = {
  [Tool.ZONE_RESIDENTIAL]: TILE_COLORS['zone_residential'],
  [Tool.ZONE_COMMERCIAL]: TILE_COLORS['zone_commercial'],
  [Tool.ZONE_INDUSTRIAL]: TILE_COLORS['zone_industrial'],
  [Tool.BULLDOZE]: 0xff3b30,
  [Tool.TERRAIN_UP]: 0x6dd06d,
  [Tool.TERRAIN_DOWN]: 0x6db0e0,
};

export interface GameSessionCallbacks {
  onTileHover?: (tile: TileCoord | null) => void;
  onTileClick: (tile: TileCoord) => void;
  onFpsUpdate: (fps: number) => void;
  onCameraUpdate: (x: number, y: number, zoom: number) => void;
  onToolChange?: (tool: Tool) => void;
  onTickUpdate?: (tick: number, dirt: number, population: number, money: number, date: WorldDate, demand: DemandVector) => void;
  /**
   * React-state mirror callbacks. Fire after the session has accepted/applied
   * the authoritative pause/speed value — either via the GameLoop on a
   * Toolbar/keyboard command, or directly from `resetWorld()` to push the
   * post-New-City defaults even when `gameLoop` is still null. React MUST NOT
   * push state back into the engine.
   */
  onSpeedChange?: (multiplier: SpeedMultiplier) => void;
  onPauseChange?: (paused: boolean) => void;
}

export class GameSession {
  private callbacks: GameSessionCallbacks;
  private toolManager = new ToolManager();
  private pixiApp: PixiApp | null = null;
  private world: World | null = null;
  private pointerHandler: PointerHandler | null = null;
  private cameraController: CameraController | null = null;
  private keyboardHandler: KeyboardHandler | null = null;
  private gameLoop: GameLoop | null = null;
  /**
   * Pause/speed commands received before `gameLoop` exists are queued here and
   * replayed when the loop is constructed in `start()`. Speed: last-write-wins
   * (only the most recent tier needs to apply). Pause: parity matters (odd
   * toggles flip state, even toggles are a no-op).
   */
  private pendingSpeedMultiplier: SpeedMultiplier | null = null;
  private pendingPauseToggleCount = 0;
  private disposed = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedMoney: number | null = null;
  private lastSyncedElapsedDays: number | null = null;

  constructor(callbacks: GameSessionCallbacks) {
    this.callbacks = callbacks;
  }

  setTool(tool: Tool): void {
    this.toolManager.setTool(tool);
  }

  // Both are command entry points (Toolbar AND keyboard both reach the engine through here).
  setSpeedMultiplier(multiplier: SpeedMultiplier): void {
    if (!this.gameLoop) {
      // Queue: last-write-wins for speed (a later valid tier overwrites the pending value).
      // We do NOT validate here — GameLoop.setSpeedMultiplier will validate at flush time.
      this.pendingSpeedMultiplier = multiplier;
      return;
    }
    // No-op if engine is already at this tier — avoid a redundant onSpeedChange emit.
    if (this.gameLoop.getSpeedMultiplier() === multiplier) return;
    if (this.gameLoop.setSpeedMultiplier(multiplier)) {
      this.callbacks.onSpeedChange?.(multiplier);
    }
  }

  togglePaused(): void {
    if (!this.gameLoop) {
      // Queue the toggle parity; flush applies the net effect once the loop exists.
      this.pendingPauseToggleCount++;
      return;
    }
    const next = !this.gameLoop.isPaused();
    this.gameLoop.setPaused(next);
    this.callbacks.onPauseChange?.(next);
  }

  // Redraw tiles only if a tool command actually changed core state,
  // and debounce-persist so rapid drags coalesce into one write.
  private markIfChanged(result: ToolResult): void {
    if (result.changedTiles.length === 0) return;
    this.pixiApp?.getTileRenderer()?.markDirty();
    const tr = this.pixiApp?.getTileRenderer();
    if (tr) {
      tr.markBuildingsChanged(result.removedBuildingIds);
      tr.markTilesChanged(result.affectedTiles);
    }
    this.scheduleSave();
    // Sync HUD immediately so Dirt: jumps on bulldoze without waiting for next tick.
    const money = this.world!.getMoney();
    this.callbacks.onTickUpdate?.(this.world!.getTick(), this.world!.countDirt(), this.world!.getPopulation(), money, this.world!.getDate(), this.world!.getDemand());
    // Keep tracker in sync; tool mutation already scheduled a save via scheduleSave above.
    this.lastSyncedMoney = money;
    this.lastSyncedElapsedDays = this.world!.getElapsedDays();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.world) saveWorld(this.world);
    }, 500);
  }

  /** Bypasses the debounce and writes the world to localStorage immediately. */
  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.world) saveWorld(this.world);
  }

  private performDestructiveReset(opts: { seed?: number; clearSaveAfter: boolean; regenerate?: boolean }): void {
    // Step 1: cancel pending save timer.
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    // Step 2: reset world (regenerate defaults to true for existing callers).
    const regenerate = opts.regenerate ?? true;
    this.world?.reset({ regenerate, seed: regenerate ? opts.seed : undefined });
    // Step 3: conditionally clear the persisted save.
    if (opts.clearSaveAfter) {
      clearSave();
    }
    // Step 4: reset loop/pause/speed mirrors.
    this.gameLoop?.reset();
    // Drop any queued pause/speed commands so a "New City" pressed during the
    // pre-`gameLoop` window cannot replay stale toggles after defaults are restored.
    this.pendingSpeedMultiplier = null;
    this.pendingPauseToggleCount = 0;
    this.gameLoop?.setPaused(false);
    this.gameLoop?.setSpeedMultiplier(DEFAULT_SPEED_MULTIPLIER);
    // Step 5: emit tick HUD sync.
    // Mirror callbacks fire even when gameLoop is null so React HUD/Toolbar snap back to defaults immediately.
    this.callbacks.onPauseChange?.(false);
    this.callbacks.onSpeedChange?.(DEFAULT_SPEED_MULTIPLIER);
    // Read post-reset money (reset already set STARTING_FUNDS; avoids ordering coupling).
    const m = this.world ? this.world.getMoney() : STARTING_FUNDS;
    this.callbacks.onTickUpdate?.(0, 0, 0, m, this.world ? this.world.getDate() : { year: 1, month: 1, day: 1 }, this.world ? this.world.getDemand() : { residential: 0.25, commercial: 0.25, industrial: 0.25 });
    this.lastSyncedMoney = m;
    this.lastSyncedElapsedDays = this.world ? this.world.getElapsedDays() : 0;
    // Step 6: clear selected/hover.
    this.pixiApp?.setSelectedTile(null);
    this.pixiApp?.setHoverTile(null, undefined);
    // Step 7: mark renderer dirty.
    this.pixiApp?.getTileRenderer()?.markDirty();
  }

  /**
   * New-city semantics — clears the save so getWorld() will regenerate from default seed on reload.
   */
  resetWorld(): void {
    this.performDestructiveReset({ clearSaveAfter: true });
  }

  /**
   * Reset to an all-MIN_LAND_ELEVATION, all-grass canvas. TEST/DEBUG only —
   * production new-city uses regenerateTerrain via resetWorld.
   * Water is derived from elevation — no flat canvas contains water by default.
   */
  resetFlat(): void {
    this.performDestructiveReset({ regenerate: false, clearSaveAfter: true });
  }

  /**
   * Destructive reset — terrain is foundational; shares cleanup with resetWorld().
   * Policy diff: regenerated state is saved immediately, not cleared.
   */
  regenerateTerrain(seed?: number): void {
    this.performDestructiveReset({ seed, clearSaveAfter: false });
    this.saveNow();
  }

  /**
   * Translates a ToolPreview into a SelectionRenderer setDragPreview call.
   * Shared by drag preview and single-tile hover preview so there is one
   * mapping between the two.
   */
  private applyToolPreview(preview: ToolPreview, tool: Tool): void {
    const selectionRenderer = this.pixiApp?.getSelectionRenderer();
    if (!selectionRenderer) return;
    if (preview.pathTiles.length === 0) {
      selectionRenderer.clearDragPreview();
      return;
    }
    const rejectedKeys = new Set(preview.rejected.map((t) => `${t.x},${t.y}`));
    const standardTiles = preview.pathTiles.filter(
      (t) => !rejectedKeys.has(`${t.x},${t.y}`)
    );
    const buildings = this.world!.getMap().getBuildings();
    const affectedFootprintTiles: TileCoord[] = [];
    for (const id of preview.affectedBuildingIds) {
      const b = buildings.getBuilding(id);
      if (b !== null) affectedFootprintTiles.push(...b.footprint);
    }
    selectionRenderer.setDragPreview({
      standardTiles,
      rejectedTiles: [...preview.rejected],
      affectedFootprintTiles,
      muted: preview.allOrNothingBlocked,
      standardColor: DRAG_PREVIEW_COLORS[tool] ?? 0x4a4a4a,
    });
  }

  async start(container: HTMLElement, width: number, height: number): Promise<void> {
    console.log('GameCanvas: Initializing world...');
    // Attach keyboard FIRST so early key presses during async Pixi init are captured.
    // GameSession.setSpeedMultiplier/togglePaused queue when gameLoop is still null.
    const keyboardHandler = new KeyboardHandler({
      onToolChange: (tool) => {
        this.toolManager.setTool(tool);
        this.callbacks.onToolChange?.(tool);
      },
      onSpeedChange: (tier) => this.setSpeedMultiplier(tier),
      onPauseToggle: () => this.togglePaused(),
    });
    this.keyboardHandler = keyboardHandler;
    // Reuse the process-wide World so HMR/Fast Refresh keeps placed tiles
    const world = getWorld();
    this.world = world;
    console.log('GameCanvas: World created');

    // Initialize PixiJS app
    const pixiApp = new PixiApp(world, {
      onTileHover: (tile) => {
        const owner = tile ? world.getMap().getBuildings().getBuildingAt(tile.x, tile.y) : null;
        const footprintCells = owner ? owner.footprint : undefined;
        pixiApp.setHoverTile(tile, footprintCells);
        this.callbacks.onTileHover?.(tile);
      },
      onTileClick: (tile) => {
        pixiApp.setSelectedTile(tile);
        this.callbacks.onTileClick(tile);
      },
      onFpsUpdate: (fps) => this.callbacks.onFpsUpdate(fps),
      onCameraUpdate: (x, y, zoom) => this.callbacks.onCameraUpdate(x, y, zoom),
    });
    this.pixiApp = pixiApp;

    // Keyboard listener was attached above for race-safety; if Pixi init fails or returns
    // early, detach it so the dead session does not intercept window keystrokes.
    try {
    // Initialize PixiJS (async)
    await pixiApp.init(container, width, height);

    // Cleanup already ran while init() was pending — discard this app.
    if (this.disposed) {
      pixiApp.destroy();
      this.keyboardHandler?.detach();
      this.keyboardHandler = null;
      return;
    }

    const camera = pixiApp.getCamera();
    const canvas = pixiApp.getCanvas();
    if (!camera || !canvas) {
      pixiApp.destroy();
      this.keyboardHandler?.detach();
      this.keyboardHandler = null;
      return;
    }

    // Dev-only injection surface for Playwright / browser-console testing.
    // Installed AFTER pixiApp.init() succeeds and camera/canvas are confirmed
    // present — otherwise `setCameraTile` / `markDirty` would silently no-op.
    // No-op in production builds (see devApi.ts).
    installDevApi(world, pixiApp, { resetWorld: () => this.resetWorld(), saveNow: () => this.saveNow(), regenerateTerrain: (seed?: number) => this.regenerateTerrain(seed), resetFlat: () => this.resetFlat() });

    // Setup input handlers
    const refreshHover = (tile: TileCoord | null) => {
      const owner = tile ? world.getMap().getBuildings().getBuildingAt(tile.x, tile.y) : null;
      pixiApp.setHoverTile(tile, owner ? owner.footprint : undefined);
    };

    const pointerHandler = new PointerHandler(canvas, camera, world, {
      onTileHover: (tile) => {
        refreshHover(tile);
        const tool = this.toolManager.getCurrentTool();
        if (tile === null) {
          pixiApp.getSelectionRenderer()?.clearDragPreview();
        } else {
          this.applyToolPreview(previewClick(tool, tile, world), tool);
        }
        this.callbacks.onTileHover?.(tile);
      },
      onTileClick: (tile) => {
        // Single-tile execution goes through the dispatcher, same as drags
        const tool = this.toolManager.getCurrentTool();
        this.markIfChanged(executeClick(tool, tile, world));
        refreshHover(tile);
        pixiApp.setSelectedTile(tile);
        this.callbacks.onTileClick(tile);
      },
      onTileDrag: (start, end) => {
        // Resolve path with the current tool at drag time
        const tool = this.toolManager.getCurrentTool();
        this.markIfChanged(executeDrag(tool, start, end, world));
        refreshHover(end);
      },
      onDragPreview: (start, end) => {
        const tool = this.toolManager.getCurrentTool();
        if (end === null) {
          pixiApp.getSelectionRenderer()?.clearDragPreview();
          return;
        }
        this.applyToolPreview(previewDrag(tool, start, end, world), tool);
      },
    });
    this.pointerHandler = pointerHandler;

    const cameraController = new CameraController(canvas, camera, {
      onCameraUpdate: (x, y, zoom) => this.callbacks.onCameraUpdate(x, y, zoom),
    });
    this.cameraController = cameraController;

    // Start fixed-timestep simulation loop; render/persist are gated on
    // changed > 0, but onTickUpdate fires every drained pump for the HUD.
    const gameLoop = new GameLoop(world, (agg: GameLoopTickInfo) => {
      const money = world.getMoney();
      const economyDirty = this.lastSyncedMoney !== null && money !== this.lastSyncedMoney;
      const elapsedDays = world.getElapsedDays();
      const calendarDirty = this.lastSyncedElapsedDays !== null && elapsedDays !== this.lastSyncedElapsedDays;
      if (agg.changedTiles.length > 0) {
        // Incremental update: only re-render the tiles that changed this pump.
        // Tool-driven changes still call markDirty() for a full redraw.
        const tr = this.pixiApp?.getTileRenderer();
        if (tr) {
          tr.markTilesChanged(agg.changedTiles);
          tr.markBuildingsChanged(agg.changedBuildingIds);
        }
        this.scheduleSave();
      }
      // Tax-only/date-only change still persists, debounced. Guard by changedTiles.length to avoid
      // double-schedule (WorldTickResult contract from Task 4: changed === changedTiles.length).
      if (agg.changedTiles.length === 0 && (economyDirty || calendarDirty)) {
        this.scheduleSave();
      }
      this.callbacks.onTickUpdate?.(agg.tick, world.countDirt(), world.getPopulation(), money, world.getDate(), world.getDemand());
      this.lastSyncedMoney = money;
      this.lastSyncedElapsedDays = elapsedDays;
    });
    // Sync HUD to the world's current state before the first tick, so a
    // hydrated/reused world with persisted DIRT shows the real count instead
    // of staying at 0 until the first tick heals it away.
    this.callbacks.onTickUpdate?.(world.getTick(), world.countDirt(), world.getPopulation(), world.getMoney(), world.getDate(), world.getDemand());
    this.lastSyncedMoney = world.getMoney();
    this.lastSyncedElapsedDays = world.getElapsedDays();
    // Closes the race window between `sessionRef.current = session` and `await session.start()`.
    // Flush any pause/speed commands received before the loop existed.
    // We deliberately do NOT emit onSpeedChange/onPauseChange here — the
    // unconditional initial-sync emit below covers both flushed and default cases
    // with a single fan-out, avoiding the noisy "flush emit + initial sync emit" double-fire.
    if (this.pendingSpeedMultiplier !== null) {
      gameLoop.setSpeedMultiplier(this.pendingSpeedMultiplier); // validated; invalid values silently ignored
      this.pendingSpeedMultiplier = null;
    }
    if (this.pendingPauseToggleCount % 2 === 1) {
      // Odd parity: one net toggle. Even parity: net no-op (still drain the count).
      gameLoop.setPaused(true); // initial paused is always false, so odd count ⇒ paused=true.
    }
    this.pendingPauseToggleCount = 0;
    // Single initial-sync emit covers both the flushed and the default case in one fan-out (no duplicate emits).
    this.callbacks.onSpeedChange?.(gameLoop.getSpeedMultiplier());
    this.callbacks.onPauseChange?.(gameLoop.isPaused());
    this.gameLoop = gameLoop;
    gameLoop.start();
    } catch (err) {
      pixiApp.destroy();
      this.keyboardHandler?.detach();
      this.keyboardHandler = null;
      throw err;
    }
  }

  /**
   * Handle window resize
   */
  resize(width: number, height: number): void {
    this.pixiApp?.resize(width, height);
  }

  dispose(): void {
    this.disposed = true;

    // Flush a pending debounced save so a quick refresh/navigation within
    // the debounce window doesn't drop the last mutation.
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.world) saveWorld(this.world);
    }
    this.gameLoop?.stop();
    this.gameLoop = null;
    this.pointerHandler?.detach();
    this.cameraController?.detach();
    this.keyboardHandler?.detach();
    // Clear the dev injection BEFORE destroying pixiApp so any in-flight
    // browser-console reference is severed cleanly.
    uninstallDevApi();
    this.pixiApp?.destroy();

    this.pixiApp = null;
    this.pointerHandler = null;
    this.cameraController = null;
    this.keyboardHandler = null;
    this.world = null;
  }
}
