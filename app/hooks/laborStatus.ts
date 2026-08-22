// laborStatus: display-only derived arithmetic over the three labor scalars
// (employed, unemployed, jobsCapacity) that World already tracks. Lives
// beside sampleStats.ts because that is the established home for gated pure
// UI logic — no game/core imports, no React, no side effects.

/** Display-only warning heuristic (no simulation effect): unemployment rate at or above this triggers the HUD warning. */
export const UNEMPLOYMENT_WARNING_RATE = 0.2;

/** Display-only warning heuristic (no simulation effect): floor below which a city is too small for the rate to mean anything, so the warning stays quiet. */
export const WARNING_MIN_WORKFORCE = 100;

export type LaborInput = {
  employed: number;
  unemployed: number;
  jobsCapacity: number;
};

export type LaborStatus = {
  workforce: number;
  employed: number;
  withoutJobs: number;
  jobsCapacity: number;
  openings: number;
  rate: number;
  ratePercent: number;
  warning: string | null;
};

export function laborStatus(input: LaborInput): LaborStatus {
  const { employed, unemployed, jobsCapacity } = input;
  const workforce = employed + unemployed;
  const rate = workforce === 0 ? 0 : unemployed / workforce;
  const ratePercent = Math.round(rate * 100);
  // Not clamped: employed <= jobsCapacity by construction (see laborMarket.ts), so this is never negative.
  const openings = jobsCapacity - employed;

  return {
    workforce,
    employed,
    withoutJobs: unemployed,
    jobsCapacity,
    openings,
    rate,
    ratePercent,
    warning: buildWarning(workforce, rate, ratePercent, jobsCapacity, openings),
  };
}

function buildWarning(
  workforce: number,
  rate: number,
  ratePercent: number,
  jobsCapacity: number,
  openings: number,
): string | null {
  if (workforce < WARNING_MIN_WORKFORCE || rate < UNEMPLOYMENT_WARNING_RATE) {
    return null;
  }

  // WHY "Unemployment", never "job shortage": the openings branch below fires in cities with a job surplus.
  const prefix = `⚠ Unemployment ${ratePercent}% — `;

  if (jobsCapacity === 0) {
    return `${prefix}the city has no jobs at all.`;
  }

  if (openings === 0) {
    return `${prefix}every job in the city is taken.`;
  }

  // WHY "cannot reach them", not "unreachable jobs": a road-less residence yields the same numbers with fully road-connected jobs.
  const openingWord = openings === 1 ? 'opening exists' : 'openings exist';
  return `${prefix}${openings} ${openingWord}, but the unemployed cannot reach them.`;
}
