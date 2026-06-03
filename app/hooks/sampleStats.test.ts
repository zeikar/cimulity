import { describe, expect, it } from 'vitest';
import { STATS_HISTORY_CAPACITY, StatsSample, sampleStats } from './sampleStats';

const s = (tick: number, population = 0, money = 0, happiness = 0): StatsSample => ({
  tick,
  population,
  money,
  happiness,
});

describe('sampleStats', () => {
  it('empty prev → single-element array containing next', () => {
    const result = sampleStats([], s(1, 100, 500, 0.5));
    expect(result).toEqual([s(1, 100, 500, 0.5)]);
  });

  it('strictly-increasing ticks append in order', () => {
    const a = s(1, 10, 100, 0.1);
    const b = s(2, 20, 200, 0.2);
    const c = s(3, 30, 300, 0.3);
    const result = sampleStats(sampleStats([a], b), c);
    expect(result).toEqual([a, b, c]);
  });

  it('same-tick call REPLACES last element (length unchanged, values updated)', () => {
    // Simulates the paused tool-spend scenario: money is spent and happiness
    // changes without the tick advancing.
    const initial = s(5, 100, 1000, 0.6);
    const updated = s(5, 100, 800, 0.55); // same tick, less money, slightly lower happiness
    const prev = [s(1), s(3), initial];
    const result = sampleStats(prev, updated);

    expect(result.length).toBe(3);
    expect(result[result.length - 1]).toEqual(updated);
    expect(result[result.length - 1]).not.toEqual(initial);
  });

  it('appending past capacity drops oldest and keeps newest capacity items', () => {
    const capacity = 5;
    let history: readonly StatsSample[] = [];
    // Fill beyond capacity
    for (let t = 1; t <= capacity + 3; t++) {
      history = sampleStats(history, s(t, t * 10), capacity);
    }
    expect(history.length).toBe(capacity);
    // Oldest (tick 1..3) should be gone; newest (tick 4..8) should remain.
    expect(history[0].tick).toBe(4);
    expect(history[history.length - 1].tick).toBe(8);
  });

  it('prev is never mutated', () => {
    const prev = [s(1, 10, 100, 0.1), s(2, 20, 200, 0.2)];
    const originalPrev = prev.map((x) => ({ ...x }));

    // Append path
    sampleStats(prev, s(3));
    expect(prev).toEqual(originalPrev);

    // Replace path (same tick)
    sampleStats(prev, s(2, 99, 99, 0.99));
    expect(prev).toEqual(originalPrev);
  });

  it('STATS_HISTORY_CAPACITY is 240', () => {
    expect(STATS_HISTORY_CAPACITY).toBe(240);
  });

  it('default capacity is STATS_HISTORY_CAPACITY', () => {
    // Fill to exactly capacity using default, then add one more — oldest drops.
    let history: readonly StatsSample[] = [];
    for (let t = 1; t <= STATS_HISTORY_CAPACITY + 1; t++) {
      history = sampleStats(history, s(t));
    }
    expect(history.length).toBe(STATS_HISTORY_CAPACITY);
    expect(history[0].tick).toBe(2);
    expect(history[history.length - 1].tick).toBe(STATS_HISTORY_CAPACITY + 1);
  });
});
