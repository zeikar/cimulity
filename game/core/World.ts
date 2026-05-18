/**
 * Central world state container
 * Holds all game state but doesn't manage rendering
 */

import { GameMap } from './Map';

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

  /**
   * Reset to a blank city: clear the map and the tick counter.
   */
  reset(): void {
    this.map.reset();
    this.tickCount = 0;
  }

  /**
   * Advance simulation (placeholder for MVP-1)
   */
  tick(): void {
    this.tickCount++;
    // Future: Update city simulation here
  }
}
