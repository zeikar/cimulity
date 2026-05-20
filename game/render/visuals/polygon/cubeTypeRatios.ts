// Pure type → silhouette ratio mapping — separate module so the coverage gate can include it without pulling in Pixi.

import type { BuildingType } from '@/game/core/Building';

export const CUBE_TYPE_HEIGHT_MULT: Readonly<Record<BuildingType, number>> = {
  residential: 1.0,
  commercial: 1.35,
  industrial: 0.6,
};

// Domain: 0 <= inset < 0.5. Rendered span is spanX * (1 - 2 * inset), so 0 = full width, 0.5 = collapsed to a vertical line.
export const CUBE_TYPE_INSET_RATIO: Readonly<Record<BuildingType, number>> = {
  residential: 0.0,
  commercial: 0.25,
  industrial: 0.0,
};

export function cubeTypeHeightPx(basePx: number, type: BuildingType): number {
  if (basePx <= 0) return 0;
  return Math.round(basePx * CUBE_TYPE_HEIGHT_MULT[type]);
}

export function cubeTypeInsetRatio(type: BuildingType): number {
  return CUBE_TYPE_INSET_RATIO[type];
}
