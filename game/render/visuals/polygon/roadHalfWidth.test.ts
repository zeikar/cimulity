/**
 * Regression tests for maxRoadHalfWidthForDiamond.
 *
 * (a) A flat 64×32 diamond: maxSquareHalf > 10.24 — a 0.32·TILE_HEIGHT request
 *     is NOT clamped (flat roads keep full width).
 * (b) The REAL one-step N-S coplanar ramp that `Terrain.canBuildRoadAt` permits
 *     (same corner heights as game/tools/ToolActions.test.ts line 60):
 *     topH=1, rightH=1, bottomH=2, leftH=2 for tile (2,2).
 *     The clamp fires (clamped < 10.24) AND the axis-aligned square of half-side
 *     = clamped value satisfies the no-bleed invariant against every diamond edge:
 *     for each edge with outward unit normal n, halfW*(|nx|+|ny|) <= dist(center, edge).
 */

import { describe, it, expect } from 'vitest';
import { maxRoadHalfWidthForDiamond } from './roadHalfWidth';
import { projectTileCornerScreen, ISO_CONFIG } from '@/game/render/IsoTransform';
import type { ScreenCoord } from '@/game/types/coordinates';

const ROAD_HALF_WIDTH = 0.32;
const TARGET_HALF_W = ROAD_HALF_WIDTH * ISO_CONFIG.TILE_HEIGHT; // 10.24

// ---------------------------------------------------------------------------
// Flat tile (0, 0) — all corners at height 0 (renders the canonical 64×32 diamond).
// ---------------------------------------------------------------------------
const TILE_0_0 = { x: 0, y: 0 };
const FLAT_TOP    = projectTileCornerScreen(TILE_0_0, 'top',    0);
const FLAT_RIGHT  = projectTileCornerScreen(TILE_0_0, 'right',  0);
const FLAT_BOTTOM = projectTileCornerScreen(TILE_0_0, 'bottom', 0);
const FLAT_LEFT   = projectTileCornerScreen(TILE_0_0, 'left',   0);
const FLAT_CENTER = {
  x: (FLAT_TOP.x + FLAT_RIGHT.x + FLAT_BOTTOM.x + FLAT_LEFT.x) / 4,
  y: (FLAT_TOP.y + FLAT_RIGHT.y + FLAT_BOTTOM.y + FLAT_LEFT.y) / 4,
};

// ---------------------------------------------------------------------------
// N-S ramp tile (2, 2) — same corner heights as ToolActions.test.ts line 60.
// Terrain default: MIN_LAND_ELEVATION = 1.
// unsafeSetVertexHeight(2, 3, 2) → leftH  = vertex(2,3) = 2
// unsafeSetVertexHeight(3, 3, 2) → bottomH = vertex(3,3) = 2
// topH = vertex(2,2) = 1, rightH = vertex(3,2) = 1.
// ---------------------------------------------------------------------------
const TILE_2_2 = { x: 2, y: 2 };
const RAMP_TOP    = projectTileCornerScreen(TILE_2_2, 'top',    1);
const RAMP_RIGHT  = projectTileCornerScreen(TILE_2_2, 'right',  1);
const RAMP_BOTTOM = projectTileCornerScreen(TILE_2_2, 'bottom', 2);
const RAMP_LEFT   = projectTileCornerScreen(TILE_2_2, 'left',   2);
const RAMP_CENTER = {
  x: (RAMP_TOP.x + RAMP_RIGHT.x + RAMP_BOTTOM.x + RAMP_LEFT.x) / 4,
  y: (RAMP_TOP.y + RAMP_RIGHT.y + RAMP_BOTTOM.y + RAMP_LEFT.y) / 4,
};

/**
 * For a convex polygon with center C, verify that an axis-aligned square of
 * half-side `halfW` centred at C fits inside the polygon.
 *
 * For each edge (a→b) the outward unit normal n is computed; the square's
 * support in direction n is halfW*(|nx|+|ny|). The square fits iff this is
 * <= the perpendicular distance from C to the edge line (dist). A positive
 * epsilon tolerance allows for floating-point edge cases where the clamped
 * value sits exactly on the diamond boundary.
 */
function squareFitsDiamond(
  center: ScreenCoord,
  corners: [ScreenCoord, ScreenCoord, ScreenCoord, ScreenCoord],
  halfW: number,
  eps = 1e-9,
): boolean {
  const [top, right, bottom, left] = corners;
  const edges: [ScreenCoord, ScreenCoord][] = [
    [top, right], [right, bottom], [bottom, left], [left, top],
  ];
  for (const [a, b] of edges) {
    const tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    let nx = -ty / len, ny = tx / len;
    const toA_x = a.x - center.x, toA_y = a.y - center.y;
    if (toA_x * nx + toA_y * ny < 0) { nx = -nx; ny = -ny; }
    const dist = toA_x * nx + toA_y * ny;
    const support = (Math.abs(nx) + Math.abs(ny)) * halfW;
    if (support > dist + eps) return false;
  }
  return true;
}

describe('maxRoadHalfWidthForDiamond', () => {
  it('flat 64×32 diamond: result > 10.24, so ROAD_HALF_WIDTH=0.32 is NOT clamped', () => {
    const maxH = maxRoadHalfWidthForDiamond(FLAT_CENTER, FLAT_TOP, FLAT_RIGHT, FLAT_BOTTOM, FLAT_LEFT);
    expect(maxH).toBeGreaterThan(TARGET_HALF_W);
    // Sanity upper bound: must fit inside half the diamond width (32)
    expect(maxH).toBeLessThan(32);
  });

  it('real N-S ramp (ToolActions coplanar case): clamp fires — clamped value < 10.24', () => {
    const maxH = maxRoadHalfWidthForDiamond(RAMP_CENTER, RAMP_TOP, RAMP_RIGHT, RAMP_BOTTOM, RAMP_LEFT);
    // On the deformed ramp diamond the constraint tightens below 10.24, so the
    // road bands/hub are narrowed to prevent bleed.
    expect(maxH).toBeLessThan(TARGET_HALF_W);
    // Road must still be visible (positive width).
    expect(maxH).toBeGreaterThan(0);
  });

  it('real N-S ramp: clamped halfW keeps the axis-aligned square inside the diamond (no-bleed)', () => {
    const maxH = maxRoadHalfWidthForDiamond(RAMP_CENTER, RAMP_TOP, RAMP_RIGHT, RAMP_BOTTOM, RAMP_LEFT);
    const halfW = Math.min(TARGET_HALF_W, maxH);
    // For each diamond edge the square's support halfW*(|nx|+|ny|) must be <=
    // the perpendicular distance from the center to that edge — this is the
    // analytical no-bleed invariant (axis-aligned square fits inside the convex
    // polygon iff support <= distance for every supporting half-plane).
    expect(
      squareFitsDiamond(RAMP_CENTER, [RAMP_TOP, RAMP_RIGHT, RAMP_BOTTOM, RAMP_LEFT], halfW)
    ).toBe(true);
  });
});
