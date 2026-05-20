// Pure lift-height mapping — separate module so the coverage gate can include it without pulling in Pixi.

import { ZONE_MAX_LEVEL } from '@/game/core/World';

export const CUBE_LIFT_BASE_MIN_PX = 10;
export const CUBE_LIFT_BASE_MAX_PX = 64;
export const CUBE_LIFT_DENSITY_MULT: readonly [number, number, number] = [1.0, 1.15, 1.30];

export function cubeLiftPx(level: number, density: 0 | 1 | 2): number {
  if (level <= 0) return 0;

  const clampedLevel = Math.min(level, ZONE_MAX_LEVEL);
  const t = (clampedLevel - 1) / (ZONE_MAX_LEVEL - 1);
  const eased = 1 - (1 - t) ** 2;
  const base = CUBE_LIFT_BASE_MIN_PX + (CUBE_LIFT_BASE_MAX_PX - CUBE_LIFT_BASE_MIN_PX) * eased;

  return Math.round(base * CUBE_LIFT_DENSITY_MULT[density]);
}
