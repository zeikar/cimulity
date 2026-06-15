/**
 * Derived aggregate labor-market result holder. Recomputed via
 * `computeLaborMarket`; NOT persisted (transient, like the coverage maps).
 * DATA-ONLY — no render, no sim feedback.
 *
 * Caches a single `LaborResult` (the matched commute flows + employment /
 * job-capacity scalars). Mirrors the coverage-map holder pattern, except the
 * cached value is a plain object rather than a backing typed array. `getFlows()`
 * exposes the matched O-D flows so the traffic assignment can route them.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { BuildingMap } from './Building';
import { computeLaborMarket } from './laborMarket';
import type { CommuteFlow, LaborResult } from './laborMarket';

const EMPTY_RESULT: LaborResult = {
  flows: [],
  employed: 0,
  unemployed: 0,
  jobsCapacity: 0,
  jobsFilled: 0,
};

export class LaborMarketMap {
  private result: LaborResult = EMPTY_RESULT;

  /** Recompute the labor market from the current map / structure / building state. */
  recompute(map: GameMap, structures: StructureMap, buildings: BuildingMap): void {
    this.result = computeLaborMarket(map, structures, buildings);
  }

  /** Workers that found a job. */
  getEmployed(): number {
    return this.result.employed;
  }

  /** Workers with no job (road-less + over-capacity). */
  getUnemployed(): number {
    return this.result.unemployed;
  }

  /** Total jobs that exist (Σ non-abandoned C/I capacity, incl. road-less). */
  getJobsCapacity(): number {
    return this.result.jobsCapacity;
  }

  /** Jobs actually filled (== employed). */
  getJobsFilled(): number {
    return this.result.jobsFilled;
  }

  /** Matched aggregate commute O-D flows (origin → destination, worker count). */
  getFlows(): ReadonlyArray<CommuteFlow> {
    return this.result.flows;
  }

  clear(): void {
    this.result = EMPTY_RESULT;
  }
}
