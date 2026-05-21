/**
 * Pure module-level tests for installDevApi hook-dispatch.
 * No real GameSession construction — only hand-built DevApiHooks mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installDevApi, uninstallDevApi, type DevApiHooks } from './devApi';

// Minimal stubs for World and PixiApp — installDevApi only references them
// through the `dev.seedScene` and `dev.setCameraTile` closures which we never
// call in these tests. Casting avoids importing the real heavyweight modules.
const stubWorld = {} as Parameters<typeof installDevApi>[0];
const stubPixiApp = {
  getTileRenderer: () => null,
  getCamera: () => null,
} as unknown as Parameters<typeof installDevApi>[1];

function makeHooks(): {
  hooks: DevApiHooks;
  mocks: {
    regenerateTerrain: ReturnType<typeof vi.fn>;
    resetWorld: ReturnType<typeof vi.fn>;
    saveNow: ReturnType<typeof vi.fn>;
  };
} {
  const regenerateTerrain = vi.fn();
  const resetWorld = vi.fn();
  const saveNow = vi.fn();
  return {
    hooks: { regenerateTerrain, resetWorld, saveNow },
    mocks: { regenerateTerrain, resetWorld, saveNow },
  };
}

// NODE_ENV is not 'development' in the test runner, so installDevApi is a no-op.
// Override it to 'development' so the dev surface is actually installed.
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = 'development';
});

afterEach(() => {
  uninstallDevApi();
  process.env.NODE_ENV = originalNodeEnv;
});

describe('installDevApi hook-dispatch', () => {
  it('(a) dev.regenerateTerrain(1) invokes hooks.regenerateTerrain with arg 1', () => {
    const { hooks, mocks } = makeHooks();
    installDevApi(stubWorld, stubPixiApp, hooks);

    globalThis.__cimulity!.dev.regenerateTerrain(1);

    expect(mocks.regenerateTerrain).toHaveBeenCalledTimes(1);
    expect(mocks.regenerateTerrain).toHaveBeenCalledWith(1);
  });

  it('(b) dev.regenerateTerrain() invokes hooks.regenerateTerrain with arg undefined', () => {
    const { hooks, mocks } = makeHooks();
    installDevApi(stubWorld, stubPixiApp, hooks);

    globalThis.__cimulity!.dev.regenerateTerrain();

    expect(mocks.regenerateTerrain).toHaveBeenCalledTimes(1);
    expect(mocks.regenerateTerrain).toHaveBeenCalledWith(undefined);
  });

  it('(c) dev.resetWorld() invokes hooks.resetWorld', () => {
    const { hooks, mocks } = makeHooks();
    installDevApi(stubWorld, stubPixiApp, hooks);

    globalThis.__cimulity!.dev.resetWorld();

    expect(mocks.resetWorld).toHaveBeenCalledTimes(1);
  });

  it('(c) dev.saveNow() invokes hooks.saveNow', () => {
    const { hooks, mocks } = makeHooks();
    installDevApi(stubWorld, stubPixiApp, hooks);

    globalThis.__cimulity!.dev.saveNow();

    expect(mocks.saveNow).toHaveBeenCalledTimes(1);
  });
});
