import type { Building } from './Building';
import type { Rect } from './buildingFootprint';
import { lotBboxOf } from './buildingFootprint';
import type { DemandVector } from './Demand';
import { GROWTH_DEMAND_THRESHOLD } from './Demand';
import { GROWTH_COOLDOWN_INTERVALS, stagger, ZONE_MAX_LEVEL } from './growthConstants';
import { canExtendStructure, footprintCells, maxDensityForLot, structureDepth } from './zoneGrowth';

// Lot consolidation is the LAST redevelopment rung, not a response to a demand spike: a pair
// merges only once BOTH parcels are BUILT OUT — at ZONE_MAX_LEVEL (gate 4), at the density tier
// their own lot width allows (gate 8), and with structures that can no longer extend (gate 9).
// Those three gates sit apart below because the cheap scalar checks run first; together they are
// the rung. Growing in place is therefore always preferred over assembling land, and demand only
// has to be positive, because a parcel that has exhausted every cheaper way to grow has nothing
// left to answer demand with. The previous spike gate keyed the rung on DENSITY_DEMAND_THRESHOLD
// instead, which froze built-out parcels in any city whose demand sat at the external floor.
//
// No `abandoned` gate here by design: capacity is occupancy-independent (buildingCapacity
// never reads the flag), so the merge caller is what has to keep a derelict building out of
// the pool — and it already does. World.ts's abandonment sweep adds every building abandoned
// at sweep entry to `frozenThisTick`, and the merge loop skips frozen buildings before ever
// calling canMerge. A derelict pair therefore never reaches this function.
export function canMerge(
  a: Building,
  b: Building,
  demand: DemandVector,
): boolean {
  // 1. Must be different buildings
  if (a.id === b.id) return false;

  // 2. Same zone type
  if (a.type !== b.type) return false;

  // 3. Same frontage direction
  if (a.frontage !== b.frontage) return false;

  // 4. Both built out on the level axis. Nothing in the sim carries a level past ZONE_MAX_LEVEL:
  // World.tick's level-up branch only increments while `existing.level < ZONE_MAX_LEVEL`, and save
  // load rejects any stored level above it (mapSerialization.ts). Both sides at that ceiling are
  // therefore also EQUAL in level — which closes the NW-anchor defect: the merged
  // building's anchor is always one of the two original anchors (union NW = the NW-most lot's
  // anchor), which the abandonment sweep already verified supports THIS level this same tick,
  // so a merge can no longer hand the next sweep a building it abandons despite its fresh
  // age = 0. Still true now that the sweep reads the congestion-free land value (World.tick),
  // since the next sweep reads that same value.
  if (a.level < ZONE_MAX_LEVEL || b.level < ZONE_MAX_LEVEL) return false;

  // 5. Demand is positive
  if (demand[a.type] <= GROWTH_DEMAND_THRESHOLD) return false;

  // 6. Both past cooldown (including stagger)
  if (
    a.age < GROWTH_COOLDOWN_INTERVALS + stagger(a.id) ||
    b.age < GROWTH_COOLDOWN_INTERVALS + stagger(b.id)
  ) return false;

  const frontage = a.frontage;

  // 7. Equal structureRect DEPTH — the axis isStructureRectInLot does NOT pin. That predicate
  // fixes each structure to its lot's frontage edge and forces it to span the lot's full width
  // axis (N/S: sr.w === lot.w, so depth is sr.h; W/E: sr.h === lot.h, so depth is sr.w), which
  // leaves depth as the one degree of freedom the built-out gates still allow — a deep lot is
  // built out at the same structure depth as a shallow one. Equal depth is what keeps the
  // structureRect union EXACT: the frontage-edge alignment gate below, plus that same pinning,
  // already give both sides the same origin on the depth axis, so two width-axis-adjacent rects
  // of shared depth d union to exactly (wa + wb) x d — area in, area out, no swallowed empty
  // cells. Unequal depths would union to a rect larger than the two inputs combined. (The
  // separate equal-lot-depth gate below is what keeps the LOT union exact, not this one.)
  //
  // The WIDTH axis is deliberately left free. Forcing equal widths too made width 3 structurally
  // unreachable (widths could only double: 1 -> 2 -> 4) and stranded every narrow parcel whose
  // run length was not a power of two. The cost is that equal density is NO LONGER implied: a
  // mixed-width pair can be built out at different tiers (a 1-wide lot caps at 1, a >=2-wide one
  // at 2 — so 1+2 differs while 2+3 does not), and mergedBuildingShape takes the max.
  //
  // Freeing the width axis does NOT, however, free every mixed-width pair in natural play,
  // because structureDepthCap is itself width-keyed: max(MIN_STRUCTURE_DEPTH_CAP, lot width).
  // On a lot deeper than 2 a grown 1-wide parcel stops at structure depth 2 while a grown
  // 3-wide stops at 3, and this gate then rejects them. What actually merges after growth is
  // therefore 1+2 (shared cap 2) at any lot depth, plus any pair on lots at most 2 deep (where
  // both structures fill the lot). Widening that further means changing the depth cap, not this
  // gate — mergePolicy.test.ts pins the gap as a documented rejection.
  const aSrDepth = structureDepth(a.structureRect, frontage);
  const bSrDepth = structureDepth(b.structureRect, frontage);
  if (aSrDepth !== bSrDepth) return false;

  const aLot = lotBboxOf(a.footprint);
  const bLot = lotBboxOf(b.footprint);

  // 8. Both at the density tier their own lot width allows — the same cap World.tick's
  // density-bump branch stops at, so a parcel reaches this gate only once that branch is spent.
  if (
    a.density !== maxDensityForLot(aLot, frontage) ||
    b.density !== maxDensityForLot(bLot, frontage)
  ) return false;

  // 9. Both out of room to extend — same predicate as World.tick's structure-grow branch.
  if (
    canExtendStructure(a.structureRect, aLot, frontage) ||
    canExtendStructure(b.structureRect, bLot, frontage)
  ) return false;

  // 10. Geometry checks

  // Equal lot depth on the depth axis
  if (frontage === 'N' || frontage === 'S') {
    if (aLot.h !== bLot.h) return false;
  } else {
    // 'W' | 'E'
    if (aLot.w !== bLot.w) return false;
  }

  // Width-axis adjacency (lots touch edge-to-edge)
  if (frontage === 'N' || frontage === 'S') {
    const adjacent =
      aLot.x + aLot.w === bLot.x ||
      bLot.x + bLot.w === aLot.x;
    if (!adjacent) return false;
  } else {
    const adjacent =
      aLot.y + aLot.h === bLot.y ||
      bLot.y + bLot.h === aLot.y;
    if (!adjacent) return false;
  }

  // Frontage-edge alignment (lots' road-facing edges form one line)
  if (frontage === 'N') {
    if (aLot.y !== bLot.y) return false;
  } else if (frontage === 'S') {
    if (aLot.y + aLot.h !== bLot.y + bLot.h) return false;
  } else if (frontage === 'W') {
    if (aLot.x !== bLot.x) return false;
  } else {
    // 'E'
    if (aLot.x + aLot.w !== bLot.x + bLot.w) return false;
  }

  // Merged-lot max-size cap
  const mergedW = (frontage === 'N' || frontage === 'S') ? aLot.w + bLot.w : aLot.w;
  const mergedH = (frontage === 'W' || frontage === 'E') ? aLot.h + bLot.h : aLot.h;
  if (mergedW > 4 || mergedH > 4) return false;

  return true;
}

export function mergedBuildingShape(a: Building, b: Building): Omit<Building, 'id'> {
  const aLot = lotBboxOf(a.footprint);
  const bLot = lotBboxOf(b.footprint);

  // Bbox union of the two lots
  const lotX = Math.min(aLot.x, bLot.x);
  const lotY = Math.min(aLot.y, bLot.y);
  const mergedLot: Rect = {
    x: lotX,
    y: lotY,
    w: Math.max(aLot.x + aLot.w, bLot.x + bLot.w) - lotX,
    h: Math.max(aLot.y + aLot.h, bLot.y + bLot.h) - lotY,
  };

  // Bbox union of the two structureRects
  const aSr = a.structureRect;
  const bSr = b.structureRect;
  const srX = Math.min(aSr.x, bSr.x);
  const srY = Math.min(aSr.y, bSr.y);
  const mergedSr: Rect = {
    x: srX,
    y: srY,
    w: Math.max(aSr.x + aSr.w, bSr.x + bSr.w) - srX,
    h: Math.max(aSr.y + aSr.h, bSr.y + bSr.h) - srY,
  };

  return {
    type: a.type,
    footprint: footprintCells(mergedLot),
    anchor: { x: mergedLot.x, y: mergedLot.y },
    // The level max is degenerate on merge inputs — canMerge's max-level gate (4) pins both
    // levels to ZONE_MAX_LEVEL — and is kept for shape stability rather than picking a side
    // arbitrarily. The density max does real work now that the shape gate frees the width axis:
    // a mixed-width pair arrives at different tiers (1-wide lot caps at tier 1, >=2-wide at 2),
    // and the max upgrades the narrow side to the tier the assembled lot supports. It can never
    // overshoot that lot's own cap — a merged lot is at least 2 wide along the frontage axis, so
    // maxDensityForLot(mergedLot) is 2, and neither input can exceed 2. Note the asymmetry this
    // creates: an EQUAL-width pair inherits its shared (lower) tier and has to wait out
    // DENSITY_COOLDOWN_INTERVALS in World.tick's density branch before it reaches the assembled
    // lot's cap (World.merge.test.ts's 1+1 -> 2-wide case), whereas a mixed-width pair carrying
    // a tier-2 side arrives at that cap the instant the merge fires.
    level: Math.max(a.level, b.level),
    density: Math.max(a.density, b.density) as 0 | 1 | 2,
    age: 0,
    abandoned: false,
    frontage: a.frontage,
    structureRect: mergedSr,
  };
}
