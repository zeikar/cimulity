import type { CornerHeights } from '../../terrain/tileCornerHeights';
import { projectTileCornerScreen } from '@/game/render/IsoTransform';
import type { ScreenCoord } from '@/game/types/coordinates';

export type Diagonal = 'tb' | 'lr';

/**
 * Decided layout for one tile's per-triangle shading + fold-line stroke.
 *
 * Exactly one of `{shadeWest, shadeEast}` (when `diagonal === 'tb'`) or
 * `{shadeNorth, shadeSouth}` (when `diagonal === 'lr'`) is meaningful;
 * the other pair is always `false`. Keeps the type flat so the renderer
 * doesn't have to discriminate.
 */
export interface ShadingPlan {
  diagonal: Diagonal;
  shadeWest: boolean;
  shadeEast: boolean;
  shadeNorth: boolean;
  shadeSouth: boolean;
  /** True iff the quad is non-planar — draw the diagonal as an explicit stroke. */
  strokeFold: boolean;
}

/**
 * Identify the concave vertex of the projected diamond, or null if convex.
 *
 * The MIN-of-4 corner rule lets a vertex sink so far below its neighbors
 * that it pokes "inward" against the other three. For such concave quads
 * the only safe split diagonal is the one whose endpoints include the
 * concave vertex — the OTHER diagonal lies outside the polygon body and
 * would let shading/strokes paint into neighbor tiles.
 */
function concaveVertex(c: CornerHeights): 'top' | 'right' | 'bottom' | 'left' | null {
  const tile = { x: 0, y: 0 };
  const top = projectTileCornerScreen(tile, 'top', c.topH);
  const right = projectTileCornerScreen(tile, 'right', c.rightH);
  const bottom = projectTileCornerScreen(tile, 'bottom', c.bottomH);
  const left = projectTileCornerScreen(tile, 'left', c.leftH);
  const cross = (a: ScreenCoord, b: ScreenCoord, d: ScreenCoord): number =>
    (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
  const signs = [
    Math.sign(cross(left, top, right)),
    Math.sign(cross(top, right, bottom)),
    Math.sign(cross(right, bottom, left)),
    Math.sign(cross(bottom, left, top)),
  ];
  const pos = signs.filter((s) => s > 0).length;
  const neg = signs.filter((s) => s < 0).length;
  // Convex iff all non-zero same sign; degenerate (zero crosses) → treat as convex.
  if (pos + neg < 4) return null;
  if (pos === 4 || neg === 4) return null;
  const minoritySign = pos < neg ? 1 : -1;
  const idx = signs.indexOf(minoritySign);
  return (['top', 'right', 'bottom', 'left'] as const)[idx];
}

/**
 * Decide how to shade a diamond tile given its 4 corner heights.
 *
 * - Diagonal choice:
 *   1. If the projected quad is concave, the only safe diagonal is the one
 *      through the concave vertex (the other lies outside the polygon body).
 *      Concave at top/bottom → TB; concave at left/right → LR.
 *   2. Otherwise (convex), pick the diagonal whose endpoints have the
 *      smaller height difference — that diagonal stays closest to the
 *      surface ridge so the fold lies along it. A tent (one corner up,
 *      three down) gets a fold PERPENDICULAR to the peak. Tie → TB.
 * - Per-triangle shading: a triangle shades iff its mean corner height is
 *   strictly less than the tile's max corner height (i.e. it tilts below
 *   the ridge).
 * - Fold stroke: drawn iff the quad is non-planar
 *   (`topH + bottomH !== leftH + rightH`). Planar quads (cardinal slopes,
 *   axis-aligned cliffs) have no real fold so no stroke. Non-planar quads
 *   always get a stroke so the geometry reads uniformly across cases
 *   (one-corner-high tents AND diagonal-drop slopes).
 */
export function planDiamondShading(c: CornerHeights): ShadingPlan {
  const maxH = Math.max(c.topH, c.rightH, c.bottomH, c.leftH);
  const concave = concaveVertex(c);
  let useTB: boolean;
  if (concave === 'top' || concave === 'bottom') {
    useTB = true;
  } else if (concave === 'left' || concave === 'right') {
    useTB = false;
  } else {
    const tbDiff = Math.abs(c.topH - c.bottomH);
    const lrDiff = Math.abs(c.leftH - c.rightH);
    useTB = tbDiff <= lrDiff;
  }
  const strokeFold = c.topH + c.bottomH !== c.leftH + c.rightH;

  if (useTB) {
    const westMean = (c.bottomH + c.leftH + c.topH) / 3;
    const eastMean = (c.bottomH + c.rightH + c.topH) / 3;
    return {
      diagonal: 'tb',
      shadeWest: westMean < maxH,
      shadeEast: eastMean < maxH,
      shadeNorth: false,
      shadeSouth: false,
      strokeFold,
    };
  }
  const northMean = (c.leftH + c.topH + c.rightH) / 3;
  const southMean = (c.leftH + c.bottomH + c.rightH) / 3;
  return {
    diagonal: 'lr',
    shadeWest: false,
    shadeEast: false,
    shadeNorth: northMean < maxH,
    shadeSouth: southMean < maxH,
    strokeFold,
  };
}
