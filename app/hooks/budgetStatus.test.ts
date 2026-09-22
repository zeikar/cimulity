import { describe, expect, it } from 'vitest';
import { budgetStatus } from './budgetStatus';

describe('budgetStatus', () => {
  it.each([
    // money, monthlyIncome, monthlyUpkeep, serviceFundingPerMille, netFlow, fundedPercent, underfunded, runwayMonths, warning
    [0, 0, 0, 1000, 0, 100, false, null, null], // empty city, no NaN
    [2000, 1000, 800, 1000, 200, 100, false, null, null], // surplus with money, no warning
    [5000, 500, 1500, 1000, -1000, 100, false, 5, '⚠ Treasury empty in ~5 months — upkeep exceeds tax income.'], // deficit with money
    [5001, 1000, 1500, 1000, -500, 100, false, 11, '⚠ Treasury empty in ~11 months — upkeep exceeds tax income.'], // ceil case: 5001/500 = 10.002 -> 11
    [400, 1000, 1500, 1000, -500, 100, false, 1, '⚠ Treasury empty in ~1 month — upkeep exceeds tax income.'], // singular month
    [0, 700, 1000, 1000, -300, 100, false, 0, '⚠ Upkeep exceeds tax income — the next settlement goes unpaid and freezes growth.'], // zero-treasury deficit, still fully funded per-mille
    [0, 0, 0, 545, 0, 54, true, null, '⚠ Upkeep unpaid (funded 54%) — growth frozen.'], // active shortfall, no deficit in play
    [100, 400, 500, 800, -100, 80, true, 1, '⚠ Upkeep unpaid (funded 80%) — growth frozen.'], // shortfall wins over a computed runway of 1
    [1000, 1000, 800, 999, 200, 99, true, null, '⚠ Upkeep unpaid (funded 99%) — growth frozen.'], // fundedPercent floors: 999/10 -> 99, still underfunded
    [1000, 1000, 800, 500, 200, 50, true, null, '⚠ Upkeep unpaid (funded 50%) — growth frozen.'], // recovered net flow but freeze is live until the next settlement
  ])(
    'money=%i income=%i upkeep=%i perMille=%i → netFlow=%i fundedPercent=%i underfunded=%s',
    (money, monthlyIncome, monthlyUpkeep, serviceFundingPerMille, netFlow, fundedPercent, underfunded, runwayMonths, warning) => {
      const result = budgetStatus({ money, monthlyIncome, monthlyUpkeep, serviceFundingPerMille });
      // Full-object assertion: catches a transposed return literal that a partial
      // check on runwayMonths/warning alone would miss.
      expect(result).toEqual({
        netFlow,
        fundedPercent,
        underfunded,
        runwayMonths,
        warning,
      });
    },
  );
});
