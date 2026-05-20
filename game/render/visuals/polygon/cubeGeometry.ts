/**
 * Pure geometry helpers for the cube building visual.
 * No Pixi imports — safe to test in a Node environment.
 */

import { tileToScreen, ISO_CONFIG } from '@/game/render/IsoTransform';
import { cubeLiftPx } from './cubeLift';
import type { BuildingType } from '@/game/core/Building';
import { cubeTypeHeightPx, cubeTypeInsetRatio } from './cubeTypeRatios';

export type Point = { x: number; y: number };

/**
 * Returns a position-independent shape token for a building footprint.
 * Cells are converted to anchor-local offsets, sorted lexicographically by (dy, dx),
 * then serialised as "dx0,dy0;dx1,dy1;...".
 * Two footprints with the same shape but different map positions produce the same string.
 */
export function normalizeFootprint(
  footprint: ReadonlyArray<{ x: number; y: number }>,
  anchor: { x: number; y: number },
): string {
  const offsets = footprint
    .map((c) => ({ dx: c.x - anchor.x, dy: c.y - anchor.y }))
    .sort((a, b) => (a.dy !== b.dy ? a.dy - b.dy : a.dx - b.dx));
  return offsets.map((o) => `${o.dx},${o.dy}`).join(';');
}

/**
 * Compute the three visible cube faces (top diamond, left quad, right quad)
 * in anchor-local screen coordinates.
 *
 * Anchor-local means each point is relative to `tileToScreen(anchor)`, so
 * the same shape at different map positions produces identical arrays.
 * Position the resulting Graphics by setting `displayObject.position` to
 * `tileToScreen(anchor)`.
 *
 * Returns `null` for level === 0 (caller renders nothing; terrain diamond handles
 * the flat-zone appearance).
 *
 * Per-type height multiplier and horizontal inset are applied (see `cubeTypeRatios`). The footprint cells passed in are unchanged; the rendered cube may narrow inward of the footprint when the type has a non-zero inset (industrial and residential do not inset).
 */
export function cubeFacePolygons(
  type: BuildingType,
  level: number,
  density: 0 | 1 | 2,
  footprint: ReadonlyArray<{ x: number; y: number }>,
  anchor: { x: number; y: number },
): { top: Point[]; left: Point[]; right: Point[] } | null {
  if (level <= 0) return null;

  const anchorScreen = tileToScreen(anchor);
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;
  const baseLift = cubeLiftPx(level, density);
  const lift = cubeTypeHeightPx(baseLift, type);

  // Compute anchor-local screen corners for every footprint cell.
  // Each tile contributes 4 corners of its isometric diamond.
  const localCorners: Point[] = [];
  for (const cell of footprint) {
    const s = tileToScreen(cell);
    const lx = s.x - anchorScreen.x;
    const ly = s.y - anchorScreen.y;
    localCorners.push(
      { x: lx, y: ly },           // top corner
      { x: lx + hw, y: ly + hh }, // right corner
      { x: lx, y: ly + ISO_CONFIG.TILE_HEIGHT }, // bottom corner
      { x: lx - hw, y: ly + hh }, // left corner
    );
  }

  // Bounding box of all local corners — defines the overall footprint extent.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of localCorners) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // Top face: the footprint's bounding diamond shifted up by `lift`.
  // We approximate the full multi-tile top with the bounding-box diamond, which
  // is correct for rectangular footprints and a reasonable approximation for L-shapes.
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const spanX = (maxX - minX) / 2;
  const spanY = (maxY - minY) / 2;
  const inset = cubeTypeInsetRatio(type);
  const drawSpanX = spanX * (1 - 2 * inset);
  const drawSpanY = spanY * (1 - 2 * inset);

  const top: Point[] = [
    { x: midX, y: midY - drawSpanY - lift },       // top vertex
    { x: midX + drawSpanX, y: midY - lift },       // right vertex
    { x: midX, y: midY + drawSpanY - lift },       // bottom vertex
    { x: midX - drawSpanX, y: midY - lift },       // left vertex
  ];

  // Side faces share the FRONT (south) vertex `top[2]` and drop to the base.
  // This is the standard iso cube where the two visible side faces meet at the
  // front-center vertical edge — that shared edge is what gives the cube its
  // recognisable 3D silhouette.

  // Left face: SOUTH-WEST quad — from front to left, dropping to base.
  const left: Point[] = [
    top[2],                                        // south/front vertex of top
    top[3],                                        // west/left vertex of top
    { x: top[3].x, y: top[3].y + lift },           // west/left vertex at base level
    { x: top[2].x, y: top[2].y + lift },           // south/front vertex at base level
  ];

  // Right face: SOUTH-EAST quad — from right to front, dropping to base.
  const right: Point[] = [
    top[1],                                        // east/right vertex of top
    top[2],                                        // south/front vertex of top
    { x: top[2].x, y: top[2].y + lift },           // south/front vertex at base level
    { x: top[1].x, y: top[1].y + lift },           // east/right vertex at base level
  ];

  return { top, left, right };
}
