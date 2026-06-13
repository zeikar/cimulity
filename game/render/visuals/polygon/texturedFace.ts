/**
 * Shared polygon-drawing helpers for textured iso faces.
 *
 * These helpers take a PixiJS `GraphicsContext` (the low-level draw surface) and
 * operate in anchor-local screen coordinates. They are extracted here so the
 * three special-structure visuals can reuse them alongside CubeBuildingVisual
 * without copy-paste.
 *
 * Windows are a vector layer drawn ON TOP of the (opaque, windowless) wall
 * texture: `drawWindows` lays a frame quad and a glass quad per window cell. The
 * unexported `fillWindowPoly` does the fill-only draws those quads need (the wall
 * texture already supplies the face outline, so no stroke).
 */

import { GraphicsContext, Texture } from 'pixi.js';
import type { Matrix } from 'pixi.js';
import type { Point } from './cubeGeometry';
import { wallFaceRepeats } from './faceTexture';
import { windowCellLit, windowCellQuads } from './windowLights';
import { windowFrameQuad, windowGlassQuad } from './windowGeometry';
import type { FacadeMode } from './windowGeometry';

/**
 * Base mullion/frame colour for the on-top window layer — a single dark neutral
 * shared by every visual. Callers shade it by their face factor so the frame
 * tracks the wall's brightness; the neutral tone reads correctly over all glass
 * palettes (residential / commercial / industrial / civic).
 */
export const MULLION_COLOR = 0x2b2f36;

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

// Fill-only path (no stroke) — used for the on-top window frame/glass quads,
// where the underlying wall texture already supplies the face outline.
function fillWindowPoly(
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
 * Draw the per-window vector layer on top of an already-painted wall face.
 *
 * For each window cell on the face, fills a frame quad then a glass quad whose
 * colour follows the cell's lit/unlit state. No stroke — the wall texture below
 * supplies the face outline.
 *
 * `glassColor` is a callback so the caller can close over face-factor and density
 * without baking those values into this generic helper.
 */
export function drawWindows(
  ctx: GraphicsContext,
  face: ReadonlyArray<Point>,
  mode: FacadeMode,
  glassColor: (lit: boolean) => number,
  frameColor: number,
  seed: number,
  ox: number,
  oy: number,
): void {
  const { repeatX, repeatY } = wallFaceRepeats(face);
  for (const cell of windowCellQuads(face, repeatX, repeatY)) {
    fillWindowPoly(ctx, windowFrameQuad(cell.points, mode), frameColor, ox, oy);
    fillWindowPoly(ctx, windowGlassQuad(cell.points, mode), glassColor(windowCellLit(seed, cell.col, cell.row)), ox, oy);
  }
}
