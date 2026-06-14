import { SEA_LEVEL } from '@/game/core/Terrain';

/**
 * Is ONE terrain triangle a coastal SAND triangle? Pure, height-only.
 *
 * True iff the triangle CONTAINS A WATERLINE EDGE: exactly two of its three
 * corners sit at SEA_LEVEL (the submerged shore edge) and the third is on land
 * above (> SEA_LEVEL). One shared sea-level corner is NOT enough — otherwise
 * the TB split (which shares top & bottom corners) and the LR split (which
 * shares left & right corners) would paint BOTH triangles of a coastal tile as
 * sand. With the exact-two rule only the water-facing triangle (which owns the
 * full shore edge) is sand; the inland triangle (which only touches the
 * waterline at a single shared corner) stays grass.
 *
 * Current Terrain APIs never produce a corner below SEA_LEVEL, so "exactly two
 * corners at SEA_LEVEL" implies the third is land (> SEA_LEVEL). A
 * fully-submerged triangle has three sea corners and returns false — water stays
 * owned by `cornersRenderAsWater`, this predicate never re-decides water.
 * Inland triangles (all corners > SEA_LEVEL) also return false.
 *
 * The tile-TYPE gate (sand only on grass tiles) lives once at the
 * DiamondTileVisual call site, not here.
 *
 * Takes the 3 corner heights as scalars (a triangle always has exactly 3).
 * Heights are non-negative integers in [SEA_LEVEL, MAX_ELEVATION].
 */
export function isSandTriangle(h0: number, h1: number, h2: number): boolean {
  // A beach triangle CONTAINS a water-line EDGE: exactly two of its three
  // corners sit at SEA_LEVEL (the submerged shore edge) and the third is on
  // land above. One shared sea-level corner is NOT enough — otherwise the TB
  // split (which shares top & bottom) and the LR split (shares left & right)
  // would paint BOTH triangles of a coastal tile as sand. Current Terrain APIs
  // never produce a corner below SEA_LEVEL, so "exactly two at SEA_LEVEL" implies
  // the third is land (> SEA_LEVEL); a fully-submerged triangle has three sea
  // corners and stays water (owned by cornersRenderAsWater, checked first).
  const seaCorners =
    (h0 === SEA_LEVEL ? 1 : 0) +
    (h1 === SEA_LEVEL ? 1 : 0) +
    (h2 === SEA_LEVEL ? 1 : 0);
  return seaCorners === 2;
}
