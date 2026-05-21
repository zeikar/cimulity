import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GameLoop,
  GameLoopTickInfo,
  MAX_CATCHUP_TICKS,
  DEFAULT_TICK_MS,
  DEFAULT_SPEED_MULTIPLIER,
  ALLOWED_SPEED_MULTIPLIERS,
  type SpeedMultiplier,
} from './GameLoop';
import { World } from './World';
import { TileType, createTile } from './Tile';

/**
 * We use two separate controls per test:
 *   - fakeNow: a counter advanced manually that the GameLoop's injected clock reads.
 *   - vi.useFakeTimers(): controls setInterval so we can fire the driver pump at will.
 */

describe('GameLoop', () => {
  const TICK_MS = 100; // short tick for fast tests

  let fakeNow: number;
  let world: World;
  let onTick: ReturnType<typeof vi.fn>;
  let loop: GameLoop;

  function makeLoop(w = world, cb = onTick as ((info: GameLoopTickInfo) => void) | undefined) {
    return new GameLoop(w, cb, TICK_MS, () => fakeNow);
  }

  /** Fire the driver interval pump once (advances setInterval by tickMs/4). */
  function pump() {
    vi.advanceTimersByTime(TICK_MS / 4);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    fakeNow = 0;
    world = new World(4, 4, { regenerate: false });
    onTick = vi.fn();
    loop = makeLoop();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  // (a) No immediate tick on start()
  it('(a) does not tick immediately on start()', () => {
    loop.start();
    // No fake clock advance, no pump
    expect(world.getTick()).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });

  // (b) Exactly one tickMs elapsed → exactly one tick + one notification
  it('(b) one tickMs elapsed produces exactly one tick and one onTick', () => {
    loop.start();
    fakeNow += TICK_MS;
    pump();
    expect(world.getTick()).toBe(1);
    expect(onTick).toHaveBeenCalledOnce();
    expect(onTick).toHaveBeenCalledWith({ tick: 1, changed: 0, changedTiles: [], changedBuildingIds: [] });
  });

  // (c) Bounded catch-up: 5 * tickMs → exactly MAX_CATCHUP_TICKS ticks in one notification
  it('(c) 5x tickMs drains exactly MAX_CATCHUP_TICKS ticks in one notification', () => {
    loop.start();
    fakeNow += TICK_MS * 5;
    pump();
    expect(world.getTick()).toBe(MAX_CATCHUP_TICKS);
    expect(onTick).toHaveBeenCalledOnce();
    expect(onTick).toHaveBeenCalledWith({ tick: MAX_CATCHUP_TICKS, changed: 0, changedTiles: [], changedBuildingIds: [] });
  });

  // (d) Catch-up capped (spiral guard): 100x tickMs → at most 5 ticks, backlog discarded
  it('(d) 100x tickMs is capped at MAX_CATCHUP_TICKS; backlog is discarded', () => {
    loop.start();
    fakeNow += TICK_MS * 100;
    pump();
    expect(world.getTick()).toBe(MAX_CATCHUP_TICKS);
    expect(onTick).toHaveBeenCalledOnce();

    // After discarding backlog, a single-tickMs advance produces exactly 1 more tick
    fakeNow += TICK_MS;
    pump();
    expect(world.getTick()).toBe(MAX_CATCHUP_TICKS + 1);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  // (e) Aggregated changed sum: 1 DIRT tile, 3 ticks → changed===1 in the notification
  it('(e) changed sum reflects DIRT->GRASS conversion across drained ticks', () => {
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));
    loop.start();
    fakeNow += TICK_MS * 3;
    pump();
    // First tick converts the dirt; subsequent ticks have changed=0
    expect(onTick).toHaveBeenCalledOnce();
    const info = onTick.mock.calls[0][0] as GameLoopTickInfo;
    expect(info.changed).toBe(1);
    expect(info.tick).toBe(3);
  });

  // (f) Partial elapsed carries over remainder
  it('(f) 1.5x tickMs yields 1 tick; 0.5x more yields 1 additional tick', () => {
    loop.start();
    fakeNow += TICK_MS * 1.5;
    pump();
    expect(world.getTick()).toBe(1);

    fakeNow += TICK_MS * 0.5;
    pump();
    expect(world.getTick()).toBe(2);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  // (g) start() twice does not stack drivers
  it('(g) calling start() twice does not stack drivers', () => {
    loop.start();
    loop.start(); // second call is no-op
    fakeNow += TICK_MS;
    pump();
    expect(world.getTick()).toBe(1);
    expect(onTick).toHaveBeenCalledOnce();
  });

  // (h) stop() halts ticking
  it('(h) stop() halts further ticking', () => {
    loop.start();
    fakeNow += TICK_MS;
    pump();
    expect(world.getTick()).toBe(1);

    loop.stop();
    fakeNow += TICK_MS * 10;
    pump(); // interval cleared, no-op
    expect(world.getTick()).toBe(1);
    expect(onTick).toHaveBeenCalledOnce();
  });

  // (i) reset() while running clears accumulator
  it('(i) reset() while running clears partial accumulator so no extra tick fires', () => {
    loop.start();
    // Advance to just under a full tick
    fakeNow += TICK_MS * 0.8;
    pump(); // no tick yet (< tickMs)

    loop.reset(); // clears accumulator and updates lastTime to fakeNow
    // Advance another 0.8 of a tick — without reset this would have been 1.6 total
    fakeNow += TICK_MS * 0.8;
    pump(); // should still not tick (only 0.8 elapsed since reset)
    expect(world.getTick()).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });

  // (j) reset() while stopped: no throw, no ticking, later start() works
  it('(j) reset() while stopped is safe and later start() behaves normally', () => {
    // Should not throw
    expect(() => loop.reset()).not.toThrow();

    // Should not start ticking on its own
    fakeNow += TICK_MS * 10;
    pump();
    expect(world.getTick()).toBe(0);

    // Later start() should work normally
    fakeNow = 0; // reset clock to clean state
    loop.start();
    fakeNow += TICK_MS;
    pump();
    expect(world.getTick()).toBe(1);
    expect(onTick).toHaveBeenCalledOnce();
  });

  // (k) onTick not called when drained === 0
  it('(k) onTick is not called when elapsed < tickMs', () => {
    loop.start();
    fakeNow += TICK_MS * 0.5;
    pump(); // < tickMs, no drain
    expect(world.getTick()).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });

  // Verify tickMs getter
  it('exposes tickMs via getter', () => {
    expect(loop.tickMs).toBe(TICK_MS);
  });

  // Verify DEFAULT_TICK_MS and MAX_CATCHUP_TICKS exports
  it('exports DEFAULT_TICK_MS and MAX_CATCHUP_TICKS', () => {
    expect(DEFAULT_TICK_MS).toBe(1000);
    expect(MAX_CATCHUP_TICKS).toBe(5);
  });

  // Verify getWorld() returns the world
  it('getWorld() returns the constructed world', () => {
    expect(loop.getWorld()).toBe(world);
  });

  // (l) Paused: setPaused(true) → 10x tickMs elapsed produces no tick and no onTick
  it('(l) paused: setPaused(true) → 10x tickMs elapsed produces no tick and no onTick', () => {
    loop.start();
    loop.setPaused(true);
    fakeNow += TICK_MS * 10;
    pump();
    expect(world.getTick()).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });

  // (m) Resume from pause does not burst-catch-up the paused interval
  it('(m) resume from pause does not burst-catch-up the paused interval', () => {
    loop.start();
    fakeNow += TICK_MS * 0.5;
    pump(); // no tick yet — accumulator holds ~0.5 * TICK_MS
    loop.setPaused(true);
    fakeNow += TICK_MS * 10; // wall-clock discarded by pause early-return
    pump(); // still no tick
    loop.setPaused(false);
    fakeNow += TICK_MS * 1;
    pump();
    expect(world.getTick()).toBe(1);
    expect(onTick).toHaveBeenCalledOnce();
    expect(onTick).toHaveBeenCalledWith({ tick: 1, changed: 0, changedTiles: [], changedBuildingIds: [] });
  });

  // (n) setPaused(true) then setPaused(false) without further elapsed time produces no tick
  it('(n) setPaused(true) then setPaused(false) without further elapsed time produces no tick', () => {
    loop.start();
    pump(); // lastTime now equals fakeNow
    loop.setPaused(true);
    loop.setPaused(false);
    pump();
    expect(world.getTick()).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });

  // (o) Speed multiplier 2x: 0.5 * TICK_MS wall-clock yields exactly 1 tick
  it('(o) speed multiplier 2x: 0.5 * TICK_MS wall-clock yields exactly 1 tick', () => {
    loop.start();
    loop.setSpeedMultiplier(2);
    fakeNow += TICK_MS * 0.5;
    pump();
    expect(world.getTick()).toBe(1);
    expect(onTick).toHaveBeenCalledOnce();
    expect(onTick).toHaveBeenCalledWith({ tick: 1, changed: 0, changedTiles: [], changedBuildingIds: [] });

    fakeNow += TICK_MS * 0.5;
    pump();
    expect(world.getTick()).toBe(2);
  });

  // (p) Speed multiplier 3x: TICK_MS wall-clock drains exactly 3 ticks in one notification
  it('(p) speed multiplier 3x: TICK_MS wall-clock drains exactly 3 ticks in one notification', () => {
    loop.start();
    loop.setSpeedMultiplier(3);
    fakeNow += TICK_MS;
    pump();
    expect(world.getTick()).toBe(3);
    expect(onTick).toHaveBeenCalledOnce();
    expect(onTick).toHaveBeenCalledWith({ tick: 3, changed: 0, changedTiles: [], changedBuildingIds: [] });
  });

  // (q) MAX_CATCHUP_TICKS still caps at higher speed
  it('(q) MAX_CATCHUP_TICKS still caps at higher speed', () => {
    loop.start();
    loop.setSpeedMultiplier(3);
    fakeNow += TICK_MS * 10; // would produce 30 ticks unbounded
    pump();
    expect(world.getTick()).toBe(MAX_CATCHUP_TICKS);
    expect(onTick).toHaveBeenCalledOnce();
  });

  // (r) Speed change mid-flight applies on the NEXT pump only
  it('(r) speed change mid-flight applies on the NEXT pump only', () => {
    loop.start();
    fakeNow += TICK_MS;
    pump();
    expect(world.getTick()).toBe(1);
    loop.setSpeedMultiplier(2);
    fakeNow += TICK_MS * 0.5;
    pump();
    expect(world.getTick()).toBe(2);
  });

  // (r2) Speed change with a partial accumulator already present
  it('(r2) speed change with a partial accumulator already present', () => {
    loop.start();
    fakeNow += TICK_MS * 0.5;
    pump(); // no tick yet — accumulator holds ~0.5 * TICK_MS (1x, unscaled)
    loop.setSpeedMultiplier(2);
    fakeNow += TICK_MS * 0.25; // wall-clock; scaled to 0.5 * TICK_MS by new multiplier
    pump(); // old 0.5 unscaled + new 0.5 scaled = 1.0 * TICK_MS → exactly 1 tick
    expect(world.getTick()).toBe(1);
    expect(onTick).toHaveBeenCalledOnce();
    expect(onTick).toHaveBeenCalledWith({ tick: 1, changed: 0, changedTiles: [], changedBuildingIds: [] });
  });

  // (s) setSpeedMultiplier rejects invalid values without mutating
  it('(s) setSpeedMultiplier rejects invalid values without mutating', () => {
    // Cast via `unknown` to bypass the `SpeedMultiplier = 1 | 2 | 3` union so we
    // can verify runtime rejection of out-of-tier values without using `any`.
    expect(loop.setSpeedMultiplier(0 as unknown as SpeedMultiplier)).toBe(false);
    expect(loop.setSpeedMultiplier(4 as unknown as SpeedMultiplier)).toBe(false);
    expect(loop.setSpeedMultiplier(1.5 as unknown as SpeedMultiplier)).toBe(false);
    expect(loop.setSpeedMultiplier(-1 as unknown as SpeedMultiplier)).toBe(false);
    expect(loop.setSpeedMultiplier(NaN as unknown as SpeedMultiplier)).toBe(false);
    expect(loop.getSpeedMultiplier()).toBe(1);
  });

  // (t) Initial state: isPaused() === false, getSpeedMultiplier() === 1
  it('(t) initial state: isPaused() === false, getSpeedMultiplier() === 1', () => {
    expect(loop.isPaused()).toBe(false);
    expect(loop.getSpeedMultiplier()).toBe(1);
  });

  // (u) DEFAULT_SPEED_MULTIPLIER and ALLOWED_SPEED_MULTIPLIERS exports
  it('(u) DEFAULT_SPEED_MULTIPLIER and ALLOWED_SPEED_MULTIPLIERS exports', () => {
    expect(DEFAULT_SPEED_MULTIPLIER).toBe(1);
    expect(ALLOWED_SPEED_MULTIPLIERS).toEqual([1, 2, 3]);
  });

  // (v) changedTiles aggregation across catch-up ticks
  it('(v) changedTiles contains the union of both ticks when two DIRT tiles heal on different ticks', () => {
    // Tile (0,0) starts as DIRT — heals on tick 1.
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));
    loop.start();

    // Advance exactly one tick so (0,0) heals; onTick fires once (tick 1, changedTiles [{x:0,y:0}]).
    fakeNow += TICK_MS;
    pump();
    expect(world.getTick()).toBe(1);

    // Now plant a second DIRT tile at (1,1).
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.DIRT));

    // Advance TWO more ticks in one pump so catch-up drains both:
    //   tick 2: heals (1,1)  → changedTiles [{x:1,y:1}]
    //   tick 3: nothing      → changedTiles []
    // Aggregated for this pump: [{x:1,y:1}].
    fakeNow += TICK_MS * 2;
    pump();
    expect(world.getTick()).toBe(3);
    expect(onTick).toHaveBeenCalledTimes(2);

    const agg = onTick.mock.calls[1][0] as GameLoopTickInfo;
    // The second pump aggregates both ticks; (1,1) must appear.
    expect(agg.changedTiles).toContainEqual({ x: 1, y: 1 });
    expect(agg.changed).toBe(1);

    // Verify that the first pump's changedTiles contained (0,0).
    const first = onTick.mock.calls[0][0] as GameLoopTickInfo;
    expect(first.changedTiles).toContainEqual({ x: 0, y: 0 });
  });

  // (w) catch-up ≥2 ticks including a density bump: aggregated changedTiles + changedBuildingIds
  it('(w) catch-up drain with density bump: aggregated changedTiles contains footprint coord and changedBuildingIds contains building id', () => {
    // Use a larger world with diversified zones so land value >= HIGH_DENSITY_THRESHOLD.
    const bigWorld = new World(6, 6, { regenerate: false });
    const bigMap = bigWorld.getMap();
    bigMap.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    bigMap.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    bigMap.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    bigMap.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    // Import needed constants inline to avoid polluting test scope
    // DENSITY_COOLDOWN_INTERVALS=24, ZONE_GROWTH_INTERVAL=8.
    // Seed a ZONE_MAX_LEVEL building with age DENSITY_COOLDOWN_INTERVALS-1
    // so that the NEXT growth tick bumps density (age → 24 >= 24).
    // id=0 (first building), stagger(0)=0.
    const b = bigMap.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 5, // ZONE_MAX_LEVEL
      density: 0,
      age: 23, // DENSITY_COOLDOWN_INTERVALS - 1
    })!;

    // Advance the world to just before the next growth tick
    // so that one more growth tick fires during catch-up.
    // Current tick is 0; next growth tick = ZONE_GROWTH_INTERVAL (8).
    // Pre-advance to 7 ticks so the next tick is 8 (a growth tick).
    // Land value is recomputed at tick 16 or when dirty; we force a dirty mark.
    bigWorld.markLandValueDirty();
    for (let i = 0; i < 7; i++) bigWorld.tick();

    // Create the loop with bigWorld
    const bigOnTick = vi.fn();
    const bigLoop = new GameLoop(bigWorld, bigOnTick, TICK_MS, () => fakeNow);
    bigLoop.start();

    // Advance fakeNow by 2 * TICK_MS to drain 2 world ticks in one pump.
    // tick 8  (growth tick): density bump fires → changedTiles + changedBuildingIds
    // tick 9  (non-growth):  nothing
    fakeNow += TICK_MS * 2;
    pump();

    bigLoop.stop();

    expect(bigOnTick).toHaveBeenCalledOnce();
    const agg = bigOnTick.mock.calls[0][0] as GameLoopTickInfo;
    expect(agg.changedBuildingIds).toContain(b.id);
    expect(agg.changedTiles).toContainEqual({ x: 0, y: 0 });
    expect(agg.changed).toBeGreaterThanOrEqual(1);
  });
});
