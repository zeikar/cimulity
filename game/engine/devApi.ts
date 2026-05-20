/**
 * Dev-only injection API for e2e / Playwright testing + browser-console debugging.
 *
 * Installs `window.__cimulity` (in development builds only) so tests can:
 *   - read `world` / `pixiApp` directly
 *   - seed a controlled scene with `dev.seedScene(...)`
 *   - center the camera on a tile with `dev.setCameraTile(x, y)`
 *   - force a renderer refresh with `dev.markDirty()`
 *   - reset the world with `dev.clear()`
 *
 * Prod builds strip this entirely via the `NODE_ENV === 'development'` gate +
 * tree-shaking of the namespace assignment. The legacy `__cimulityWorld`
 * singleton on globalThis (owned by `worldStore.ts`) is **untouched** — tests
 * still rely on it for HMR-survive semantics. This is an additive dev surface.
 */

import { tileToScreen } from '../render/IsoTransform';
import type { World } from '../core/World';
import type { PixiApp } from '../render/PixiApp';
import type { TileType } from '../core/Tile';
import type { Building, BuildingType } from '../core/Building';

export interface SeedBuildingSpec {
  id: number;
  type: BuildingType;
  footprint: ReadonlyArray<{ x: number; y: number }>;
  anchor: { x: number; y: number };
  level: number;
  density: 0 | 1 | 2;
  age?: number;
}

export interface SeedSceneSpec {
  /** Tiles to write via `map.setTile`. Existing tiles at the same coord are overwritten. */
  tiles?: ReadonlyArray<{ x: number; y: number; type: TileType; level?: number }>;
  /** Buildings to hydrate via `buildings.addExistingBuilding`. */
  buildings?: ReadonlyArray<SeedBuildingSpec>;
  /** When true (default), `BuildingMap.clear()` runs before seeding. */
  clearExisting?: boolean;
}

export interface DevApi {
  world: World;
  pixiApp: PixiApp;
  dev: {
    /** Seed the world from a declarative spec. Returns counts for verification. */
    seedScene(spec: SeedSceneSpec): { tilesPlaced: number; buildingsAdded: number };
    /** Pan the camera so the given world tile is at viewport center (zoom-aware). */
    setCameraTile(tileX: number, tileY: number): void;
    /** Force a full renderer redraw on the next frame. */
    markDirty(): void;
    /**
     * Full "New City" reset — delegates to `GameSession.resetWorld()` so the
     * save key, debounced save timer, HUD sync, selection/hover, and GameLoop
     * accumulator are all cleaned up alongside `world.reset()`. Use this in
     * e2e tests when you need a guaranteed-fresh world (a plain `world.reset()`
     * leaves session state behind, including a localStorage save that would
     * re-hydrate on the next page reload).
     */
    resetWorld(): void;
  };
}

/**
 * Hooks the dev API needs from `GameSession`. Keeping the dependency direction
 * one-way — devApi.ts doesn't import GameSession (would be a cycle); the
 * caller passes the hooks it needs.
 */
export interface DevApiHooks {
  /** Triggers the full `GameSession.resetWorld()` flow. */
  resetWorld: () => void;
}

declare global {
  // Module augmentation for `globalThis.__cimulity`. `var` is required here —
  // `declare global { let | const }` is a TS error for global-scope augmentation.
  var __cimulity: DevApi | undefined;
}

export function installDevApi(world: World, pixiApp: PixiApp, hooks: DevApiHooks): void {
  if (process.env.NODE_ENV !== 'development') return;

  globalThis.__cimulity = {
    world,
    pixiApp,
    dev: {
      seedScene(spec: SeedSceneSpec): { tilesPlaced: number; buildingsAdded: number } {
        const map = world.getMap();
        const buildings = map.getBuildings();
        if (spec.clearExisting !== false) buildings.clear();

        let tilesPlaced = 0;
        if (spec.tiles) {
          for (const t of spec.tiles) {
            const ok = map.setTile(t.x, t.y, {
              x: t.x,
              y: t.y,
              type: t.type,
              level: t.level ?? 0,
              elevation: 0,
            });
            if (ok) tilesPlaced++;
          }
        }

        let buildingsAdded = 0;
        if (spec.buildings && spec.buildings.length > 0) {
          for (const b of spec.buildings) {
            const building: Building = {
              id: b.id,
              type: b.type,
              footprint: b.footprint,
              anchor: b.anchor,
              level: b.level,
              density: b.density,
              age: b.age ?? 0,
            };
            if (buildings.addExistingBuilding(building)) buildingsAdded++;
          }
          // setNextIdFloor above the max seeded id so subsequent organic growth
          // can allocate ids without colliding.
          let maxId = -1;
          for (const b of spec.buildings) if (b.id > maxId) maxId = b.id;
          if (maxId >= 0) buildings.setNextIdFloor(maxId);
        }

        pixiApp.getTileRenderer()?.markDirty();
        return { tilesPlaced, buildingsAdded };
      },
      setCameraTile(tileX: number, tileY: number): void {
        const camera = pixiApp.getCamera();
        if (!camera) return;
        // Compute the world point's CURRENT screen position (zoom-aware via
        // camera.worldToScreen), then pan so it lands at viewport center.
        // Doing it as a screen-space delta means we don't have to re-derive the
        // zoom math here — Camera.worldToScreen already encodes `world * zoom + pos`.
        const worldPos = tileToScreen({ x: tileX, y: tileY });
        const currentScreen = camera.worldToScreen(worldPos);
        const vp = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        camera.pan(vp.x - currentScreen.x, vp.y - currentScreen.y);
      },
      markDirty(): void {
        pixiApp.getTileRenderer()?.markDirty();
      },
      resetWorld(): void {
        // Delegate to GameSession.resetWorld() — clears the localStorage save,
        // debounced save timer, HUD sync, selection/hover, GameLoop accumulator,
        // and resets pause/speed defaults. A bare `world.reset()` would leak
        // session state and a stale save would re-hydrate on next page reload.
        hooks.resetWorld();
      },
    },
  };
}

export function uninstallDevApi(): void {
  if (process.env.NODE_ENV !== 'development') return;
  globalThis.__cimulity = undefined;
}
