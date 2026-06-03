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

  // Intentional setState in effect: this hook's sole job is to accumulate
  // display-only history from tick-forwarder scalars. The effect deps are the
  // four scalar inputs (not history), so no infinite loop is possible.
  useEffect(() => {
    if (tick === 0) {
      // tick 0 = fresh city or "New City" reset; clear stale chart data.
      setHistory([]); // eslint-disable-line react-hooks/set-state-in-effect
    } else {
      // Functional updater avoids a stale closure on `history` and makes
      // same-tick replacement (paused tool-spend) work correctly — sampleStats
      // decides append-vs-replace based on prev's last tick, not a ref we manage.
      setHistory((prev) => sampleStats(prev, { tick, population, money, happiness }));
    }
  }, [tick, population, money, happiness]);

  return history;
}
