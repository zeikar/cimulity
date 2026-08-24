// Shared pure constants for growth + merge policy; kept dep-free so mergePolicy.ts (and
// other core modules that must not import World, e.g. laborMarket.ts) can import without
// circling through World.ts. Also carries the population-unit basis (POPULATION_PER_LEVEL).

export const GROWTH_COOLDOWN_INTERVALS = 8;

/** Maximum zone growth level a tile may reach. */
export const ZONE_MAX_LEVEL = 5;
/**
 * Land-value thresholds for level-up gating. Index 0 is reserved/unused —
 * level-0 building creation is unconditional. Indices 1–5 gate upgrade from
 * level (i-1) to level i.
 */
export const LEVEL_THRESHOLDS = [0, 0.1, 0.25, 0.45, 0.65, 0.85] as const;

// Minimum depth-cap for a structure: even a 1-wide lot may grow its structure
// up to this many cells deep. Wider lots (after merge) raise the cap to match
// their width axis, so structures stay roughly square — see canExtendStructure.
export const MIN_STRUCTURE_DEPTH_CAP = 2;

/**
 * Population contribution per zone level point — and the unit basis for
 * `WORKERS_PER_LEVEL` / `JOBS_PER_LEVEL` (laborMarket.ts) and, through them,
 * `TRAFFIC_CAPACITY` (trafficAssignment.ts). Changing it rescales every commute
 * volume in the sim, not just the number shown in the HUD.
 */
export const POPULATION_PER_LEVEL = 10;

/**
 * Population/workforce contribution per structure TILE per level — the unit
 * `buildingCapacity` (buildingCapacity.ts) multiplies by structure-rect area
 * and level. Half of `POPULATION_PER_LEVEL` because the modal unmerged
 * building's `structureRect` is exactly 2 tiles (`greedyDepthLot` only walks
 * the depth axis, so every unmerged lot is 1 wide; the depth cap floors at
 * `MIN_STRUCTURE_DEPTH_CAP = 2`): `2 tiles * level * 5 == level * 10`, so the
 * modal SETTLED building's capacity is numerically unchanged from the old
 * `level * POPULATION_PER_LEVEL` formula.
 */
export const POPULATION_PER_TILE_LEVEL = POPULATION_PER_LEVEL / 2;

export function stagger(id: number): number {
  return ((id ^ (id >>> 16)) * 2654435761 >>> 0) % 7;
}
