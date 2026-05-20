import { describe, it, expect } from 'vitest';
import { ZONE_MAX_LEVEL } from '@/game/core/World';
import {
  cubeLiftPx,
  CUBE_LIFT_BASE_MIN_PX,
  CUBE_LIFT_BASE_MAX_PX,
  CUBE_LIFT_DENSITY_MULT,
} from './cubeLift';

describe('cubeLiftPx', () => {
  it('returns 0 for level === 0', () => {
    expect(cubeLiftPx(0, 0)).toBe(0);
  });

  it('returns 0 for negative level', () => {
    expect(cubeLiftPx(-1, 0)).toBe(0);
  });

  it('pins the low end: cubeLiftPx(1, 0) === CUBE_LIFT_BASE_MIN_PX', () => {
    expect(cubeLiftPx(1, 0)).toBe(CUBE_LIFT_BASE_MIN_PX);
  });

  it('pins the high end at density 0: cubeLiftPx(ZONE_MAX_LEVEL, 0) === CUBE_LIFT_BASE_MAX_PX', () => {
    expect(cubeLiftPx(ZONE_MAX_LEVEL, 0)).toBe(CUBE_LIFT_BASE_MAX_PX);
  });

  it('is monotonic in level for each density', () => {
    for (const d of [0, 1, 2] as (0 | 1 | 2)[]) {
      for (let L = 1; L < ZONE_MAX_LEVEL; L++) {
        expect(cubeLiftPx(L + 1, d)).toBeGreaterThan(cubeLiftPx(L, d));
      }
    }
  });

  it('is monotonic in density at a fixed mid level', () => {
    const L = Math.floor(ZONE_MAX_LEVEL / 2);
    expect(cubeLiftPx(L, 0)).toBeLessThan(cubeLiftPx(L, 1));
    expect(cubeLiftPx(L, 1)).toBeLessThan(cubeLiftPx(L, 2));
  });

  it('has ease-out shape: first delta > last delta at density 0', () => {
    const firstDelta = cubeLiftPx(2, 0) - cubeLiftPx(1, 0);
    const lastDelta = cubeLiftPx(ZONE_MAX_LEVEL, 0) - cubeLiftPx(ZONE_MAX_LEVEL - 1, 0);
    expect(firstDelta).toBeGreaterThan(lastDelta);
  });

  it('applies density multiplier exactly at max level: density 2', () => {
    expect(cubeLiftPx(ZONE_MAX_LEVEL, 2)).toBe(Math.round(CUBE_LIFT_BASE_MAX_PX * 1.30));
  });

  it('clamps out-of-range levels to ZONE_MAX_LEVEL', () => {
    expect(cubeLiftPx(ZONE_MAX_LEVEL + 5, 0)).toBe(cubeLiftPx(ZONE_MAX_LEVEL, 0));
  });

  it('returns integer output for all (level, density) combinations', () => {
    for (const d of [0, 1, 2] as (0 | 1 | 2)[]) {
      for (let L = 1; L <= ZONE_MAX_LEVEL; L++) {
        expect(Number.isInteger(cubeLiftPx(L, d))).toBe(true);
      }
    }

    const t = (2 - 1) / (ZONE_MAX_LEVEL - 1);
    const eased = 1 - (1 - t) ** 2;
    const base = CUBE_LIFT_BASE_MIN_PX + (CUBE_LIFT_BASE_MAX_PX - CUBE_LIFT_BASE_MIN_PX) * eased;
    expect(base * CUBE_LIFT_DENSITY_MULT[1]).not.toBe(Math.round(base * CUBE_LIFT_DENSITY_MULT[1]));
    expect(cubeLiftPx(2, 1)).toBe(Math.round(base * CUBE_LIFT_DENSITY_MULT[1]));
  });
});
