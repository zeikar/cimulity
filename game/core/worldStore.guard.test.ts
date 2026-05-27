/**
 * worldStore behavior tests.
 *
 * These tests RUN but are NOT in the vitest coverage gate (worldStore.ts is
 * intentionally excluded from the gated include list — it's I/O glue).
 *
 * Approach: install a fake in-memory localStorage on globalThis before each
 * test and reset the __cimulityWorld singleton so getWorld() re-hydrates from
 * the fake storage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { World, STARTING_FUNDS } from './World';
import { TileType, createTile } from './Tile';
import { serializeWorld } from './mapSerialization';
import * as terrainGeneratorModule from './terrainGenerator';

// We import the module under test AFTER setting up fakes so the module sees
// the fake localStorage at import-resolution time (but the functions call
// `typeof localStorage` at runtime, so we just need the global in place when
// they run).
import { getWorld, saveWorld } from './worldStore';

// ---- fake localStorage ----

type FakeStorage = {
  _data: Record<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function makeFakeStorage(): FakeStorage {
  const _data: Record<string, string> = {};
  return {
    _data,
    getItem(key: string) { return Object.prototype.hasOwnProperty.call(_data, key) ? _data[key] : null; },
    setItem(key: string, value: string) { _data[key] = value; },
    removeItem(key: string) { delete _data[key]; },
  };
}

// The storage key mirrors the constant in worldStore.ts (v10 cut).
const STORAGE_KEY = 'cimulity:save:v10';

// ---- singleton reset helper ----

function resetSingleton(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__cimulityWorld;
  // Also clear the paired sentinel so each test starts from a clean slate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__cimulityWorldGuard;
}

// ---- test lifecycle ----

let fakeStorage: FakeStorage;

beforeEach(() => {
  fakeStorage = makeFakeStorage();
  // Install fake localStorage on globalThis so worldStore can reach it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = fakeStorage;
  resetSingleton();
});

afterEach(() => {
  resetSingleton();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).localStorage;
});

// ---- tests ----

// Full stub that passes hasCurrentWorldApi — all load-bearing methods present.
function makeFullApiStub() {
  return {
    getMoney: () => 0,
    trySpend: () => false,
    setMoney: () => {},
    getDate: () => ({ year: 1, month: 1, day: 1 }),
    getElapsedDays: () => 0,
    setElapsedDays: () => {},
    getMap: () => ({
      getBuildings: () => ({
        getBuildingAt: () => null,
        getBuilding: () => null,
        iterBuildings: () => [],
        getAllBuildings: () => [],
        addBuilding: () => null,
        addExistingBuilding: () => false,
        removeBuilding: () => {},
        setNextIdFloor: () => {},
        clear: () => {},
      }),
      setTileAndReconcile: () => ({ changed: false, removedBuilding: null }),
    }),
    getLandValue: () => null,
    markLandValueDirty: () => {},
    recomputeLandValueIfDirty: () => {},
    recomputeLandValue: () => {},
    getTerrain: () => null,
    installTerrain: () => {},
    getTerrainRevision: () => 0,
    isWater: () => false,
    canBuildAt: () => true,
    canBuildRoadAt: () => true,
    regenerateTerrain: () => {},
    getDemand: () => ({ residential: 0.25, commercial: 0.25, industrial: 0.25 }),
    markDemandDirty: () => {},
  };
}

describe('getWorld — sentinel: Test A — API probe fails → fresh World', () => {
  it('discards a stub missing required methods even when sentinel matches', () => {
    // Stub is missing several methods so hasCurrentWorldApi returns false.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorld = {
      getMoney: () => 0,
      trySpend: () => false,
      // getDate, getElapsedDays, setElapsedDays, getMap … all absent.
    };
    // Set the current sentinel so only the API probe causes the discard.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorldGuard = 'lot-structure-merge-v1';

    const result = getWorld();

    expect(result).toBeInstanceOf(World);
    expect(typeof result.getDate).toBe('function');
    expect(typeof result.regenerateTerrain).toBe('function');
  });
});

describe('getWorld — sentinel: Test B — sentinel mismatch → fresh World', () => {
  it('discards a stub that passes the API probe but has a wrong sentinel', () => {
    const stub = makeFullApiStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorld = stub;
    // Set a sentinel value that does NOT match the current guard.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorldGuard = 'old-guard-v0';

    const result = getWorld();

    expect(result).not.toBe(stub);
    expect(result).toBeInstanceOf(World);
  });
});

describe('getWorld — sentinel: Test C — both checks pass → cached instance returned', () => {
  it('returns the same instance (===) when API probe and sentinel both pass', () => {
    // Use a real World so hasCurrentWorldApi returns true.
    const real = new World(64, 64, { regenerate: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorld = real;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorldGuard = 'lot-structure-merge-v1';

    const result = getWorld();

    expect(result).toBe(real);
  });
});

describe('getWorld — sentinel: Test D — no pre-seed → fresh World + guard set', () => {
  it('builds a fresh World and writes lot-structure-merge-v1 to globalThis.__cimulityWorldGuard', () => {
    // Singleton and guard are already cleared by beforeEach (resetSingleton).
    const result = getWorld();

    expect(result).toBeInstanceOf(World);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).__cimulityWorldGuard).toBe('lot-structure-merge-v1');
  });
});

// ---- Task 7 spy-based tests: verify generateTerrain call counts ----

describe('getWorld — spy: generateTerrain call count', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valid current-version save: generateTerrain is NOT called (0 times)', () => {
    // Pre-populate localStorage with a valid current-version save (constructed before spy is active).
    const src = new World(64, 64, { regenerate: true });
    fakeStorage.setItem(STORAGE_KEY, serializeWorld(src));

    // Now spy — any call from here on is captured.
    const spy = vi.spyOn(terrainGeneratorModule, 'generateTerrain');

    resetSingleton();
    getWorld();

    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('empty localStorage: generateTerrain is called exactly once', () => {
    // localStorage is empty.
    const spy = vi.spyOn(terrainGeneratorModule, 'generateTerrain');

    getWorld();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('corrupt save: generateTerrain is called exactly once (fallback)', () => {
    fakeStorage.setItem(STORAGE_KEY, '{not valid json');

    const spy = vi.spyOn(terrainGeneratorModule, 'generateTerrain');

    getWorld();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---- T1/T6 v10 schema tests ----

describe('getWorld — stale v9 key ignored, v10 key absent → fresh procedural world', () => {
  it('stale cimulity:save:v9 blob with empty v10 key returns STARTING_FUNDS world', () => {
    // Write something to the old v9 key — the v10 key is absent.
    const src = new World(64, 64, { regenerate: false });
    src.trySpend(3000); // treasury = 7000 so we can detect if it was loaded
    fakeStorage.setItem('cimulity:save:v9', serializeWorld(src));
    // v10 key is absent — fakeStorage has nothing at that key.

    const world = getWorld();

    // Must be a fresh world: the v9 save is never read.
    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getElapsedDays()).toBe(0);
  });
});

describe('getWorld — valid v10 save with buildings hydrates frontage', () => {
  it('hydrated world carries frontage on buildings round-tripped through v10 serialization', () => {
    const src = new World(64, 64, { regenerate: false });
    const map = src.getMap();
    map.setTile(5, 5, createTile(5, 5, TileType.ZONE_RESIDENTIAL));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 5, y: 5 }],
      anchor: { x: 5, y: 5 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'W',
      structureRect: { x: 5, y: 5, w: 1, h: 1 },
    });
    fakeStorage.setItem(STORAGE_KEY, serializeWorld(src));

    resetSingleton();
    const restored = getWorld();

    const b = restored.getMap().getBuildings().getBuildingAt(5, 5);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('W');
  });
});

describe('getWorld — stale singleton missing getDemand is discarded', () => {
  it('rebuilds from save when __cimulityWorld lacks getDemand', () => {
    const src = new World(64, 64, { regenerate: false });
    saveWorld(src);

    // Full API stub but missing getDemand — simulates a pre-demand singleton.
    const stale = makeFullApiStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (stale as any).getDemand;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorld = stale;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorldGuard = 'lot-structure-merge-v1';

    const result = getWorld();

    expect(result).not.toBe(stale);
    expect(result).toBeInstanceOf(World);
    expect(typeof result.getDemand).toBe('function');
    expect(typeof result.markDemandDirty).toBe('function');
  });
});

describe('WORLD_SINGLETON_GUARD invalidates stale HMR singletons', () => {
  it('rebuilds when guard differs', () => {
    const globals = globalThis as unknown as {
      __cimulityWorld?: World;
      __cimulityWorldGuard?: string;
    };
    // Seed a stale singleton with an old guard value:
    const stale = new World(64, 64, { regenerate: false });
    globals.__cimulityWorld = stale;
    globals.__cimulityWorldGuard = 'vertex-smooth-frontage-demand-v1'; // OLD value
    // Calling getWorld() should detect the guard mismatch and build a fresh world:
    const fresh = getWorld();
    expect(fresh).not.toBe(stale);
    expect(globals.__cimulityWorldGuard).toBe('lot-structure-merge-v1');
  });
});

describe('getWorld — stale v9-keyed save is not read by v10 loader', () => {
  it('seeds a v9-keyed payload, calls getWorld(), and asserts the loaded world is fresh', () => {
    // Construct a world and save its JSON to the OLD v9 key.
    const src = new World(64, 64, { regenerate: false });
    src.trySpend(4000); // treasury = 6000 so we can detect if it was loaded
    fakeStorage.setItem('cimulity:save:v9', serializeWorld(src));
    // v10 key is absent.

    const world = getWorld();

    // Must be a fresh world: the v9-keyed save is at a different localStorage key
    // and is never read by the v10 loader.
    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getElapsedDays()).toBe(0);
  });
});
