import { describe, expect, it } from 'vitest';
import { laborStatus } from './laborStatus';

describe('laborStatus', () => {
  it.each([
    // employed, unemployed, jobsCapacity, rate, ratePercent, openings, warning
    [0, 0, 0, 0, 0, 0, null], // empty city, no NaN
    [0, 90, 0, 1, 100, 0, null], // workforce under the floor
    [90, 10, 100, 0.1, 10, 10, null], // rate under the threshold
    [850, 150, 900, 0.15, 15, 50, null], // healthy large city; employed/withoutJobs/jobsCapacity all differ, so a swap in the return literal cannot pass
    [80, 20, 80, 0.2, 20, 0, '⚠ Unemployment 20% — every job in the city is taken.'], // every-job-taken at 20% (proves >= on both constants at once)
    [0, 120, 0, 1, 100, 0, '⚠ Unemployment 100% — the city has no jobs at all.'], // no-jobs-at-all at 100%
    [230, 1030, 230, 1030 / 1260, 82, 0, '⚠ Unemployment 82% — every job in the city is taken.'], // every-job-taken at 82% (the playtest case)
    [10, 110, 300, 110 / 120, 92, 290, '⚠ Unemployment 92% — 290 openings exist, but the unemployed cannot reach them.'], // openings sentence naming 290 (job surplus with high unemployment) — the surplus case the label wording exists for
    [80, 20, 81, 0.2, 20, 1, '⚠ Unemployment 20% — 1 opening exists, but the unemployed cannot reach them.'], // singular opening (openings === 1) must not read "1 openings"
  ])(
    'employed=%i unemployed=%i jobsCapacity=%i → ratePercent=%i openings=%i',
    (employed, unemployed, jobsCapacity, rate, ratePercent, openings, warning) => {
      const result = laborStatus({ employed, unemployed, jobsCapacity });
      // Full-object assertion: catches a transposed return literal (e.g. withoutJobs: employed)
      // that a partial check on ratePercent/openings/warning alone would miss.
      expect(result).toEqual({
        workforce: employed + unemployed,
        employed,
        withoutJobs: unemployed,
        jobsCapacity,
        openings,
        rate,
        ratePercent,
        warning,
      });
    },
  );
});
