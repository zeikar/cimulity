/**
 * apronBandDraw — Pixi glue for drawing the concrete apron band.
 *
 * Wraps apronBandQuad + SIDEWALK_COLOR from the pure apronBandGeometry module
 * and draws two triangles using the same darken/fillTri idiom as DiamondTileVisual.
 *
 * NOT gated for coverage — Pixi Graphics is excluded from headless tests.
 */

import type { Graphics } from 'pixi.js';
import type { ScreenCoord } from '@/game/types/coordinates';
import { apronBandQuad, SIDEWALK_COLOR, type ApronEdge } from './apronBandGeometry';

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8)  & 0xff) * factor);
  const b = Math.round( (color        & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function fillTri(
  gfx: Graphics,
  a: ScreenCoord,
  b: ScreenCoord,
  c: ScreenCoord,
  color: number,
): void {
  gfx.beginPath();
  gfx.moveTo(a.x, a.y);
  gfx.lineTo(b.x, b.y);
  gfx.lineTo(c.x, c.y);
  gfx.closePath();
  gfx.fill({ color, alpha: 1 }); // alpha always 1 — sidewalk band is opaque
}

/**
 * Draw the concrete apron band for one shared edge onto `gfx`.
 *
 * @param gfx        Pixi Graphics object (already cleared or in the right state).
 * @param corners    The four deformed diamond corners for this tile.
 * @param edge       Which shared edge to draw the apron on.
 * @param brightness Lambert brightness factor (1.0 on flat tiles).
 */
export function drawApronBand(
  gfx: Graphics,
  corners: { top: ScreenCoord; right: ScreenCoord; bottom: ScreenCoord; left: ScreenCoord },
  edge: ApronEdge,
  brightness: number,
): void {
  const [p0, p1, p2, p3] = apronBandQuad(corners, edge);
  const color = darken(SIDEWALK_COLOR, brightness);
  // Split the quad into two triangles: (p0, p1, p2) and (p0, p2, p3).
  fillTri(gfx, p0, p1, p2, color);
  fillTri(gfx, p0, p2, p3, color);
}
