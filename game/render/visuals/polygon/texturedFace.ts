/**
 * Shared polygon-drawing helpers for textured iso faces.
 *
 * These helpers take a PixiJS `GraphicsContext` (the low-level draw surface) and
 * operate in anchor-local screen coordinates. They are extracted here so the
 * three special-structure visuals can reuse them alongside CubeBuildingVisual
 * without copy-paste.
 *
 * `fillPoly` is intentionally unexported — it is only used by `drawWindowBacking`
 * in this module; callers should use `drawPoly` (which also strokes) or compose
 * their own fills.
 */

import { GraphicsContext, Texture } from 'pixi.js';
import type { Matrix } from 'pixi.js';
import type { Point } from './cubeGeometry';
import { wallFaceRepeats } from './faceTexture';
import { windowCellLit, windowCellQuads } from './windowLights';

/**
 * Draw a polygon filled with a texture skewed via `matrix` and tinted by
 * `tintColor`, plus a 1px black outline at `strokeAlpha`.
 * `textureSpace: 'global'` is used so the matrix maps texture-px → local-px.
 */
export function drawTexturedPoly(
  ctx: GraphicsContext,
  points: ReadonlyArray<Point>,
  texture: Texture,
  matrix: Matrix,
  tintColor: number,
  strokeAlpha: number,
  ox: number,
  oy: number,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x + ox, points[0].y + oy);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x + ox, points[i].y + oy);
  }
  ctx.closePath();
  ctx.fill({ texture, matrix, color: tintColor, textureSpace: 'global' });
  ctx.stroke({ color: 0x000000, width: 1, alpha: strokeAlpha });
}

/**
 * Draw a flat-colour polygon with a 1px black outline at `strokeAlpha`.
 */
export function drawPoly(
  ctx: GraphicsContext,
  points: ReadonlyArray<Point>,
  fillColor: number,
  strokeAlpha: number,
  ox: number,
  oy: number,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x + ox, points[0].y + oy);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x + ox, points[i].y + oy);
  }
  ctx.closePath();
  ctx.fill({ color: fillColor });
  ctx.stroke({ color: 0x000000, width: 1, alpha: strokeAlpha });
}

// Fill-only path (no stroke) — used for the window-glass backing drawn under a
// textured wall, where the wall texture supplies the outline.
function fillPoly(
  ctx: GraphicsContext,
  points: ReadonlyArray<Point>,
  fillColor: number,
  ox: number,
  oy: number,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x + ox, points[0].y + oy);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x + ox, points[i].y + oy);
  }
  ctx.closePath();
  ctx.fill({ color: fillColor });
}

/**
 * Draw per-window glass backing on a wall face.
 *
 * Paints a dark base over the entire face, then overlays lit window cells on top.
 * The wall texture is drawn after this call — its opaque wall + window frames cover
 * everything except the transparent window holes, which reveal the backing.
 *
 * `glassColor` is a callback so the caller can close over face-factor and density
 * without baking those values into this generic helper.
 */
export function drawWindowBacking(
  ctx: GraphicsContext,
  face: ReadonlyArray<Point>,
  glassColor: (lit: boolean) => number,
  seed: number,
  ox: number,
  oy: number,
): void {
  const { repeatX, repeatY } = wallFaceRepeats(face);
  // Dark backing for the entire face.
  fillPoly(ctx, face, glassColor(false), ox, oy);
  // Overlay lit cells where the window is on.
  for (const cell of windowCellQuads(face, repeatX, repeatY)) {
    if (windowCellLit(seed, cell.col, cell.row)) {
      fillPoly(ctx, cell.points, glassColor(true), ox, oy);
    }
  }
}
