import { SEA_LEVEL } from '@/game/core/Terrain';

/**
 * Terrain at or below the waterline (SEA_LEVEL) is water; from there UP TO this
 * height renders as beach SAND. Keying the beach on a HEIGHT contour makes the
 * sand/grass boundary a constant-height line, which on a slope runs PARALLEL to
 * the coast. Tunable: "roughly half a step above the water".
 */
export const SAND_MAX_HEIGHT = SEA_LEVEL + 0.5;

/**
 * Land at or ABOVE this height renders as rocky highland ROCK (the high-elevation
 * counterpart to SAND). Same contour idea, mirrored: the rock/grass boundary is a
 * constant-height line parallel to the slope. Tunable — the procedural generator
 * is biased low (most land sits at 1–3, peaks rarely exceed ~4), so this is set
 * to catch the higher ground rather than only the very tip.
 */
export const ROCK_MIN_HEIGHT = 2.5;

/** Which side of a height contour to keep. */
export type ContourSide = 'below' | 'above';

/**
 * One vertex of the clipped sub-polygon: either an original triangle CORNER `i`,
 * or a point on the EDGE between corners `a` and `b` at parameter `t` (0 at a,
 * 1 at b) where the height contour crosses.
 */
export type ContourVertex =
  | { readonly kind: 'corner'; readonly i: 0 | 1 | 2 }
  | { readonly kind: 'edge'; readonly a: 0 | 1 | 2; readonly b: 0 | 1 | 2; readonly t: number };

/**
 * Does the tile meet the contour along an EDGE — an edge whose BOTH corners are
 * strictly on the kept side of `threshold`? Pure. Gates the band at the tile
 * level so a single corner crossing the contour (point contact, no real edge)
 * does NOT sprout a stray wedge: only tiles with a genuine submerged shoreline
 * edge get sand, only tiles with a genuine ridge edge get rock. Tiles that DO
 * qualify still draw the full contour on BOTH triangles, so the one-corner
 * sibling triangle keeps the band continuous around the shared corner.
 *
 * For integer heights this matches the intuitive edges: `below`/SAND_MAX_HEIGHT
 * (0.5) needs both corners < 0.5, i.e. both at SEA_LEVEL — a submerged edge.
 */
export function tileHasContourEdge(
  topH: number,
  rightH: number,
  bottomH: number,
  leftH: number,
  threshold: number,
  keep: ContourSide,
): boolean {
  const inSide = (h: number): boolean => (keep === 'below' ? h < threshold : h > threshold);
  const top = inSide(topH);
  const right = inSide(rightH);
  const bottom = inSide(bottomH);
  const left = inSide(leftH);
  return (top && right) || (right && bottom) || (bottom && left) || (left && top);
}

/**
 * Clip ONE terrain triangle at the height contour `threshold`, returning the
 * sub-polygon on the `keep` side ('below' for beaches, 'above' for highland
 * rock), in boundary order. Heights vary linearly across a triangle, so the
 * contour is a straight line and the polygon's cut edge is parallel to the local
 * slope contour.
 *
 * Returns `[]` when no corner is on the kept side; the three corners when all
 * are; a 3-vertex polygon when exactly one is; a 4-vertex polygon when exactly
 * two are. The caller maps each `ContourVertex` to a screen point + UV and fills
 * it with the band texture.
 *
 * `cross(a,b)` is only ever called with corner `a` kept and `b` not kept, so
 * `threshold` lies strictly between `h[a]` and `h[b]`; the sign of
 * `(threshold - h[a])` and `(h[b] - h[a])` always agree, giving `t` in (0, 1)
 * with no divide-by-zero, for BOTH sides.
 */
export function contourPolygon(
  h0: number,
  h1: number,
  h2: number,
  threshold: number,
  keep: ContourSide,
): ContourVertex[] {
  const h = [h0, h1, h2] as const;
  const test = (v: number): boolean => (keep === 'below' ? v < threshold : v > threshold);
  const inSide = [test(h0), test(h1), test(h2)] as const;
  const count = (inSide[0] ? 1 : 0) + (inSide[1] ? 1 : 0) + (inSide[2] ? 1 : 0);

  if (count === 0) return [];
  if (count === 3) {
    return [
      { kind: 'corner', i: 0 },
      { kind: 'corner', i: 1 },
      { kind: 'corner', i: 2 },
    ];
  }

  const cross = (a: 0 | 1 | 2, b: 0 | 1 | 2): ContourVertex => ({
    kind: 'edge',
    a,
    b,
    t: (threshold - h[a]) / (h[b] - h[a]),
  });

  if (count === 1) {
    // A single kept corner → a small wedge at that corner. On the classic
    // two-corner band tile this corner is SHARED with the neighbouring triangle's
    // full band, so the wedge keeps the band CONTINUOUS around the corner instead
    // of leaving a notch. The tile-level edge gate above is what suppresses true
    // point-contact tiles, so this wedge only ever fires on real band tiles.
    const k: 0 | 1 | 2 = inSide[0] ? 0 : inSide[1] ? 1 : 2;
    const n: 0 | 1 | 2 = ((k + 1) % 3) as 0 | 1 | 2;
    const p: 0 | 1 | 2 = ((k + 2) % 3) as 0 | 1 | 2;
    return [{ kind: 'corner', i: k }, cross(k, n), cross(k, p)];
  }

  // count === 2: one corner outside (m); quad of the two kept corners + 2 crossings.
  const m: 0 | 1 | 2 = !inSide[0] ? 0 : !inSide[1] ? 1 : 2;
  const n: 0 | 1 | 2 = ((m + 1) % 3) as 0 | 1 | 2;
  const p: 0 | 1 | 2 = ((m + 2) % 3) as 0 | 1 | 2;
  return [{ kind: 'corner', i: n }, { kind: 'corner', i: p }, cross(p, m), cross(n, m)];
}
