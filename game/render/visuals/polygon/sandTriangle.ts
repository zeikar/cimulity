import { SEA_LEVEL } from '@/game/core/Terrain';

/**
 * Is ONE terrain triangle a coastal SAND triangle? Pure, height-only.
 *
 * True iff the triangle TOUCHES the waterline (>=1 corner == SEA_LEVEL) AND is
 * PARTLY LAND (>=1 corner > SEA_LEVEL). Fully-submerged triangles (all corners
 * <= SEA_LEVEL) return false — water stays owned by `cornersRenderAsWater`, this
 * predicate never re-decides water. Inland triangles (all corners > SEA_LEVEL)
 * return false → existing grass/land path.
 *
 * Keying on `corner === SEA_LEVEL` (not a height band) is deliberate: coastal
 * land tiles drop only their water-side corners to SEA_LEVEL, so the
 * water-facing triangle is sand while the inland triangle of the same tile stays
 * grass; interior plains sit at MIN_LAND_ELEVATION (a step above sea level) so no
 * corner touches SEA_LEVEL and they are not sand. The tile-TYPE gate (sand only
 * on grass tiles) lives once at the DiamondTileVisual call site, not here.
 *
 * Takes the 3 corner heights as scalars (a triangle always has exactly 3).
 * Heights are non-negative integers in [SEA_LEVEL, MAX_ELEVATION]; current
 * Terrain APIs never produce a corner below SEA_LEVEL.
 */
export function isSandTriangle(h0: number, h1: number, h2: number): boolean {
  const touchesWaterline = h0 === SEA_LEVEL || h1 === SEA_LEVEL || h2 === SEA_LEVEL;
  const partlyLand = h0 > SEA_LEVEL || h1 > SEA_LEVEL || h2 > SEA_LEVEL;
  return touchesWaterline && partlyLand;
}
