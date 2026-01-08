/**
 * Game loop manager (placeholder for MVP-1)
 * MVP-0: Only rendering loop, no simulation ticks
 */

import { World } from './World';

export class GameLoop {
  private world: World;
  private isRunning: boolean = false;
  private tickInterval: number = 1000; // ms per tick

  constructor(world: World) {
    this.world = world;
  }

  start(): void {
    this.isRunning = true;
    // Future: Implement setInterval for ticks
  }

  stop(): void {
    this.isRunning = false;
  }

  getWorld(): World {
    return this.world;
  }
}
