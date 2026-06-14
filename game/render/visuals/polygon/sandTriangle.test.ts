import { describe, it, expect } from 'vitest';
import { isSandTriangle } from './sandTriangle';

describe('isSandTriangle', () => {
  // Sand cases (true): exactly two sea corners, one land apex.
  // Varies the position of the land apex to exercise all three ternary arms.

  it('returns true when h0 is land and h1,h2 are sea (land apex at h0)', () => {
    // seaCorners: h0 arm = 0, h1 arm = 1, h2 arm = 1 → 2
    expect(isSandTriangle(1, 0, 0)).toBe(true);
  });

  it('returns true when h1 is land and h0,h2 are sea (land apex at h1)', () => {
    // seaCorners: h0 arm = 1, h1 arm = 0, h2 arm = 1 → 2
    expect(isSandTriangle(0, 1, 0)).toBe(true);
  });

  it('returns true when h2 is land and h0,h1 are sea (land apex at h2)', () => {
    // seaCorners: h0 arm = 1, h1 arm = 1, h2 arm = 0 → 2
    expect(isSandTriangle(0, 0, 1)).toBe(true);
  });

  it('returns true with a higher-relief land apex (two sea corners + steep apex)', () => {
    expect(isSandTriangle(0, 0, 8)).toBe(true);
  });

  // NOT sand (false): one sea corner — the key regression for the adjacent-corner bug.

  it('returns false when only one corner is at sea level (inland triangle regression)', () => {
    // ONE sea corner must NOT make the inland triangle sand.
    expect(isSandTriangle(0, 1, 1)).toBe(false);
  });

  it('returns false when all corners are above sea level (inland flat tile)', () => {
    expect(isSandTriangle(1, 1, 1)).toBe(false);
  });

  it('returns false when all three corners are at sea level (fully submerged)', () => {
    // Three sea corners → water, not sand.
    expect(isSandTriangle(0, 0, 0)).toBe(false);
  });

  it('returns false when all corners are above sea level with varied heights (inland slope)', () => {
    expect(isSandTriangle(2, 5, 8)).toBe(false);
  });

  // Split regression: for tile { topH:0, rightH:0, bottomH:1, leftH:1 }
  // DiamondTileVisual's TB split produces:
  //   tbWest = isSandTriangle(bottomH, leftH, topH)  = isSandTriangle(1, 1, 0)
  //   tbEast = isSandTriangle(bottomH, rightH, topH) = isSandTriangle(1, 0, 0)
  // Exactly ONE should be sand — the water-facing triangle — not both.

  it('tbWest [1,1,0]: one sea corner → inland triangle stays grass (split regression)', () => {
    // Inland triangle: only topH(=0) is at sea level → seaCorners === 1 → false
    expect(isSandTriangle(1, 1, 0)).toBe(false);
  });

  it('tbEast [1,0,0]: two sea corners → water-facing triangle is sand (split regression)', () => {
    // Shore-edge triangle: rightH(=0) and topH(=0) are sea → seaCorners === 2 → true
    expect(isSandTriangle(1, 0, 0)).toBe(true);
  });
});
