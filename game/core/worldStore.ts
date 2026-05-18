/**
 * Process-wide World singleton + localStorage persistence.
 *
 * The instance is stashed on globalThis so it survives HMR / Fast Refresh
 * (which re-runs the GameCanvas effect and would otherwise build a fresh
 * World, discarding placed tiles). On first creation the world is hydrated
 * from localStorage, so a full page reload (F5) now restores the saved
 * city instead of resetting. "New City" clears the save explicitly.
 */

import { World } from './World';
import { serializeMap, deserializeMapInto } from './mapSerialization';

const MAP_WIDTH = 16;
const MAP_HEIGHT = 16;
const STORAGE_KEY = 'cimulity:save:v1';

const store = globalThis as unknown as { __cimulityWorld?: World };

function readSave(): string | null {
  try {
    return typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getWorld(): World {
  if (!store.__cimulityWorld) {
    const world = new World(MAP_WIDTH, MAP_HEIGHT);
    const saved = readSave();
    if (saved) {
      deserializeMapInto(world.getMap(), saved);
    }
    store.__cimulityWorld = world;
  }
  return store.__cimulityWorld;
}

/** Persist the current map. Best-effort: storage may be full or blocked. */
export function saveWorld(world: World): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, serializeMap(world.getMap()));
  } catch {
    // Quota exceeded / private mode — drop the save silently.
  }
}

/** Remove the persisted save (used by "New City"). */
export function clearSave(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — nothing to clean up if storage is unavailable.
  }
}
