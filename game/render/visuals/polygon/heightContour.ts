import { SEA_LEVEL } from '@/game/core/Terrain';

/**
 * Terrain at or below the waterline (SEA_LEVEL) is water; from there UP TO this
 * height renders as beach SAND. Keying the beach on a HEIGHT contour makes the
 * sand/grass boundary a constant-height line, which on a slope runs PARALLEL to
 * the coast. Tunable: "roughly half a step above the water".
 */
export const SAND_MAX_HEIGHT = SEA_LEVEL + 0.5;

/**
 * Land ABOVE this height renders as rocky highland ROCK (the high-elevation
 * counterpart to SAND). Same contour idea, mirrored: the rock/grass boundary is a
 * constant-height line parallel to the slope.
 *
 * Tunable. NOTE the procedural generator is gamma-biased LOW: although
 * MAX_ELEVATION is 8, a typical map only PEAKS around 5–6 and most land sits at
 * 1–3. So this is "realistic-max (~6) minus ~2.5", i.e. it catches the genuinely
 * high ground (≥ 4 ≈ the top quarter) and stays reliably visible. Raising it
 * toward 4.5 gives sparser peak caps; tying it to MAX_ELEVATION (e.g. 5.5+) would
 * make rock all but disappear because the terrain rarely reaches there.
 */
export const ROCK_MIN_HEIGHT = 3.5;

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
    // A single kept corner → a small wedge at that corner. This is intentional:
    // on a two-corner band tile the corner is SHARED with the neighbouring
    // triangle's full band, so the wedge keeps the band CONTINUOUS around the
    // corner instead of leaving a notch; and on a point-contact tile (the contour
    // dips below/above at one corner only) the wedge fills what would otherwise be
    // a gap in the band at that corner. There is no tile-level gate — every grass
    // or road triangle the contour reaches gets its sub-region (the caller's
    // per-triangle water skip is the only exclusion, keeping sand off water).
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
