/**
 * Central world state container
 * Holds all game state but doesn't manage rendering
 */

import { GameMap } from './Map';
import { TileType, createTile } from './Tile';

export interface WorldTickResult {
  /** Number of DIRT tiles converted to GRASS this tick */
  changed: number;
}

export class World {
  private map: GameMap;
  private tickCount: number = 0;

  constructor(mapWidth: number, mapHeight: number) {
    this.map = new GameMap(mapWidth, mapHeight);
  }

  getMap(): GameMap {
    return this.map;
  }

  getTick(): number {
    return this.tickCount;
  }

  /** Count DIRT tiles currently on the map. */
  countDirt(): number {
    let count = 0;
    for (const tile of this.map.iterateTiles()) {
      if (tile.type === TileType.DIRT) count++;
    }
    return count;
  }

  /**
   * Reset to a blank city: clear the map and the tick counter.
   */
  reset(): void {
    this.map.reset();
    this.tickCount = 0;
  }

  /**
   * Advance simulation by one tick.
   * Rule: DIRT heals to GRASS on the next tick; no per-tile age.
   */
  tick(): WorldTickResult {
    this.tickCount++;
    let changed = 0;
    for (const tile of this.map.iterateTiles()) {
      if (tile.type === TileType.DIRT) {
        this.map.setTile(tile.x, tile.y, createTile(tile.x, tile.y, TileType.GRASS));
        changed++;
      }
    }
    return { changed };
  }
}
