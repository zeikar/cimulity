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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { World, STARTING_FUNDS } from './World';
import { TileType } from './Tile';
import { WORLD_SAVE_VERSION } from './mapSerialization';

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

// The storage key mirrors the constant in worldStore.ts (frozen value).
const STORAGE_KEY = 'cimulity:save:v2';

// ---- singleton reset helper ----

function resetSingleton(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__cimulityWorld;
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
  it('writes a v4 envelope to STORAGE_KEY with correct v, m, and d', () => {
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
    expect(parsed.v).toBe(WORLD_SAVE_VERSION); // must be 4
    expect(parsed.m).toBe(expectedMoney);
    expect(parsed.d).toBe(expectedDays);
    expect('tk' in parsed).toBe(false); // no separate persisted tick field
  });
});

describe('getWorld — v3 envelope restores money + map', () => {
  it('restores money and map from v3; calendar defaults to year 1 month 1 day 1 / tick 0', () => {
    // Craft a v3 envelope manually (no `d` field — backward-compat).
    const tiles = Array(64 * 64).fill(TileType.GRASS) as TileType[];
    tiles[5 + 5 * 64] = TileType.ROAD; // (5,5)
    const levels = Array(64 * 64).fill(0) as number[];
    const v3Payload = JSON.stringify({ v: 3, w: 64, h: 64, t: tiles, l: levels, m: 7000 });
    fakeStorage.setItem(STORAGE_KEY, v3Payload);

    const restored = getWorld();

    expect(restored.getMoney()).toBe(7000);
    expect(restored.getMap().getTile(5, 5)?.type).toBe(TileType.ROAD);
    // v3 has no calendar — should default to day 0 / tick 0 / Year 1 M1 D1.
    expect(restored.getElapsedDays()).toBe(0);
    expect(restored.getTick()).toBe(0);
    const date = restored.getDate();
    expect(date.year).toBe(1);
    expect(date.month).toBe(1);
    expect(date.day).toBe(1);
  });
});

describe('getWorld — v2 envelope (no m) defaults money to STARTING_FUNDS', () => {
  it('loads map tiles and sets money to STARTING_FUNDS when saved payload has no m', () => {
    // Craft a v2 envelope manually (64×64 map; only first tile is ROAD for this test).
    const tiles = Array(64 * 64).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ROAD; // (0,0)
    const levels = Array(64 * 64).fill(0) as number[];
    const v2Payload = JSON.stringify({ v: 2, w: 64, h: 64, t: tiles, l: levels });
    fakeStorage.setItem(STORAGE_KEY, v2Payload);

    const world = getWorld();

    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    // v2 has no calendar — day and tick default to 0.
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
  });
});

describe('getWorld — v1 legacy envelope (no l, no m) defaults money to STARTING_FUNDS', () => {
  it('loads map tiles with all levels 0 and money === STARTING_FUNDS', () => {
    // v1: no `l` key, no `m` key.
    const tiles = Array(64 * 64).fill(TileType.GRASS) as TileType[];
    tiles[1] = TileType.WATER; // (1,0)
    const v1Payload = JSON.stringify({ v: 1, w: 64, h: 64, t: tiles });
    fakeStorage.setItem(STORAGE_KEY, v1Payload);

    const world = getWorld();

    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.WATER);
    // v1 always loads with level 0.
    expect(world.getMap().getTile(1, 0)?.level).toBe(0);
    // v1 has no calendar — day and tick default to 0.
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
  });
});

describe('getWorld — v4 envelope restores calendar', () => {
  it('restores getElapsedDays, getTick, and getDate from a v4 save', () => {
    // Build a world, advance N ticks, save it.
    const src = new World(64, 64, { regenerate: false });
    const N = 5;
    for (let i = 0; i < N; i++) src.tick();
    saveWorld(src);
    expect(src.getElapsedDays()).toBe(N);
    expect(src.getTick()).toBe(N);

    // Reset singleton; getWorld() must hydrate from the v4 save.
    resetSingleton();
    const restored = getWorld();

    expect(restored.getElapsedDays()).toBe(N);
    expect(restored.getTick()).toBe(N);
    // Day N=5: year 1, month 1, day 6 (0-based day 5 → 1-based day 6).
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
