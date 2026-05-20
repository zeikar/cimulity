/**
 * Pure geometry helpers for the cube building visual.
 * No Pixi imports — safe to test in a Node environment.
 */

import { tileToScreen, ISO_CONFIG } from '@/game/render/IsoTransform';

export type Point = { x: number; y: number };

/** Vertical pixel offset per level step. */
export const CUBE_STEP_PX = 8;

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
 */
export function cubeFacePolygons(
  level: number,
  footprint: ReadonlyArray<{ x: number; y: number }>,
  anchor: { x: number; y: number },
): { top: Point[]; left: Point[]; right: Point[] } | null {
  if (level <= 0) return null;

  const anchorScreen = tileToScreen(anchor);
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;
  const lift = level * CUBE_STEP_PX;

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

  const top: Point[] = [
    { x: midX, y: midY - spanY - lift },          // top vertex
    { x: midX + spanX, y: midY - lift },           // right vertex
    { x: midX, y: midY + spanY - lift },           // bottom vertex
    { x: midX - spanX, y: midY - lift },           // left vertex
  ];

  // Left face: connects top-left and bottom-left edges of the top face down to
  // the original (un-lifted) base.
  const left: Point[] = [
    top[0],                                        // top of left edge (top vertex)
    top[3],                                        // left vertex of top face
    { x: top[3].x, y: top[3].y + lift },           // left vertex at base level
    { x: top[0].x, y: top[0].y + lift },           // top vertex at base level
  ];

  // Right face: connects top-right and bottom-right edges of the top face down.
  const right: Point[] = [
    top[0],                                        // top vertex
    top[1],                                        // right vertex of top face
    { x: top[1].x, y: top[1].y + lift },           // right vertex at base level
    { x: top[0].x, y: top[0].y + lift },           // top vertex at base level
  ];

  return { top, left, right };
}
