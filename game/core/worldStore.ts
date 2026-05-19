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
import { serializeWorld, deserializeWorldInto } from './mapSerialization';

const MAP_WIDTH = 64;
const MAP_HEIGHT = 64;
// STORAGE_KEY is frozen at 'cimulity:save:v2' (key name tracks the 64×64 map dimension
// change, not the payload schema). The persisted payload is now a world envelope at
// WORLD_SAVE_VERSION = 4 (adds elapsed-day field `d` on top of v3's treasury field `m`;
// tickCount is reconstructed from `d` on load — no separate persisted tick field).
// v1/v2/v3 schema-compatible same-dimension payloads still load (map preserved; money
// per existing rules; calendar restarts at Year 1 M1 D1 / Tick 0, `d` defaults 0).
// Next build/bulldoze/tax-triggered save writes a v4 payload. clearSave() unchanged.
// "New City" → world.reset() now also zeroes the calendar and tick (covered by
// World.reset()) and a fresh v4 is written on the next save after New City.
const STORAGE_KEY = 'cimulity:save:v2';

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

/**
 * A singleton that survived HMR/Fast Refresh may predate the economy API
 * (`getMoney`/`trySpend`/`setMoney`) or the calendar API
 * (`getDate`/`getElapsedDays`/`setElapsedDays`); the session/dispatcher now
 * call those, so a stale instance would crash. Treat such an instance as
 * absent and rebuild (re-hydrating from the save) instead of returning it.
 */
function hasEconomyApi(world: World): boolean {
  return (
    typeof world.getMoney === 'function' &&
    typeof world.trySpend === 'function' &&
    typeof world.setMoney === 'function' &&
    typeof world.getDate === 'function' &&
    typeof world.getElapsedDays === 'function' &&
    typeof world.setElapsedDays === 'function'
  );
}

export function getWorld(): World {
  if (!store.__cimulityWorld || !hasEconomyApi(store.__cimulityWorld)) {
    const world = new World(MAP_WIDTH, MAP_HEIGHT);
    const saved = readSave();
    if (saved) {
      deserializeWorldInto(world, saved);
    }
    store.__cimulityWorld = world;
  }
  return store.__cimulityWorld;
}

/** Persist the current map. Best-effort: storage may be full or blocked. */
export function saveWorld(world: World): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, serializeWorld(world));
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
