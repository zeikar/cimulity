/**
 * Process-wide World singleton + localStorage persistence.
 *
 * The instance is stashed on globalThis so it survives HMR / Fast Refresh
 * (which re-runs the GameCanvas effect and would otherwise build a fresh
 * World, discarding placed tiles). On first creation the world is hydrated
 * from localStorage, so a full page reload (F5) now restores the saved
 * city instead of resetting. "New City" clears the save explicitly.
 *
 * Cache reuse requires TWO checks to pass:
 *   1. `hasCurrentWorldApi` — structural backstop that verifies every
 *      load-bearing method is present on the stashed instance.
 *   2. `WORLD_SINGLETON_GUARD` sentinel — version string that is bumped
 *      whenever the stash format changes, catching HMR singletons that
 *      predate an API addition not yet covered by the method probe.
 * Either check failing discards the cached World and rebuilds fresh.
 */

import { World } from './World';
import { serializeWorld, deserializeWorldInto } from './mapSerialization';

const MAP_WIDTH = 64;
const MAP_HEIGHT = 64;
// Storage key bumped to 'cimulity:save:v17' to match WORLD_SAVE_VERSION = 17.
// Legacy saves at ':v16 and earlier' remain in localStorage untouched but are never read.
// First save under this key always creates fresh data (no silent overwrite of stale data).
const STORAGE_KEY = 'cimulity:save:v17';

// Bumped to 'service-v5' for the park tile/structure type added in v17.
// An HMR singleton carrying a mismatched guard is discarded and rebuilt even if
// hasCurrentWorldApi passes.
const WORLD_SINGLETON_GUARD = 'service-v5' as const;

const store = globalThis as unknown as {
  __cimulityWorld?: World;
  __cimulityWorldGuard?: string;
};

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
 * First of two cache-reuse checks (paired with `WORLD_SINGLETON_GUARD`).
 *
 * A singleton that survived HMR/Fast Refresh may predate any API surface
 * the session/dispatcher/render layer relies on. We check every
 * load-bearing method on `World`, `GameMap`, `BuildingMap`, and `StructureMap` —
 * checking only a subset leaves stale singletons that have e.g. `iterBuildings`
 * but lack `addExistingBuilding`, which would silently no-op save-hydration.
 *
 * **Update this guard whenever a load-bearing method is added to `World`,
 * `GameMap`, `BuildingMap`, or `StructureMap` — stale HMR singletons missing
 * the method break the app.**
 *
 * Checked methods (as of service-v5 / v17 — park tile/structure type added):
 *   World: getMoney, trySpend, setMoney, getDate, getElapsedDays, setElapsedDays,
 *          getMap, getLandValue, markLandValueDirty, recomputeLandValueIfDirty,
 *          recomputeLandValue, getTerrain, installTerrain, getTerrainRevision,
 *          isWater, canBuildAt, canBuildRoadAt, regenerateTerrain,
 *          getDemand, markDemandDirty,
 *          getPowerMap, markPowerDirty, recomputePowerIfDirty, recomputePower,
 *          getWaterMap, markWaterDirty, recomputeWaterIfDirty, recomputeWater,
 *          getServiceCoverageMap, markServiceDirty, recomputeServiceIfDirty, recomputeService,
 *          getFireCoverageMap, markFireDirty, recomputeFireIfDirty, recomputeFire,
 *          getHospitalCoverageMap, markHospitalDirty, recomputeHospitalIfDirty, recomputeHospital,
 *          getSchoolCoverageMap, markSchoolDirty, recomputeSchoolIfDirty, recomputeSchool,
 *          getStructureMap
 *   GameMap: getBuildings, setTileAndReconcile
 *   BuildingMap: getBuildingAt, getBuilding, iterBuildings, getAllBuildings,
 *                addBuilding, addExistingBuilding, removeBuilding, setNextIdFloor, clear
 *   StructureMap: getStructureAt, getStructure, iterStructures, getAllStructures,
 *                 addStructure, addExistingStructure, removeStructure, setNextIdFloor, clear
 *   Building.frontage: required Frontage field (added v9)
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
  // Procedural terrain API (added in Task 7): full regeneration entry-point.
  if (typeof world.regenerateTerrain !== 'function') {
    return false;
  }
  // Demand API (added in Task 2): demand snapshot + dirty-mark.
  if (typeof world.getDemand !== 'function' || typeof world.markDemandDirty !== 'function') {
    return false;
  }
  // PowerMap API (added in Task 4 / v11): derived power field + dirty-mark + recompute.
  if (
    typeof world.getPowerMap !== 'function' ||
    typeof world.markPowerDirty !== 'function' ||
    typeof world.recomputePowerIfDirty !== 'function' ||
    typeof world.recomputePower !== 'function'
  ) {
    return false;
  }
  // WaterMap API (added in Task 3 / water): derived water field + dirty-mark + recompute.
  if (
    typeof world.getWaterMap !== 'function' ||
    typeof world.markWaterDirty !== 'function' ||
    typeof world.recomputeWaterIfDirty !== 'function' ||
    typeof world.recomputeWater !== 'function'
  ) {
    return false;
  }
  // ServiceCoverageMap API (added in service / v13): derived coverage field + dirty-mark + recompute.
  if (
    typeof world.getServiceCoverageMap !== 'function' ||
    typeof world.markServiceDirty !== 'function' ||
    typeof world.recomputeServiceIfDirty !== 'function' ||
    typeof world.recomputeService !== 'function'
  ) {
    return false;
  }
  // FireCoverageMap API (added in service-v2 / v14): derived fire coverage field + dirty-mark + recompute.
  if (
    typeof world.getFireCoverageMap !== 'function' ||
    typeof world.markFireDirty !== 'function' ||
    typeof world.recomputeFireIfDirty !== 'function' ||
    typeof world.recomputeFire !== 'function'
  ) {
    return false;
  }
  // HospitalCoverageMap API (added in service-v3 / v15): derived hospital coverage field + dirty-mark + recompute.
  if (
    typeof world.getHospitalCoverageMap !== 'function' ||
    typeof world.markHospitalDirty !== 'function' ||
    typeof world.recomputeHospitalIfDirty !== 'function' ||
    typeof world.recomputeHospital !== 'function'
  ) {
    return false;
  }
  // SchoolCoverageMap API (added in service-v4 / v16): derived school coverage field + dirty-mark + recompute.
  if (
    typeof world.getSchoolCoverageMap !== 'function' ||
    typeof world.markSchoolDirty !== 'function' ||
    typeof world.recomputeSchoolIfDirty !== 'function' ||
    typeof world.recomputeSchool !== 'function'
  ) {
    return false;
  }
  // StructureMap API (added in Task 2 / v11): all load-bearing methods used by save/dispatch/render.
  if (typeof world.getStructureMap !== 'function') return false;
  const structures = world.getStructureMap();
  if (
    typeof structures.getStructureAt !== 'function' ||
    typeof structures.getStructure !== 'function' ||
    typeof structures.iterStructures !== 'function' ||
    typeof structures.getAllStructures !== 'function' ||
    typeof structures.addStructure !== 'function' ||
    typeof structures.addExistingStructure !== 'function' ||
    typeof structures.removeStructure !== 'function' ||
    typeof structures.setNextIdFloor !== 'function' ||
    typeof structures.clear !== 'function'
  ) {
    return false;
  }
  return true;
}

export function getWorld(): World {
  if (
    !store.__cimulityWorld ||
    !hasCurrentWorldApi(store.__cimulityWorld) ||
    store.__cimulityWorldGuard !== WORLD_SINGLETON_GUARD
  ) {
    const save = readSave();
    let world: World;
    if (save) {
      // Save present: construct without procedural generation, then hydrate.
      world = new World(MAP_WIDTH, MAP_HEIGHT, { regenerate: false });
      const ok = deserializeWorldInto(world, save);
      if (!ok) {
        // Bad/corrupt save — fall back to procedural generation.
        world.reset({ regenerate: true });
        world.recomputePowerIfDirty();
        world.recomputeWaterIfDirty();
        world.recomputeServiceIfDirty();
        world.recomputeFireIfDirty();
        world.recomputeHospitalIfDirty();
        world.recomputeSchoolIfDirty();
      }
    } else {
      // No save — fresh procedural world.
      world = new World(MAP_WIDTH, MAP_HEIGHT, { regenerate: true });
    }
    store.__cimulityWorld = world;
    store.__cimulityWorldGuard = WORLD_SINGLETON_GUARD;
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
