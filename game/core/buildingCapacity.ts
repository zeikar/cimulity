/**
 * Single pure capacity function every population/labor/overlay consumer sums
 * over. Capacity is derived from BUILT structure area, not the lot footprint,
 * so merging two lots into a bigger structure never halves the total (the
 * pre-existing defect this module fixes). Conservation is EXACT only when the
 * two sides share a density tier; a mixed-tier merge revalues the narrow
 * side's area at the max tier, so merged capacity is `>=` the input sum.
 *
 *   buildingCapacity(b) = structureRect.w * structureRect.h * level * DENSITY_CAPACITY_UNITS[density]
 *
 * Deliberately does NOT read `b.abandoned`: capacity is pure geometry.
 * Occupancy filtering already lives in every consumer (World.getPopulation,
 * World.recomputeHappiness, laborMarket.computeLaborMarket, Demand.recompute,
 * dataViewColors.buildingEmploymentShares — each skips abandoned buildings
 * before summing). Keeping the flag out of this function is what makes the
 * merge-conservation invariant (buildingCapacity(merged) >=
 * buildingCapacity(a) + buildingCapacity(b), with equality iff the two
 * densities match) plain arithmetic over geometry rather than a case analysis
 * over `abandoned`.
 */

import type { Building } from './Building';

/**
 * Population/workforce units per structure tile per level, indexed by
 * density tier: ~1x / 1.4x / 2x. Entries are integer literals, not a
 * computed `unit * multiplier`, because odd structure areas are reachable —
 * a depth-1 ribbon lot (structureRect 1x1, can never extend) would read a
 * fractional capacity under a 1.5x tier (37.5 at level 5), and flooring per
 * building would break exact merge conservation
 * (floor(22.5) + floor(22.5) = 44 !== floor(45)). Integer units make every
 * capacity an integer by construction. Entry 0 equals
 * POPULATION_PER_TILE_LEVEL and entry 2 equals POPULATION_PER_LEVEL
 * (pinned in buildingCapacity.test.ts, not re-derived here to avoid float
 * arithmetic in the exported constant).
 */
export const DENSITY_CAPACITY_UNITS: readonly [number, number, number] = [5, 7, 10];

export function buildingCapacity(b: Building): number {
  return b.structureRect.w * b.structureRect.h * b.level * DENSITY_CAPACITY_UNITS[b.density];
}
