// budgetStatus: display-only derived arithmetic over the four budget scalars
// (money, monthlyIncome, monthlyUpkeep, serviceFundingPerMille) that World
// already tracks. Lives beside laborStatus.ts — no game/core imports, no
// React, no side effects.

// Mirrors game/core/serviceFunding.FUNDING_FULL_PER_MILLE. Duplicated (not
// imported) so this file stays free of game/core imports; keep in sync by hand.
const FUNDING_FULL_PER_MILLE = 1000;

// A deficit whose runway is further out than this is not worth an alarm: a single road in an
// empty city already projects decades of runway, and a permanent red line trains the player
// to ignore it.
const RUNWAY_WARNING_MONTHS = 12;

export type BudgetInput = {
  money: number;
  monthlyIncome: number;
  monthlyUpkeep: number;
  serviceFundingPerMille: number;
};

export type BudgetStatus = {
  netFlow: number;
  fundedPercent: number;
  underfunded: boolean;
  runwayMonths: number | null;
  warning: string | null;
};

export function budgetStatus(input: BudgetInput): BudgetStatus {
  const { money, monthlyIncome, monthlyUpkeep, serviceFundingPerMille } = input;
  const netFlow = monthlyIncome - monthlyUpkeep;
  // WHY "funded N%", not a service level: this is the share of last month's
  // upkeep bill actually PAID (see fundingPerMille in game/core/serviceFunding.ts),
  // not a measure of how well any particular service is covered.
  const fundedPercent = Math.floor(serviceFundingPerMille / 10);
  const underfunded = serviceFundingPerMille < FUNDING_FULL_PER_MILLE;
  // Ceil, so any money left reads at least one month; 0 only once the treasury is already empty.
  const runwayMonths = netFlow < 0 ? Math.ceil(money / -netFlow) : null;

  let warning: string | null = null;
  // WHY underfunded wins over the runway forecast: underfunded is a LIVE consequence
  // (growth is frozen right now, as of the last settlement), while runwayMonths is a
  // projection of what might happen later. A live consequence always outranks a forecast.
  if (underfunded) {
    // The funded % sits on its own HUD row; the warning says how long the freeze lasts, since
    // net flow may already be positive while last month's shortfall still holds growth.
    warning = "⚠ Last month's upkeep went unpaid — growth frozen until a month is paid in full.";
  } else if (runwayMonths === 0) {
    warning = '⚠ Upkeep exceeds tax income — the next settlement goes unpaid and freezes growth.';
  } else if (runwayMonths !== null && runwayMonths <= RUNWAY_WARNING_MONTHS) {
    const monthWord = runwayMonths === 1 ? 'month' : 'months';
    warning = `⚠ Treasury empty in ~${runwayMonths} ${monthWord} — upkeep exceeds tax income.`;
  }

  return { netFlow, fundedPercent, underfunded, runwayMonths, warning };
}
