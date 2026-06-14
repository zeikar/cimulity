import type { BuildingMap } from './Building';

export const DENSITY_DEMAND_THRESHOLD = 0.6;

// Readonly<...> is a compile-time guard only — the module returns an Object.freeze'd snapshot to enforce immutability at runtime.
export type DemandVector = Readonly<{ residential: number; commercial: number; industrial: number }>;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

const BASELINE: DemandVector = Object.freeze({ residential: 0.25, commercial: 0.25, industrial: 0.25 });

export class Demand {
  private cached: DemandVector;

  constructor() {
    this.cached = BASELINE;
  }

  recompute(buildings: BuildingMap): void {
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

    const residential = clamp01((jobsLevels - levelSumR) / Math.max(jobsLevels, 1) + 0.25);
    const industrial = clamp01((levelSumR - jobsLevels) / Math.max(levelSumR, 1) + 0.25);
    const commercial = clamp01((levelSumR - 2 * levelSumC) / Math.max(levelSumR, 1) + 0.25);

    this.cached = Object.freeze({ residential, commercial, industrial });
  }

  get(): DemandVector {
    return this.cached;
  }

  getRaw(): DemandVector {
    return this.cached;
  }
}
