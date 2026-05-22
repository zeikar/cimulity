import type { CornerHeights } from '../../terrain/tileCornerHeights';

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
 * Decide how to shade a diamond tile given its 4 corner heights.
 *
 * - Adaptive diagonal split: pick the diagonal whose endpoints have the
 *   smaller height difference — that diagonal stays closest to the surface
 *   ridge. A tent (one corner up, three down) gets a fold PERPENDICULAR to
 *   the peak rather than through it. Tie → TB.
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
  const tbDiff = Math.abs(c.topH - c.bottomH);
  const lrDiff = Math.abs(c.leftH - c.rightH);
  const useTB = tbDiff <= lrDiff;
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
