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
 * Returns true iff the footprint is a fully-filled axis-aligned rectangle whose
 * NW (top-left in tile space) corner exactly equals `anchor`.
 *
 * Unlike `isCanonicalFootprintRect` in core, this helper does NOT enforce the
 * simulation's {1..4} W,H cap — that is `isCanonicalFootprintRect`'s job at the
 * core boundary. The renderer accepts any W,H ≥ 1.
 */
export function isNwAnchoredFullRectFootprint(
  footprint: ReadonlyArray<{ x: number; y: number }>,
  anchor: { x: number; y: number },
): boolean {
  if (footprint.length === 0) return false;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  const W = maxX - minX + 1;
  const H = maxY - minY + 1;

  if (anchor.x !== minX || anchor.y !== minY) return false;
  if (footprint.length !== W * H) return false;

  const seen = new Set<string>();
  for (const c of footprint) seen.add(`${c.x},${c.y}`);
  if (seen.size !== footprint.length) return false;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!seen.has(`${x},${y}`)) return false;
    }
  }

  return true;
}

/**
 * Returns the four corners of the iso top-face polygon for a W×H rectangular
 * footprint anchored at `anchor`, in anchor-local screen coordinates (unlifted,
 * no inset).
 *
 * Returns `null` if the footprint is not a valid NW-anchored full rectangle.
 *
 * Vertex table (anchor-local, tile-space origin at anchor):
 *   N = (0,       0      )   — NW corner of footprint
 *   E = ( W*hw,   W*hh   )   — NE tip (extends right by W tiles)
 *   S = ((W-H)*hw,(W+H)*hh)  — SE corner
 *   W = (-H*hw,   H*hh   )   — SW tip (extends left by H tiles)
 */
export function rectangularUnionTopPolygon(
  footprint: ReadonlyArray<{ x: number; y: number }>,
  anchor: { x: number; y: number },
): { N: Point; E: Point; S: Point; W: Point } | null {
  if (!isNwAnchoredFullRectFootprint(footprint, anchor)) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  const W = maxX - minX + 1;
  const H = maxY - minY + 1;
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;

  return {
    N: { x: 0,            y: 0            },
    E: { x: W * hw,       y: W * hh       },
    S: { x: (W - H) * hw, y: (W + H) * hh },
    W: { x: -H * hw,      y: H * hh       },
  };
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
  liftScale: number = 1,
): { top: Point[]; left: Point[]; right: Point[] } | null {
  if (level <= 0) return null;
  if (footprint.length === 0) return null;

  const baseLift = cubeLiftPx(level, density);
  // Clamp at 1 so jitter cannot collapse the silhouette into a flat diamond.
  const lift = Math.max(1, Math.round(cubeTypeHeightPx(baseLift, type) * liftScale));
  const inset = cubeTypeInsetRatio(type);

  if (footprint.length === 1) {
    // Single-cell path — unchanged from before.
    const anchorScreen = tileToScreen(anchor);
    const hw = ISO_CONFIG.TILE_WIDTH / 2;
    const hh = ISO_CONFIG.TILE_HEIGHT / 2;

    const localCorners: Point[] = [];
    for (const cell of footprint) {
      const s = tileToScreen(cell);
      const lx = s.x - anchorScreen.x;
      const ly = s.y - anchorScreen.y;
      localCorners.push(
        { x: lx, y: ly },
        { x: lx + hw, y: ly + hh },
        { x: lx, y: ly + ISO_CONFIG.TILE_HEIGHT },
        { x: lx - hw, y: ly + hh },
      );
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of localCorners) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const spanX = (maxX - minX) / 2;
    const spanY = (maxY - minY) / 2;
    const drawSpanX = spanX * (1 - 2 * inset);
    const drawSpanY = spanY * (1 - 2 * inset);

    const top: Point[] = [
      { x: midX, y: midY - drawSpanY - lift },
      { x: midX + drawSpanX, y: midY - lift },
      { x: midX, y: midY + drawSpanY - lift },
      { x: midX - drawSpanX, y: midY - lift },
    ];

    const left: Point[] = [
      top[2],
      top[3],
      { x: top[3].x, y: top[3].y + lift },
      { x: top[2].x, y: top[2].y + lift },
    ];

    const right: Point[] = [
      top[1],
      top[2],
      { x: top[2].x, y: top[2].y + lift },
      { x: top[1].x, y: top[1].y + lift },
    ];

    return { top, left, right };
  }

  // Multi-cell: canonical NW-anchored rectangle — use union polygon.
  if (isNwAnchoredFullRectFootprint(footprint, anchor)) {
    const raw = rectangularUnionTopPolygon(footprint, anchor)!;

    // Centroid of the four raw top-face vertices.
    const cx = (raw.N.x + raw.E.x + raw.S.x + raw.W.x) / 4;
    const cy = (raw.N.y + raw.E.y + raw.S.y + raw.W.y) / 4;

    // Apply per-type inset: v_new = centroid + (v - centroid) * (1 - 2*inset).
    const scale = 1 - 2 * inset;
    const applyInset = (v: Point): Point => ({
      x: cx + (v.x - cx) * scale,
      y: cy + (v.y - cy) * scale,
    });

    // Apply inset then lift.
    const N = applyInset(raw.N);
    const E = applyInset(raw.E);
    const S = applyInset(raw.S);
    const W = applyInset(raw.W);

    // Top face: [N, E, S, W] lifted by `lift` (subtract from y).
    const top: Point[] = [
      { x: N.x, y: N.y - lift },
      { x: E.x, y: E.y - lift },
      { x: S.x, y: S.y - lift },
      { x: W.x, y: W.y - lift },
    ];

    // Side faces: top[2]=S, top[3]=W, top[1]=E.
    // Left face: S → W → W+(0,lift) → S+(0,lift).
    const left: Point[] = [
      top[2],
      top[3],
      { x: top[3].x, y: top[3].y + lift },
      { x: top[2].x, y: top[2].y + lift },
    ];

    // Right face: E → S → S+(0,lift) → E+(0,lift).
    const right: Point[] = [
      top[1],
      top[2],
      { x: top[2].x, y: top[2].y + lift },
      { x: top[1].x, y: top[1].y + lift },
    ];

    return { top, left, right };
  }

  // Multi-cell, non-canonical (irregular or anchor not at NW): bounding-diamond approximation.
  const anchorScreen = tileToScreen(anchor);
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;

  const localCorners: Point[] = [];
  for (const cell of footprint) {
    const s = tileToScreen(cell);
    const lx = s.x - anchorScreen.x;
    const ly = s.y - anchorScreen.y;
    localCorners.push(
      { x: lx, y: ly },
      { x: lx + hw, y: ly + hh },
      { x: lx, y: ly + ISO_CONFIG.TILE_HEIGHT },
      { x: lx - hw, y: ly + hh },
    );
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of localCorners) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const spanX = (maxX - minX) / 2;
  const spanY = (maxY - minY) / 2;
  const drawSpanX = spanX * (1 - 2 * inset);
  const drawSpanY = spanY * (1 - 2 * inset);

  const top: Point[] = [
    { x: midX, y: midY - drawSpanY - lift },
    { x: midX + drawSpanX, y: midY - lift },
    { x: midX, y: midY + drawSpanY - lift },
    { x: midX - drawSpanX, y: midY - lift },
  ];

  const left: Point[] = [
    top[2],
    top[3],
    { x: top[3].x, y: top[3].y + lift },
    { x: top[2].x, y: top[2].y + lift },
  ];

  const right: Point[] = [
    top[1],
    top[2],
    { x: top[2].x, y: top[2].y + lift },
    { x: top[1].x, y: top[1].y + lift },
  ];

  return { top, left, right };
}

