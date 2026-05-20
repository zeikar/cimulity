import { describe, it, expect } from 'vitest';
import {
  cubeTypeHeightPx,
  cubeTypeInsetRatio,
  CUBE_TYPE_INSET_RATIO,
} from './cubeTypeRatios';

describe('cubeTypeRatios', () => {
  it('cubeTypeHeightPx returns 0 for basePx === 0 across all types', () => {
    expect(cubeTypeHeightPx(0, 'residential')).toBe(0);
    expect(cubeTypeHeightPx(0, 'commercial')).toBe(0);
    expect(cubeTypeHeightPx(0, 'industrial')).toBe(0);
  });

  it('cubeTypeHeightPx returns 0 for negative basePx', () => {
    expect(cubeTypeHeightPx(-5, 'residential')).toBe(0);
  });

  it('cubeTypeHeightPx pins residential to identity: cubeTypeHeightPx(100, residential) === 100', () => {
    expect(cubeTypeHeightPx(100, 'residential')).toBe(100);
  });

  it('respects type ordering at representative base: commercial > residential > industrial at basePx = 100', () => {
    const res = cubeTypeHeightPx(100, 'residential');
    const com = cubeTypeHeightPx(100, 'commercial');
    const ind = cubeTypeHeightPx(100, 'industrial');
    expect(com).toBeGreaterThan(res);
    expect(res).toBeGreaterThan(ind);
  });

  it('hits exact numeric pins at basePx = 100: commercial → 135, industrial → 60', () => {
    expect(cubeTypeHeightPx(100, 'commercial')).toBe(135);
    expect(cubeTypeHeightPx(100, 'industrial')).toBe(60);
  });

  it('returns integers across a small sweep of basePx values', () => {
    const basePxValues = [1, 10, 33, 64];
    for (const basePx of basePxValues) {
      expect(Number.isInteger(cubeTypeHeightPx(basePx, 'residential'))).toBe(true);
      expect(Number.isInteger(cubeTypeHeightPx(basePx, 'commercial'))).toBe(true);
      expect(Number.isInteger(cubeTypeHeightPx(basePx, 'industrial'))).toBe(true);
    }
  });

  it('cubeTypeInsetRatio gives residential and industrial the same small inset for breathing room', () => {
    expect(cubeTypeInsetRatio('residential')).toBe(cubeTypeInsetRatio('industrial'));
    expect(cubeTypeInsetRatio('residential')).toBeGreaterThan(0);
  });

  it('cubeTypeInsetRatio insets commercial more than residential/industrial', () => {
    expect(cubeTypeInsetRatio('commercial')).toBeGreaterThan(cubeTypeInsetRatio('residential'));
    expect(cubeTypeInsetRatio('commercial')).toBeGreaterThan(cubeTypeInsetRatio('industrial'));
  });

  it('all CUBE_TYPE_INSET_RATIO values satisfy domain invariant >= 0 and < 0.5', () => {
    for (const type of ['residential', 'commercial', 'industrial'] as const) {
      const ratio = CUBE_TYPE_INSET_RATIO[type];
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThan(0.5);
    }
  });
});
