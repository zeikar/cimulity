import type { BuildingMap } from './Building';

export const DENSITY_DEMAND_THRESHOLD = 0.6;

// Readonly<...> is a compile-time guard only — the module returns an Object.freeze'd snapshot to enforce immutability at runtime.
export type DemandVector = Readonly<{ residential: number; commercial: number; industrial: number }>;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

const BASELINE: DemandVector = Object.freeze({ residential: 0.25, commercial: 0.25, industrial: 0.25 });

// Bounded additive employment-feedback nudge: pushes zone demand toward labor market balance.
const LABOR_FEEDBACK_WEIGHT = 0.15;

// Plain scalars extracted from LaborMarketMap — no import of World or labor modules here.
type LaborScalars = Readonly<{ employed: number; unemployed: number; reachableUnfilledJobs: number }>;

export class Demand {
  private cached: DemandVector;

  constructor() {
    this.cached = BASELINE;
  }

  recompute(buildings: BuildingMap, labor: LaborScalars): void {
    let levelSumR = 0;
    let levelSumC = 0;
    let levelSumI = 0;

    for (const b of buildings.iterBuildings()) {
      if (b.abandoned) continue;
      if (b.type === 'residential') levelSumR += b.level;
      else if (b.type === 'commercial') levelSumC += b.level;
      else if (b.type === 'industrial') levelSumI += b.level;
    }

    const jobsLevels = levelSumC + levelSumI;

    // Pre-clamp structural expressions (baseline folded in).
    const structuralR = (jobsLevels - levelSumR) / Math.max(jobsLevels, 1) + 0.25;
    const structuralI = (levelSumR - jobsLevels) / Math.max(levelSumR, 1) + 0.25;
    const structuralC = (levelSumR - 2 * levelSumC) / Math.max(levelSumR, 1) + 0.25;

    // Labor feedback signals — both zero-guarded so empty cities produce signals of 0.
    const reachableSlots = labor.employed + labor.reachableUnfilledJobs;
    const reachableVacancyRate = reachableSlots > 0 ? labor.reachableUnfilledJobs / reachableSlots : 0;
    const workers = labor.employed + labor.unemployed;
    const unemploymentRate = workers > 0 ? labor.unemployed / workers : 0;
    const residentialSignal = reachableVacancyRate - unemploymentRate; // ∈ [-1,+1]
    const jobsSignal = -residentialSignal;

    const residential = clamp01(structuralR + LABOR_FEEDBACK_WEIGHT * residentialSignal);
    const industrial = clamp01(structuralI + LABOR_FEEDBACK_WEIGHT * jobsSignal);
    const commercial = clamp01(structuralC + LABOR_FEEDBACK_WEIGHT * jobsSignal);

    this.cached = Object.freeze({ residential, commercial, industrial });
  }

  get(): DemandVector {
    return this.cached;
  }

  getRaw(): DemandVector {
    return this.cached;
  }
}
