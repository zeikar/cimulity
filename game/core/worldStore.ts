/**
 * Process-wide World singleton.
 *
 * The instance is stashed on globalThis so it survives HMR / Fast Refresh
 * (which re-runs the GameCanvas effect and would otherwise build a fresh
 * World, discarding placed tiles). A full page reload clears globalThis,
 * so state intentionally resets on F5.
 */

import { World } from './World';

const MAP_WIDTH = 16;
const MAP_HEIGHT = 16;

const store = globalThis as unknown as { __cimulityWorld?: World };

export function getWorld(): World {
  if (!store.__cimulityWorld) {
    store.__cimulityWorld = new World(MAP_WIDTH, MAP_HEIGHT);
  }
  return store.__cimulityWorld;
}
