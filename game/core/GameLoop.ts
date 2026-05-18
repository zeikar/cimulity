/**
 * Fixed-timestep accumulator game loop (pure core, FPS-independent)
 */

import { World } from './World';

export const DEFAULT_TICK_MS = 1000;
export const MAX_CATCHUP_TICKS = 5;

export interface GameLoopTickInfo {
  /** Final world.getTick() after this pump's drain */
  tick: number;
  /** Sum of WorldTickResult.changed across all ticks drained this pump */
  changed: number;
}

export class GameLoop {
  private world: World;
  private onTick?: (agg: GameLoopTickInfo) => void;
  readonly tickMs: number;
  private now: () => number;

  private accumulator = 0;
  private lastTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  constructor(
    world: World,
    onTick?: (agg: GameLoopTickInfo) => void,
    tickMs: number = DEFAULT_TICK_MS,
    now?: () => number,
  ) {
    this.world = world;
    this.onTick = onTick;
    this.tickMs = tickMs;
    this.now = now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = this.now();
    this.accumulator = 0;
    this.timer = setInterval(() => this.advance(), this.tickMs / 4);
  }

  private advance(): void {
    const t = this.now();
    const elapsed = t - this.lastTime;
    this.lastTime = t;
    this.accumulator += elapsed;

    let drained = 0;
    let changedSum = 0;
    while (this.accumulator >= this.tickMs && drained < MAX_CATCHUP_TICKS) {
      this.accumulator -= this.tickMs;
      const r = this.world.tick();
      changedSum += r.changed;
      drained++;
    }

    // Discard over-cap backlog, keep sub-tick remainder
    if (this.accumulator >= this.tickMs) {
      this.accumulator = this.accumulator % this.tickMs;
    }

    if (drained > 0) {
      this.onTick?.({ tick: this.world.getTick(), changed: changedSum });
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  reset(): void {
    this.accumulator = 0;
    this.lastTime = this.now();
  }

  getWorld(): World {
    return this.world;
  }
}
