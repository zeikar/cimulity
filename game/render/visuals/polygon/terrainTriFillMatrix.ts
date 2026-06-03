/**
 * Pure affine solver for texturing a single terrain triangle.
 *
 * Mirrors `faceTexture.wallFaceFillMatrix`, but where a cube wall is a
 * parallelogram (solvable from two edge vectors), a slope-deformed terrain
 * triangle is arbitrary — so it needs the full 3-correspondence solve.
 *
 * Given three screen corners and their three texture-pixel UVs, returns the
 * Pixi `Matrix` that maps texture-px -> local screen-px (`screen = M · [u, v, 1]`).
 * With `ctx.fill({ texture, matrix, textureSpace: 'global' })`, Pixi inverts this
 * and divides by the texture's source size to produce UVs, so feeding UVs in
 * texture pixels keeps the solver independent of repeat tuning.
 */

import { Matrix } from 'pixi.js';
import type { ScreenCoord } from '@/game/types/coordinates';

/** Texture-pixel coordinate of a triangle corner. */
export interface Uv {
  u: number;
  v: number;
}

/**
 * Solve the 2×3 affine `M = [a c e; b d f]` with `screen = M · [u, v, 1]` from
 * three (uv -> screen) corner correspondences. The rows are
 *   `[a c e] = Sx · U⁻¹`,  `[b d f] = Sy · U⁻¹`,
 * where `U = [[uA uB uC]; [vA vB vC]; [1 1 1]]` and `Sx`/`Sy` are the screen
 * x/y rows. `U` is non-singular for any three distinct, non-collinear corners —
 * which the four shared grid vertices of a tile always are — so no degenerate
 * guard is needed.
 */
export function terrainTriFillMatrix(
  screenA: ScreenCoord,
  screenB: ScreenCoord,
  screenC: ScreenCoord,
  uvA: Uv,
  uvB: Uv,
  uvC: Uv,
): Matrix {
  const uA = uvA.u, vA = uvA.v;
  const uB = uvB.u, vB = uvB.v;
  const uC = uvC.u, vC = uvC.v;

  const det = uA * (vB - vC) + uB * (vC - vA) + uC * (vA - vB);

  // Entries of U⁻¹ (= adjugate / det), indexed [row][col].
  const i00 = (vB - vC) / det;
  const i01 = (uC - uB) / det;
  const i02 = (uB * vC - uC * vB) / det;
  const i10 = (vC - vA) / det;
  const i11 = (uA - uC) / det;
  const i12 = (uC * vA - uA * vC) / det;
  const i20 = (vA - vB) / det;
  const i21 = (uB - uA) / det;
  const i22 = (uA * vB - uB * vA) / det;

  const sAx = screenA.x, sBx = screenB.x, sCx = screenC.x;
  const sAy = screenA.y, sBy = screenB.y, sCy = screenC.y;

  // [a c e] = Sx · U⁻¹ ; [b d f] = Sy · U⁻¹
  const a = sAx * i00 + sBx * i10 + sCx * i20;
  const c = sAx * i01 + sBx * i11 + sCx * i21;
  const e = sAx * i02 + sBx * i12 + sCx * i22;
  const b = sAy * i00 + sBy * i10 + sCy * i20;
  const d = sAy * i01 + sBy * i11 + sCy * i21;
  const f = sAy * i02 + sBy * i12 + sCy * i22;

  // Pixi Matrix(a, b, c, d, tx, ty): apply(p) = (a·x + c·y + tx, b·x + d·y + ty).
  return new Matrix(a, b, c, d, e, f);
}
