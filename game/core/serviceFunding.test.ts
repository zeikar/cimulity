import { describe, it, expect } from 'vitest';
import { fundingPerMille, isValidFundingPerMille, FUNDING_FULL_PER_MILLE } from './serviceFunding';

describe('fundingPerMille', () => {
  it('zero due → fully funded', () => {
    expect(fundingPerMille(0, 0)).toBe(1000);
  });

  it('exact payment → fully funded', () => {
    expect(fundingPerMille(200, 200)).toBe(1000);
  });

  it('half payment → 500 per mille', () => {
    expect(fundingPerMille(100, 200)).toBe(500);
  });

  it('zero payment → 0 per mille', () => {
    expect(fundingPerMille(0, 372)).toBe(0);
  });

  it('floor rounding — 1 paid of 3 due → 333', () => {
    expect(fundingPerMille(1, 3)).toBe(333);
  });

  it('floor rounding — 2999 paid of 3000 due → 999 (never rounds up to 1000)', () => {
    expect(fundingPerMille(2999, 3000)).toBe(999);
  });

  it('result always integer in [0, 1000]', () => {
    const testCases = [
      [0, 1],
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 5],
      [999, 1000],
      [1000, 1000],
      [500, 1000],
    ];
    testCases.forEach(([paid, due]) => {
      const result = fundingPerMille(paid, due);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1000);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  it('any unpaid unit reads below FUNDING_FULL_PER_MILLE', () => {
    const testDues = [1, 10, 100, 372, 1000, 10000];
    testDues.forEach((due) => {
      const shortfallResult = fundingPerMille(due - 1, due);
      expect(shortfallResult).toBeLessThan(FUNDING_FULL_PER_MILLE);
    });
  });
});

describe('isValidFundingPerMille', () => {
  it('accepts 0', () => {
    expect(isValidFundingPerMille(0)).toBe(true);
  });

  it('accepts 1000', () => {
    expect(isValidFundingPerMille(1000)).toBe(true);
  });

  it('accepts 500', () => {
    expect(isValidFundingPerMille(500)).toBe(true);
  });

  it('rejects −1', () => {
    expect(isValidFundingPerMille(-1)).toBe(false);
  });

  it('rejects 1001', () => {
    expect(isValidFundingPerMille(1001)).toBe(false);
  });

  it('rejects 12.5 (not integer)', () => {
    expect(isValidFundingPerMille(12.5)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isValidFundingPerMille(NaN)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(isValidFundingPerMille(Infinity)).toBe(false);
  });
});
