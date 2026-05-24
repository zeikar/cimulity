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
import { TileType } from './Tile';
import { WORLD_SAVE_VERSION, serializeWorld } from './mapSerialization';
import * as terrainGeneratorModule from './terrainGenerator';

// We import the module under test AFTER setting up fakes so the module sees
// the fake localStorage at import-resolution time (but the functions call
// `typeof localStorage` at runtime, so we just need the global in place when
// they run).
import { getWorld, saveWorld, clearSave } from './worldStore';

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

// The storage key mirrors the constant in worldStore.ts (v8 cut).
const STORAGE_KEY = 'cimulity:save:v8';

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

describe('saveWorld', () => {
  it('writes a current-version envelope to STORAGE_KEY with correct v, m, and d', () => {
    const world = new World(64, 64, { regenerate: false });
    world.trySpend(1500); // leave 8500 in the treasury (STARTING_FUNDS=10000)
    // Advance a few ticks so d is non-zero.
    world.tick();
    world.tick();
    world.tick();
    const expectedMoney = world.getMoney();
    const expectedDays = world.getElapsedDays(); // 3

    saveWorld(world);

    const raw = fakeStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.v).toBe(WORLD_SAVE_VERSION);
    expect(parsed.m).toBe(expectedMoney);
    expect(parsed.d).toBe(expectedDays);
    expect('tk' in parsed).toBe(false); // no separate persisted tick field
  });
});

describe('getWorld — older envelopes are rejected and fall back to a fresh procedural world', () => {
  // The deserializer accepts only v === WORLD_SAVE_VERSION. Any older
  // envelope is rejected on load and worldStore falls back to a fresh
  // procedural world (money = STARTING_FUNDS, calendar = day 0).
  it.each([
    [
      'v3 envelope (no d)',
      () => {
        const tiles = Array(64 * 64).fill(TileType.GRASS) as TileType[];
        tiles[5 + 5 * 64] = TileType.ROAD;
        const levels = Array(64 * 64).fill(0) as number[];
        return JSON.stringify({ v: 3, w: 64, h: 64, t: tiles, l: levels, m: 7000 });
      },
    ],
    [
      'v2 envelope (no m)',
      () => {
        const tiles = Array(64 * 64).fill(TileType.GRASS) as TileType[];
        tiles[0] = TileType.ROAD;
        const levels = Array(64 * 64).fill(0) as number[];
        return JSON.stringify({ v: 2, w: 64, h: 64, t: tiles, l: levels });
      },
    ],
    [
      'v1 envelope (no l, no m)',
      () => {
        const tiles = Array(64 * 64).fill(TileType.GRASS) as TileType[];
        tiles[1] = TileType.DIRT;
        return JSON.stringify({ v: 1, w: 64, h: 64, t: tiles });
      },
    ],
  ])('rejects %s and returns a fresh procedural world', (_label, build) => {
    fakeStorage.setItem(STORAGE_KEY, build());

    const world = getWorld();

    // Fresh world: STARTING_FUNDS, calendar reset to day 0 / tick 0.
    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
  });
});

describe('getWorld — current-version envelope restores calendar', () => {
  it('restores getElapsedDays, getTick, and getDate from a freshly-saved envelope', () => {
    const src = new World(64, 64, { regenerate: false });
    const N = 5;
    for (let i = 0; i < N; i++) src.tick();
    saveWorld(src);
    expect(src.getElapsedDays()).toBe(N);
    expect(src.getTick()).toBe(N);

    resetSingleton();
    const restored = getWorld();

    expect(restored.getElapsedDays()).toBe(N);
    expect(restored.getTick()).toBe(N);
    const date = restored.getDate();
    expect(date.year).toBe(src.getDate().year);
    expect(date.month).toBe(src.getDate().month);
    expect(date.day).toBe(src.getDate().day);
  });
});

describe('getWorld — stale singleton missing calendar API is discarded', () => {
  it('rebuilds from save when __cimulityWorld has economy API but no calendar methods', () => {
    // Build and save a v4 world so there is something to hydrate from.
    const src = new World(64, 64, { regenerate: false });
    const N = 7;
    for (let i = 0; i < N; i++) src.tick();
    saveWorld(src);

    // Install a fake singleton that has the economy API but is missing the calendar API.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorld = {
      getMoney: () => 0,
      trySpend: () => false,
      setMoney: () => false,
      // getDate, getElapsedDays, setElapsedDays intentionally absent.
    };

    const result = getWorld();

    // The stale fake must have been discarded and a real World re-hydrated from the save.
    expect(typeof result.getDate).toBe('function');
    expect(typeof result.getElapsedDays).toBe('function');
    expect(result.getElapsedDays()).toBe(N);
    expect(result.getTick()).toBe(N);
  });
});

describe('getWorld — stale singleton missing getTerrain is discarded', () => {
  it('rebuilds from save when __cimulityWorld lacks getTerrain', () => {
    // Save something to hydrate from.
    const src = new World(64, 64, { regenerate: false });
    saveWorld(src);

    // Install a fake singleton that has the full current API except getTerrain.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorld = {
      getMoney: () => 0,
      trySpend: () => false,
      setMoney: () => false,
      getDate: () => ({ year: 1, month: 1, day: 1 }),
      getElapsedDays: () => 0,
      setElapsedDays: () => false,
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
      // getTerrain intentionally absent — stale singleton.
      installTerrain: () => {},
      getTerrainRevision: () => 0,
      isWater: () => false,
      canBuildAt: () => true,
      canBuildRoadAt: () => true,
    };

    const result = getWorld();

    // The stale fake must have been discarded; real World has getTerrain.
    expect(typeof result.getTerrain).toBe('function');
    expect(typeof result.installTerrain).toBe('function');
    expect(typeof result.getTerrainRevision).toBe('function');
    expect(typeof result.isWater).toBe('function');
    expect(typeof result.canBuildAt).toBe('function');
    expect(typeof result.canBuildRoadAt).toBe('function');
  });
});

describe('clearSave', () => {
  it('removes the key; subsequent getWorld() (after singleton reset) returns a fresh world with STARTING_FUNDS', () => {
    // Save something so the key exists.
    const world = new World(64, 64, { regenerate: false });
    world.trySpend(5000);
    saveWorld(world);

    expect(fakeStorage.getItem(STORAGE_KEY)).not.toBeNull();

    clearSave();

    expect(fakeStorage.getItem(STORAGE_KEY)).toBeNull();

    // Fresh getWorld() should start with STARTING_FUNDS (no save to restore from).
    resetSingleton();
    const fresh = getWorld();
    expect(fresh.getMoney()).toBe(STARTING_FUNDS);
  });
});

// ---- Task 7 hydration boundary tests ----

describe('getWorld — (a) no save → procedural terrain', () => {
  it('returns a world with at least one non-zero elevation and at least one water tile', () => {
    // localStorage is empty (fakeStorage has no entries).
    const world = getWorld();

    const terrain = world.getTerrain();
    const W = terrain.getWidth();
    const H = terrain.getHeight();

    let hasNonZeroElevation = false;
    let hasWaterTile = false;

    outer: for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (terrain.getTileElevation(x, y) !== 0) hasNonZeroElevation = true;
        if (world.isWater(x, y)) hasWaterTile = true;
        if (hasNonZeroElevation && hasWaterTile) break outer;
      }
    }

    expect(hasNonZeroElevation).toBe(true);
    expect(hasWaterTile).toBe(true);
  });
});

describe('getWorld — (b) valid current-version save → matches save terrain', () => {
  it('restores terrain exactly from a freshly-saved envelope', () => {
    // Build a source world with procedural terrain and save it.
    const src = new World(64, 64, { regenerate: true });
    const terrainSnapshot = src.getTerrain().toJSON();
    fakeStorage.setItem(STORAGE_KEY, serializeWorld(src));

    // Reset singleton and reload.
    resetSingleton();
    const restored = getWorld();

    expect(restored.getTerrain().toJSON()).toEqual(terrainSnapshot);
  });
});

describe('getWorld — (c) corrupt save → procedural fallback', () => {
  it('falls back to procedural terrain when the save is corrupt', () => {
    fakeStorage.setItem(STORAGE_KEY, '{not valid json');

    const world = getWorld();

    const terrain = world.getTerrain();
    const W = terrain.getWidth();
    const H = terrain.getHeight();

    let hasNonZeroElevation = false;
    outer: for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (terrain.getTileElevation(x, y) !== 0) { hasNonZeroElevation = true; break outer; }
      }
    }

    expect(hasNonZeroElevation).toBe(true);
  });
});

describe('getWorld — (d) HMR guard rejects stale singleton missing regenerateTerrain', () => {
  it('discards a singleton lacking regenerateTerrain and returns a real World', () => {
    // Build a source world and save it so getWorld() has something to hydrate from.
    const src = new World(64, 64, { regenerate: false });
    saveWorld(src);

    // Install a fake singleton that has the full current API except regenerateTerrain.
    const stale = {
      getMoney: () => 0,
      trySpend: () => false,
      setMoney: () => false,
      getDate: () => ({ year: 1, month: 1, day: 1 }),
      getElapsedDays: () => 0,
      setElapsedDays: () => false,
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
      // regenerateTerrain intentionally absent — stale singleton.
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__cimulityWorld = stale;

    const result = getWorld();

    // The stale fake must have been discarded; real World has regenerateTerrain.
    expect(result).not.toBe(stale);
    expect(typeof result.regenerateTerrain).toBe('function');
  });
});

// ---- Task 7 sentinel tests ----

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
    (globalThis as any).__cimulityWorldGuard = 'vertex-smooth-v1';

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
    (globalThis as any).__cimulityWorldGuard = 'vertex-smooth-v1';

    const result = getWorld();

    expect(result).toBe(real);
  });
});

describe('getWorld — sentinel: Test D — no pre-seed → fresh World + guard set', () => {
  it('builds a fresh World and writes vertex-smooth-v1 to globalThis.__cimulityWorldGuard', () => {
    // Singleton and guard are already cleared by beforeEach (resetSingleton).
    const result = getWorld();

    expect(result).toBeInstanceOf(World);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).__cimulityWorldGuard).toBe('vertex-smooth-v1');
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
