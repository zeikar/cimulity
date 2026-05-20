/**
 * Fixed-timestep accumulator game loop (pure core, FPS-independent)
 */

import { World } from './World';

export const DEFAULT_TICK_MS = 1000;
export const MAX_CATCHUP_TICKS = 5;

/** Default wall-clock speed multiplier (1x). */
export const DEFAULT_SPEED_MULTIPLIER = 1;
/** Allowed discrete speed tiers — 1x/2x/3x. */
export const ALLOWED_SPEED_MULTIPLIERS = [1, 2, 3] as const;

export type SpeedMultiplier = typeof ALLOWED_SPEED_MULTIPLIERS[number];

export interface GameLoopTickInfo {
  /** Final world.getTick() after this pump's drain */
  tick: number;
  /** Sum of WorldTickResult.changed across all ticks drained this pump */
  changed: number;
  /** Flat union of per-tile coords changed across all ticks drained this pump */
  changedTiles: ReadonlyArray<{ x: number; y: number }>;
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
  /** Pauses tick drain but not the driver interval; rendering/input continue. */
  private paused: boolean = false;
  /** Wall-clock elapsed is multiplied by this before accumulating. */
  private speedMultiplier: SpeedMultiplier = DEFAULT_SPEED_MULTIPLIER;

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

    // Pausing discards wall-clock by returning after lastTime is updated,
    // so resuming does not credit the paused interval as elapsed time (no phantom burst).
    if (this.paused) return;

    let scaledElapsed = elapsed;
    // Wall-clock elapsed scaled by speed tier (volatile UI state; no save impact).
    if (this.speedMultiplier !== 1) scaledElapsed *= this.speedMultiplier;

    this.accumulator += scaledElapsed;

    let drained = 0;
    let changedSum = 0;
    // Renderer is idempotent on repeated coords; not deduping.
    const changedTiles: { x: number; y: number }[] = [];
    while (this.accumulator >= this.tickMs && drained < MAX_CATCHUP_TICKS) {
      this.accumulator -= this.tickMs;
      const r = this.world.tick();
      changedSum += r.changed;
      for (const c of r.changedTiles) changedTiles.push(c);
      drained++;
    }

    // Discard over-cap backlog, keep sub-tick remainder
    if (this.accumulator >= this.tickMs) {
      this.accumulator = this.accumulator % this.tickMs;
    }

    if (drained > 0) {
      this.onTick?.({ tick: this.world.getTick(), changed: changedSum, changedTiles });
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

  isPaused(): boolean { return this.paused; }

  /**
   * Idempotent; pausing while already paused is a no-op; resuming after pause uses
   * lastTime (already updated each pump) so no burst.
   * togglePaused() lives on GameSession, not here — one place to fan out to React.
   */
  setPaused(paused: boolean): void { this.paused = paused; }

  getSpeedMultiplier(): SpeedMultiplier { return this.speedMultiplier; }

  /**
   * Returns false and does not mutate when given a value outside the allowed tiers.
   * This is a regular gameplay setter (NOT serialization-only) — pause/speed are
   * volatile UI state.
   */
  setSpeedMultiplier(multiplier: SpeedMultiplier): boolean {
    if (!(ALLOWED_SPEED_MULTIPLIERS as readonly number[]).includes(multiplier)) return false;
    this.speedMultiplier = multiplier;
    return true;
  }

  getWorld(): World {
    return this.world;
  }
}
