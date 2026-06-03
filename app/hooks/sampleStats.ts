// sampleStats: pure sampling reducer for the statistics panel time-series.
//
// WHY replace-on-same-tick: the tick forwarder fires at the SAME tick for
// paused tool-spend updates (e.g. world.trySpend dirties happiness without
// advancing the tick counter). Replacing the last element instead of appending
// keeps the displayed values fresh without creating duplicate x-points in the
// chart.
//
// WHY reset/tick===0 is NOT handled here: clearing the history on world reset
// is the hook's responsibility (Task 2). This function is purely about
// appending or replacing within an existing history window.

export const STATS_HISTORY_CAPACITY = 240;

export type StatsSample = {
  tick: number;
  population: number;
  money: number;
  happiness: number;
};

/**
 * Returns the next sample history given the previous immutable array and a new
 * sample. Never mutates `prev`.
 *
 * - empty prev           → [next]
 * - next.tick > last     → append next, slice to last `capacity` items
 * - next.tick === last   → replace last in place (same-tick freshen)
 * - next.tick < last     → replace last in place (defensive; ticks are monotonic)
 */
export function sampleStats(
  prev: readonly StatsSample[],
  next: StatsSample,
  capacity = STATS_HISTORY_CAPACITY,
): StatsSample[] {
  if (prev.length === 0) {
    return [next];
  }

  const last = prev[prev.length - 1];

  if (next.tick > last.tick) {
    // Normal forward progress: append then drop oldest if over capacity.
    const appended = [...prev, next];
    return appended.length > capacity ? appended.slice(-capacity) : appended;
  }

  // Same tick (paused tool-spend) or stale tick (defensive): replace latest.
  return [...prev.slice(0, prev.length - 1), next];
}
