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
import { TileType, createTile } from './Tile';
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
  it('writes a v3 envelope to STORAGE_KEY with correct v and m', () => {
    const world = new World(64, 64);
    world.trySpend(1500); // leave 8500 in the treasury (STARTING_FUNDS=10000)
    const expectedMoney = world.getMoney();

    saveWorld(world);

    const raw = fakeStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.v).toBe(WORLD_SAVE_VERSION); // must be 3
    expect(parsed.m).toBe(expectedMoney);
  });
});

describe('getWorld — v3 envelope restores money + map', () => {
  it('restores money exactly from a saved v3 envelope', () => {
    // Build and save a world with a known non-default money value.
    const src = new World(64, 64);
    src.trySpend(3000);
    src.getMap().setTile(5, 5, createTile(5, 5, TileType.ROAD));
    const expectedMoney = src.getMoney();

    saveWorld(src);

    // Reset singleton so getWorld() hydrates from storage.
    resetSingleton();
    const restored = getWorld();

    expect(restored.getMoney()).toBe(expectedMoney);
    expect(restored.getMap().getTile(5, 5)?.type).toBe(TileType.ROAD);
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
  });
});

describe('clearSave', () => {
  it('removes the key; subsequent getWorld() (after singleton reset) returns a fresh world with STARTING_FUNDS', () => {
    // Save something so the key exists.
    const world = new World(64, 64);
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
