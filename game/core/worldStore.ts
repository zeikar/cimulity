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
 * A singleton that survived HMR/Fast Refresh may predate any API surface
 * the session/dispatcher/render layer relies on. We check every
 * load-bearing method on `World`, `GameMap`, and `BuildingMap` — checking
 * only a subset leaves stale singletons that have e.g. `iterBuildings`
 * but lack `addExistingBuilding`, which would silently no-op save-hydration.
 *
 * **Update this guard whenever a load-bearing method is added to `World`,
 * `GameMap`, or `BuildingMap` — stale HMR singletons missing the method
 * break the app.**
 */
function hasCurrentWorldApi(world: World): boolean {
  // World economy + calendar APIs (existing).
  if (
    typeof world.getMoney !== 'function' ||
    typeof world.trySpend !== 'function' ||
    typeof world.setMoney !== 'function' ||
    typeof world.getDate !== 'function' ||
    typeof world.getElapsedDays !== 'function' ||
    typeof world.setElapsedDays !== 'function'
  ) {
    return false;
  }
  // GameMap (added in Task 10): atomic tile/building reconcile + buildings access.
  if (typeof world.getMap !== 'function') return false;
  const map = world.getMap();
  if (
    typeof map.getBuildings !== 'function' ||
    typeof map.setTileAndReconcile !== 'function'
  ) {
    return false;
  }
  // BuildingMap (added in Task 9): all load-bearing methods used by render/save/growth.
  const buildings = map.getBuildings();
  if (
    typeof buildings.getBuildingAt !== 'function' ||
    typeof buildings.getBuilding !== 'function' ||
    typeof buildings.iterBuildings !== 'function' ||
    typeof buildings.getAllBuildings !== 'function' ||
    typeof buildings.addBuilding !== 'function' ||
    typeof buildings.addExistingBuilding !== 'function' ||
    typeof buildings.removeBuilding !== 'function' ||
    typeof buildings.setNextIdFloor !== 'function' ||
    typeof buildings.clear !== 'function'
  ) {
    return false;
  }
  // LandValueMap integration (added in Task 14): derived influence field + dirty-mark.
  if (
    typeof world.getLandValue !== 'function' ||
    typeof world.markLandValueDirty !== 'function' ||
    typeof world.recomputeLandValueIfDirty !== 'function' ||
    typeof world.recomputeLandValue !== 'function'
  ) {
    return false;
  }
  // Terrain integration (added in Task 4): elevation r/w, install, revision, water/build predicates.
  if (
    typeof world.getTerrain !== 'function' ||
    typeof world.installTerrain !== 'function' ||
    typeof world.getTerrainRevision !== 'function' ||
    typeof world.isWater !== 'function' ||
    typeof world.canBuildAt !== 'function' ||
    typeof world.canBuildRoadAt !== 'function'
  ) {
    return false;
  }
  return true;
}

export function getWorld(): World {
  if (!store.__cimulityWorld || !hasCurrentWorldApi(store.__cimulityWorld)) {
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
