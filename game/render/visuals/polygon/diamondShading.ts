import type { CornerHeights } from '../../terrain/tileCornerHeights';
import { faceBrightness, upwardTriangleNormal, LIGHTING_Z_SCALE } from '../lighting';
import type { Vec3 } from '../lighting';
import { projectTileCornerScreen } from '@/game/render/IsoTransform';
import type { ScreenCoord } from '@/game/types/coordinates';

export type Diagonal = 'tb' | 'lr';

/**
 * Decided layout for one tile's per-triangle brightness + fold-line stroke.
 *
 * Exactly one of `{brightnessWest, brightnessEast}` (when `diagonal === 'tb'`) or
 * `{brightnessNorth, brightnessSouth}` (when `diagonal === 'lr'`) is meaningful;
 * the unused pair is always `1.0`. Keeps the type flat so the renderer
 * doesn't have to discriminate.
 */
export interface ShadingPlan {
  diagonal: Diagonal;
  brightnessWest: number;
  brightnessEast: number;
  brightnessNorth: number;
  brightnessSouth: number;
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
 * - Per-triangle brightness is `faceBrightness(upwardTriangleNormal(...))` from
 *   `lighting.ts`, computed in world/tile space (NOT screen space) so the model
 *   is rotation-friendly. Diagonal choice + concave override + strokeFold rules
 *   unchanged.
 * - Fold stroke: drawn iff the quad is non-planar
 *   (`topH + bottomH !== leftH + rightH`). Planar quads (cardinal slopes,
 *   axis-aligned cliffs) have no real fold so no stroke. Non-planar quads
 *   always get a stroke so the geometry reads uniformly across cases
 *   (one-corner-high tents AND diagonal-drop slopes).
 */
export function planDiamondShading(c: CornerHeights): ShadingPlan {
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

  // World-space tile corners at origin (0, 0). Axes: +x east, +y south, +z up.
  const tTop:    Vec3 = [0, 0, c.topH    * LIGHTING_Z_SCALE];
  const tRight:  Vec3 = [1, 0, c.rightH  * LIGHTING_Z_SCALE];
  const tBottom: Vec3 = [1, 1, c.bottomH * LIGHTING_Z_SCALE];
  const tLeft:   Vec3 = [0, 1, c.leftH   * LIGHTING_Z_SCALE];

  if (useTB) {
    return {
      diagonal: 'tb',
      brightnessWest: faceBrightness(upwardTriangleNormal(tBottom, tLeft, tTop)),
      brightnessEast: faceBrightness(upwardTriangleNormal(tBottom, tRight, tTop)),
      brightnessNorth: 1.0,
      brightnessSouth: 1.0,
      strokeFold,
    };
  }
  return {
    diagonal: 'lr',
    brightnessWest: 1.0,
    brightnessEast: 1.0,
    brightnessNorth: faceBrightness(upwardTriangleNormal(tLeft, tTop, tRight)),
    brightnessSouth: faceBrightness(upwardTriangleNormal(tLeft, tBottom, tRight)),
    strokeFold,
  };
}
