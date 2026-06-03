// useStatsHistory: display-only sample history for the statistics panel.
//
// WHY display-only / never persisted: history is ephemeral chart data.
// It starts fresh from the first live tick each load, mirroring the precedent
// set by the happiness display KPI (getHappiness in World.ts).
//
// WHY sampling is in a useEffect, not render: calling setHistory during render
// triggers a React anti-pattern (render-phase setState) that causes infinite
// re-render loops and React strict-mode warnings. The effect fires
// after each commit, when it is safe to enqueue a state update.

import { useEffect, useState } from 'react';
import { sampleStats, StatsSample } from './sampleStats';

export function useStatsHistory(
  tick: number,
  population: number,
  money: number,
  happiness: number,
): StatsSample[] {
  const [history, setHistory] = useState<StatsSample[]>([]);

  // Functional updater avoids a stale closure on `history` and makes
  // same-tick replacement (paused tool-spend) work correctly — sampleStats
  // decides append-vs-replace based on prev's last tick, not a ref we manage.
  //
  // WHY backward-tick detects reset: ticks are monotonically increasing within
  // a world. The only way tick goes backward is a New City / destructive reset
  // that creates a fresh world at tick 0. tick===0 alone is not reliable — a
  // fresh world at tick 0 can receive tool-spend updates that should sample
  // normally, not clear the series.
  useEffect(() => {
    setHistory((prev) => { // eslint-disable-line react-hooks/set-state-in-effect
      const sample = { tick, population, money, happiness };
      // Reset: tick went backward (New City / destructive reset → fresh world at tick 0).
      if (prev.length > 0 && tick < prev[prev.length - 1].tick) return [sample];
      return sampleStats(prev, sample);
    });
  }, [tick, population, money, happiness]);

  return history;
}
