/**
 * Single pure capacity function every population/labor/overlay consumer sums
 * over. Capacity is derived from BUILT structure area, not the lot footprint,
 * so merging two lots into a bigger structure is capacity-conserving instead
 * of halving the total (the pre-existing defect this module fixes).
 *
 *   buildingCapacity(b) = structureRect.w * structureRect.h * level * DENSITY_CAPACITY_UNITS[density]
 *
 * Deliberately does NOT read `b.abandoned`: capacity is pure geometry.
 * Occupancy filtering already lives in every consumer (World.getPopulation,
 * World.recomputeHappiness, laborMarket.computeLaborMarket, Demand.recompute,
 * dataViewColors.buildingEmploymentShares — each skips abandoned buildings
 * before summing). Keeping the flag out of this function is what makes the
 * merge-conservation invariant (buildingCapacity(merged) ===
 * buildingCapacity(a) + buildingCapacity(b)) unconditional arithmetic rather
 * than a case analysis over `abandoned`.
 */

import type { Building } from './Building';
import { POPULATION_PER_TILE_LEVEL } from './growthConstants';

/**
 * Population/workforce units per structure tile per level, indexed by
 * density tier. All three entries equal `POPULATION_PER_TILE_LEVEL` for now —
 * density is capacity-neutral until a later task activates real per-tier
 * multipliers, so landing this module changes nothing except the
 * area-weighting itself.
 */
export const DENSITY_CAPACITY_UNITS: readonly [number, number, number] = [
  POPULATION_PER_TILE_LEVEL,
  POPULATION_PER_TILE_LEVEL,
  POPULATION_PER_TILE_LEVEL,
];

export function buildingCapacity(b: Building): number {
  return b.structureRect.w * b.structureRect.h * b.level * DENSITY_CAPACITY_UNITS[b.density];
}
