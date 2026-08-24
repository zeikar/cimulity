import type { Building } from './Building';
import type { Rect } from './buildingFootprint';
import { lotBboxOf } from './buildingFootprint';
import type { DemandVector } from './Demand';
import { DENSITY_DEMAND_THRESHOLD } from './Demand';
import { GROWTH_COOLDOWN_INTERVALS, stagger } from './growthConstants';
import { footprintCells } from './zoneGrowth';

export const MERGE_LEVEL_THRESHOLD = 2;

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

  // 4. Both at or above merge level threshold
  if (a.level < MERGE_LEVEL_THRESHOLD || b.level < MERGE_LEVEL_THRESHOLD) return false;

  // 5. Demand is high enough
  if (demand[a.type] < DENSITY_DEMAND_THRESHOLD) return false;

  // 6. Both past cooldown (including stagger)
  if (
    a.age < GROWTH_COOLDOWN_INTERVALS + stagger(a.id) ||
    b.age < GROWTH_COOLDOWN_INTERVALS + stagger(b.id)
  ) return false;

  // 7. Equal level — also closes the NW-anchor defect: the merged building's anchor is
  // always one of the two original anchors (union NW = the NW-most lot's anchor), which
  // the abandonment sweep already verified supports THIS level this same tick, so a merge
  // can no longer hand the next sweep a building it abandons despite its fresh age = 0.
  if (a.level !== b.level) return false;

  // 8. Equal density tier.
  if (a.density !== b.density) return false;

  // 9. Equal structureRect dimensions (both w and h). isStructureRectInLot pins every
  // stored Building's structureRect to the frontage edge and forces it to span the lot's
  // full width axis, so the depth-equal, edge-aligned, width-adjacent lots checked below
  // already give the two structureRects a shared depth-axis origin — no separate
  // depth-origin or sr-adjacency check is needed here. Equal dimensions closes the only
  // remaining degree of freedom (depth mismatch), which is what turns
  // buildingCapacity(merged) === buildingCapacity(a) + buildingCapacity(b) into an exact
  // integer invariant instead of a case analysis.
  if (
    a.structureRect.w !== b.structureRect.w ||
    a.structureRect.h !== b.structureRect.h
  ) return false;

  // 10. Geometry checks
  const aLot = lotBboxOf(a.footprint);
  const bLot = lotBboxOf(b.footprint);
  const frontage = a.frontage;

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
    // canMerge now guarantees a.level === b.level and a.density === b.density, so both
    // Math.max calls are degenerate; kept as-is for shape stability rather than picking
    // a side arbitrarily.
    level: Math.max(a.level, b.level),
    density: Math.max(a.density, b.density) as 0 | 1 | 2,
    age: 0,
    abandoned: false,
    frontage: a.frontage,
    structureRect: mergedSr,
  };
}
