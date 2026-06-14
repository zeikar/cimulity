import { SEA_LEVEL } from '@/game/core/Terrain';

/**
 * Terrain at or below the waterline (SEA_LEVEL) is water; from there UP TO this
 * height renders as beach SAND, and above it as grass. Keying the beach on a
 * HEIGHT contour — not on which corners touch the waterline — makes the sand /
 * grass boundary a constant-height line, which on a slope runs PARALLEL to the
 * coast (a contour line). Tunable: "roughly half a step above the water".
 */
export const SAND_MAX_HEIGHT = SEA_LEVEL + 0.5;

/**
 * Does the tile meet the water along an EDGE — an edge whose BOTH corners sit at
 * SEA_LEVEL (a fully submerged shoreline edge)? Pure. Gates the beach at the tile
 * level: only tiles with a real submerged edge get sand. A tile that touches the
 * waterline at a single CORNER (point contact, no submerged edge) is NOT a beach
 * and stays grass, even though that corner dips below the height threshold —
 * without this gate, point-contact tiles would sprout a stray sand wedge around
 * the lone low corner. Tiles that DO qualify still draw the full height contour
 * on BOTH triangles, so the one-sea-corner sibling triangle keeps the beach
 * continuous around the shared corner.
 */
export function tileHasShorelineEdge(
  topH: number,
  rightH: number,
  bottomH: number,
  leftH: number,
): boolean {
  const top = topH === SEA_LEVEL;
  const right = rightH === SEA_LEVEL;
  const bottom = bottomH === SEA_LEVEL;
  const left = leftH === SEA_LEVEL;
  return (top && right) || (right && bottom) || (bottom && left) || (left && top);
}

/**
 * One vertex of the clipped sand sub-polygon: either an original triangle CORNER
 * `i`, or a point on the EDGE between corners `a` and `b` at parameter `t`
 * (0 at a, 1 at b) where the height contour crosses.
 */
export type SandVertex =
  | { readonly kind: 'corner'; readonly i: 0 | 1 | 2 }
  | { readonly kind: 'edge'; readonly a: 0 | 1 | 2; readonly b: 0 | 1 | 2; readonly t: number };

/**
 * Clip ONE terrain triangle at the height contour `threshold`, returning the
 * sub-polygon whose height is strictly BELOW it (the beach), in boundary order.
 * Heights vary linearly across a triangle, so the contour is a straight line and
 * the returned polygon's cut edge is parallel to the local slope contour.
 *
 * Returns `[]` when no corner is below (all grass); the three corners when all
 * are below (the whole triangle is sand); a 3-vertex polygon when exactly one
 * corner is below; a 4-vertex polygon when exactly two are. The caller maps each
 * `SandVertex` to a screen point + UV and fills it with the sand texture. The
 * caller also skips WATER triangles, so a fully-submerged triangle never reaches
 * here — that is what keeps sand off water tiles.
 *
 * `cross(a,b)` is only ever called with `h[a] < threshold <= h[b]`, so the
 * denominator `h[b] - h[a]` is strictly positive (no divide-by-zero).
 */
export function sandBelowContour(
  h0: number,
  h1: number,
  h2: number,
  threshold: number,
): SandVertex[] {
  const h = [h0, h1, h2] as const;
  const below = [h0 < threshold, h1 < threshold, h2 < threshold] as const;
  const count = (below[0] ? 1 : 0) + (below[1] ? 1 : 0) + (below[2] ? 1 : 0);

  if (count === 0) return [];
  if (count === 3) {
    return [
      { kind: 'corner', i: 0 },
      { kind: 'corner', i: 1 },
      { kind: 'corner', i: 2 },
    ];
  }

  const cross = (a: 0 | 1 | 2, b: 0 | 1 | 2): SandVertex => ({
    kind: 'edge',
    a,
    b,
    t: (threshold - h[a]) / (h[b] - h[a]),
  });

  if (count === 1) {
    // A single below-corner → a small sand wedge at that corner. This is
    // INTENTIONAL under the height-contour model (anything below the threshold is
    // beach). That corner sits at/near the waterline, and on the classic
    // two-sea-corner coastal tile it is the corner SHARED with the neighbouring
    // triangle's full band, so the wedge keeps the beach CONTINUOUS around the
    // corner instead of leaving a grass notch. This deliberately differs from the
    // retired per-triangle "exactly two sea corners" rule, which left such
    // triangles grass and notched the coast.
    const k: 0 | 1 | 2 = below[0] ? 0 : below[1] ? 1 : 2;
    const n: 0 | 1 | 2 = ((k + 1) % 3) as 0 | 1 | 2;
    const p: 0 | 1 | 2 = ((k + 2) % 3) as 0 | 1 | 2;
    return [{ kind: 'corner', i: k }, cross(k, n), cross(k, p)];
  }

  // count === 2: one corner above (m); quad of the two below corners + 2 crossings.
  const m: 0 | 1 | 2 = !below[0] ? 0 : !below[1] ? 1 : 2;
  const n: 0 | 1 | 2 = ((m + 1) % 3) as 0 | 1 | 2;
  const p: 0 | 1 | 2 = ((m + 2) % 3) as 0 | 1 | 2;
  return [{ kind: 'corner', i: n }, { kind: 'corner', i: p }, cross(p, m), cross(n, m)];
}
