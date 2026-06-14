import { describe, it, expect } from 'vitest';
import { isSandTriangle } from './sandTriangle';

describe('isSandTriangle', () => {
  // Sand cases (true): triangle touches waterline AND has at least one land corner.

  it('returns true when h0 is at sea level and others are land (h0 arm)', () => {
    expect(isSandTriangle(0, 1, 1)).toBe(true);
  });

  it('returns true when h1 is at sea level and others are land (h1 arm)', () => {
    // Exercises the second || arm of touchesWaterline.
    expect(isSandTriangle(1, 0, 1)).toBe(true);
  });

  it('returns true when h2 is at sea level and others are land (h2 arm)', () => {
    // Exercises the third || arm of touchesWaterline.
    expect(isSandTriangle(1, 1, 0)).toBe(true);
  });

  it('returns true when two corners are at sea level and h2 is land', () => {
    // (0,0,1): touchesWaterline satisfied at h0; partlyLand satisfied at h2.
    // This covers the third || arm of partlyLand (h2 > SEA_LEVEL) being the
    // only true branch — otherwise that arm is short-circuited by h0 or h1.
    expect(isSandTriangle(0, 0, 1)).toBe(true);
  });

  it('returns true with one sea corner and higher-relief land corners', () => {
    // Regression: steep coastal slope still reads as sand.
    expect(isSandTriangle(0, 8, 8)).toBe(true);
  });

  // Fully-submerged cases (false): water owns these, not sand.

  it('returns false when all corners are at sea level (fully submerged)', () => {
    // All-equal-sea boundary; every partlyLand > arm evaluates to false.
    expect(isSandTriangle(0, 0, 0)).toBe(false);
  });

  // Inland cases (false): no corner touches the waterline.

  it('returns false when all corners are at MIN_LAND_ELEVATION (inland flat tile)', () => {
    // Regression: interior plains at elevation 1 must not render as sand.
    // All touchesWaterline === arms evaluate to false.
    expect(isSandTriangle(1, 1, 1)).toBe(false);
  });

  it('returns false when all corners are above sea level with varied heights (inland slope)', () => {
    expect(isSandTriangle(2, 5, 8)).toBe(false);
  });
});
