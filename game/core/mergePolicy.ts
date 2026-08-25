import type { Building } from './Building';
import type { Rect } from './buildingFootprint';
import { lotBboxOf } from './buildingFootprint';
import type { DemandVector } from './Demand';
import { GROWTH_DEMAND_THRESHOLD } from './Demand';
import { GROWTH_COOLDOWN_INTERVALS, stagger, ZONE_MAX_LEVEL } from './growthConstants';
import { canExtendStructure, footprintCells, maxDensityForLot } from './zoneGrowth';

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
  // anchor), which the abandonment sweep already verified supports THIS level this same tick, so a
  // merge can no longer hand the next sweep a building it abandons despite its fresh age = 0.
  if (a.level < ZONE_MAX_LEVEL || b.level < ZONE_MAX_LEVEL) return false;

  // 5. Demand is positive
  if (demand[a.type] <= GROWTH_DEMAND_THRESHOLD) return false;

  // 6. Both past cooldown (including stagger)
  if (
    a.age < GROWTH_COOLDOWN_INTERVALS + stagger(a.id) ||
    b.age < GROWTH_COOLDOWN_INTERVALS + stagger(b.id)
  ) return false;

  // 7. Equal structureRect dimensions (both w and h). isStructureRectInLot pins every stored
  // Building's structureRect to the frontage edge and forces it to span the lot's full width
  // axis, so this one gate does two jobs. It closes the only degree of freedom the built-out
  // gates leave open — depth mismatch, since a deep lot is built out at the same structure
  // depth as a shallow one — which is what turns buildingCapacity(merged) ===
  // buildingCapacity(a) + buildingCapacity(b) into an exact integer invariant instead of a case
  // analysis. And it rejects mixed-width pairs: equal sr width means equal lot width, hence
  // equal maxDensityForLot, which with gate 8 below means equal density.
  if (
    a.structureRect.w !== b.structureRect.w ||
    a.structureRect.h !== b.structureRect.h
  ) return false;

  const aLot = lotBboxOf(a.footprint);
  const bLot = lotBboxOf(b.footprint);
  const frontage = a.frontage;

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
    // Both Math.max calls are degenerate on merge inputs: canMerge's max-level gate pins both
    // levels to ZONE_MAX_LEVEL, and equal sr dimensions force equal lot widths, hence equal
    // maxDensityForLot — which each side's density has to equal. Kept as-is for shape stability
    // rather than picking a side arbitrarily.
    level: Math.max(a.level, b.level),
    density: Math.max(a.density, b.density) as 0 | 1 | 2,
    age: 0,
    abandoned: false,
    frontage: a.frontage,
    structureRect: mergedSr,
  };
}
