/**
 * Pure geometry helper — computes the largest axis-aligned-square half-side
 * centred at a diamond's midpoint that fits entirely within the deformed
 * (potentially ramp-squished) diamond.
 *
 * Used by DiamondTileVisual to clamp ROAD_HALF_WIDTH so road bands / the
 * square hub cannot bleed outside the owning tile on coplanar ramps.
 */

import type { ScreenCoord } from '@/game/types/coordinates';

/**
 * Return the maximum half-side `h` such that an axis-aligned square centred at
 * `center` with half-side `h` lies entirely within the diamond defined by the
 * four corner points (top, right, bottom, left in screen space).
 *
 * Derivation: for each diamond edge the outward normal is `n` (unit). The
 * support of an axis-aligned square of half-side h toward normal n is
 * `h * (|n.x| + |n.y|)`. The square fits inside the diamond iff that support
 * is <= the signed distance from `center` to the edge line. Taking the minimum
 * over all four edges gives the tightest constraint.
 *
 * On a standard flat 64×32 diamond the result is ≈ 10.67 (> 10.24 = 0.32·32),
 * so ROAD_HALF_WIDTH = 0.32 is never clamped on flat tiles. On a one-step
 * ramp the diamond compresses vertically and the result drops below 10.24,
 * tightening the road to prevent bleed.
 */
export function maxRoadHalfWidthForDiamond(
  center: ScreenCoord,
  top: ScreenCoord,
  right: ScreenCoord,
  bottom: ScreenCoord,
  left: ScreenCoord,
): number {
  // Diamond edges in order: top→right, right→bottom, bottom→left, left→top.
  const edges: [ScreenCoord, ScreenCoord][] = [
    [top,    right],
    [right,  bottom],
    [bottom, left],
    [left,   top],
  ];

  let minHalf = Infinity;
  for (const [a, b] of edges) {
    // Edge tangent and outward normal (pointing away from center).
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    // Candidate outward normal (one of the two perpendiculars).
    let nx = -ty / len;
    let ny =  tx / len;
    // Ensure normal points outward (away from center).
    const toA_x = a.x - center.x;
    const toA_y = a.y - center.y;
    if (toA_x * nx + toA_y * ny < 0) { nx = -nx; ny = -ny; }

    // Perpendicular distance from center to this edge line.
    const dist = toA_x * nx + toA_y * ny;

    // An axis-aligned square of half-side h has support h*(|nx|+|ny|) toward n.
    // Max h that fits: h = dist / (|nx| + |ny|).
    const support = Math.abs(nx) + Math.abs(ny);
    if (support > 0) {
      minHalf = Math.min(minHalf, dist / support);
    }
  }

  return Math.max(0, minHalf);
}
