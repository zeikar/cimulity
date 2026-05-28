// Shared pure constants for growth + merge policy; kept dep-free so mergePolicy.ts can import without circling through World.ts.

export const GROWTH_COOLDOWN_INTERVALS = 8;

// Minimum depth-cap for a structure: even a 1-wide lot may grow its structure
// up to this many cells deep. Wider lots (after merge) raise the cap to match
// their width axis, so structures stay roughly square — see canExtendStructure.
export const MIN_STRUCTURE_DEPTH_CAP = 2;

export function stagger(id: number): number {
  return ((id ^ (id >>> 16)) * 2654435761 >>> 0) % 7;
}
