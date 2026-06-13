/**
 * Pure geometry helpers for window frame and glass quads.
 *
 * Turns a window cell (from `windowCellQuads`) into two nested quads:
 * an outer frame quad and an inner glass quad. The caller draws them;
 * this module only computes the point arrays.
 *
 * Pure module: no side effects, no DOM, no Pixi. Only imports the `Point` type.
 */

import type { Point } from './cubeGeometry';

/** Single definition of facade rendering modes used across the render layer. */
export type FacadeMode = 'punched' | 'curtain';

/**
 * Wall-margin fraction for punched-opening windows.
 * A large inset (~22%) keeps the masonry wall visible around each window.
 */
export const PUNCHED_INSET = 0.22;

/**
 * Wall-margin fraction for curtain-wall facades.
 * A thin mullion gap (~6%) fills almost the whole cell with glass.
 */
export const CURTAIN_INSET = 0.06;

/**
 * Additional inset applied to the frame quad to produce the glass quad.
 * Creates a visible frame border between the outer frame rect and the
 * inner glass pane.
 */
export const FRAME_INSET = 0.10;

/**
 * Contracts a 4-point quad toward its centroid by fraction `t` from each side.
 *
 * For an axis-aligned cell, `t` is the fraction of the full cell width/height
 * removed from each side as margin, so the resulting quad spans the central
 * `(1 − 2t)` portion.  `t=0` is identity; `t=0.5` collapses to a point.
 *
 * The centroid is the mean of the 4 corners. Each output corner moves from its
 * input position toward the centroid by `2t` of that distance (not by `t`,
 * because contracting by `t` from both sides halves the total span — this
 * matches the "remove t from each side" interpretation for axis-aligned quads).
 */
export function insetQuad(points: ReadonlyArray<Point>, t: number): Point[] {
  const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
  const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
  const factor = 2 * t;
  return points.map((p) => ({
    x: p.x + (cx - p.x) * factor,
    y: p.y + (cy - p.y) * factor,
  }));
}

/**
 * Returns the frame quad for a window cell in face-LOCAL coordinates.
 * The frame is the outer visible surround; it sits between the cell boundary
 * and the glass pane.
 */
export function windowFrameQuad(cell: ReadonlyArray<Point>, mode: FacadeMode): Point[] {
  const inset = mode === 'punched' ? PUNCHED_INSET : CURTAIN_INSET;
  return insetQuad(cell, inset);
}

/**
 * Returns the glass quad for a window cell in face-LOCAL coordinates.
 * Glass is inset from the frame by FRAME_INSET, making it strictly smaller
 * than the frame and strictly smaller than the cell.
 */
export function windowGlassQuad(cell: ReadonlyArray<Point>, mode: FacadeMode): Point[] {
  const frame = windowFrameQuad(cell, mode);
  return insetQuad(frame, FRAME_INSET);
}
