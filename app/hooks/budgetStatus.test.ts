import { describe, expect, it } from 'vitest';
import { budgetStatus } from './budgetStatus';
import { FUNDING_FULL_PER_MILLE } from '@/game/core/serviceFunding';

describe('budgetStatus', () => {
  it.each([
    // money, monthlyIncome, monthlyUpkeep, serviceFundingPerMille, netFlow, fundedPercent, underfunded, runwayMonths, warning
    [0, 0, 0, 1000, 0, 100, false, null, null], // empty city, no NaN
    [2000, 1000, 800, 1000, 200, 100, false, null, null], // surplus with money, no warning
    [5000, 500, 1500, 1000, -1000, 100, false, 5, '⚠ Treasury empty in ~5 months — upkeep exceeds tax income.'], // deficit with money
    [5001, 1000, 1500, 1000, -500, 100, false, 11, '⚠ Treasury empty in ~11 months — upkeep exceeds tax income.'], // ceil case: 5001/500 = 10.002 -> 11
    [500, 1000, 1500, 1000, -500, 100, false, 1, '⚠ Treasury empty in ~1 month — upkeep exceeds tax income.'], // singular month: money exactly covers one deficit, so the next settlement still pays in full
    [50, 0, 200, 1000, -200, 100, false, 1, '⚠ Upkeep exceeds tax income — the next settlement goes unpaid and freezes growth.'], // money > 0 but below one month's deficit: the next settlement comes up short
    [12000, 0, 1000, 1000, -1000, 100, false, 12, '⚠ Treasury empty in ~12 months — upkeep exceeds tax income.'], // at the warning horizon
    [13000, 0, 1000, 1000, -1000, 100, false, 13, null], // beyond the warning horizon: runway still reported, no alarm
    [0, 700, 1000, 1000, -300, 100, false, 0, '⚠ Upkeep exceeds tax income — the next settlement goes unpaid and freezes growth.'], // zero-treasury deficit, still fully funded per-mille
    [0, 0, 0, 545, 0, 54, true, null, '⚠ Last month\'s upkeep went unpaid — growth frozen until a month is paid in full.'], // active shortfall, no deficit in play
    [100, 400, 500, 800, -100, 80, true, 1, '⚠ Last month\'s upkeep went unpaid — growth frozen until a month is paid in full.'], // shortfall wins over a computed runway of 1
    [1000, 1000, 800, 999, 200, 99, true, null, '⚠ Last month\'s upkeep went unpaid — growth frozen until a month is paid in full.'], // fundedPercent floors: 999/10 -> 99, still underfunded
    [1000, 1000, 800, 500, 200, 50, true, null, '⚠ Last month\'s upkeep went unpaid — growth frozen until a month is paid in full.'], // recovered net flow but freeze is live until the next settlement
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

// budgetStatus.ts keeps a local copy of the full-funding per-mille so the helper stays free of
// game/core imports; this pins the copy to the core constant.
describe('budgetStatus — full-funding constant', () => {
  it('reads exactly FUNDING_FULL_PER_MILLE as fully funded and one less as underfunded', () => {
    const base = { money: 0, monthlyIncome: 0, monthlyUpkeep: 0 };
    expect(budgetStatus({ ...base, serviceFundingPerMille: FUNDING_FULL_PER_MILLE }).underfunded).toBe(false);
    expect(budgetStatus({ ...base, serviceFundingPerMille: FUNDING_FULL_PER_MILLE - 1 }).underfunded).toBe(true);
  });
});
