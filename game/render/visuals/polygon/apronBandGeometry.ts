/**
 * apronBandGeometry — pure render-only module.
 *
 * Computes the concrete-grey apron band that sits on the land side of each
 * shared diamond edge adjacent to a road neighbour.
 *
 * Closure contract: `isRoad(dx, dy)` must return false for out-of-bounds
 * neighbours (the caller handles bounds checking). OOB neighbours → false.
 *
 * The returned quad sits on the LAND side of the shared edge: outer side is
 * flush with the diamond edge, inner side is offset toward the tile centroid.
 *
 * No Pixi import — all geometry is plain ScreenCoord math.
 */

import { ORTHO_DIRS, type OrthoDirName } from '@/game/render/roadAutoTile';
import { ISO_CONFIG } from '@/game/render/IsoTransform';
import type { ScreenCoord } from '@/game/types/coordinates';

export type ApronEdge = OrthoDirName;

/** Concrete sidewalk grey, matching road.png curb colour. */
export const SIDEWALK_COLOR = 0x9a9a9a;

/** Inset depth as a fraction of ISO_CONFIG.TILE_HEIGHT on a flat tile. */
export const APRON_DEPTH = 0.18;

/**
 * Maximum fraction of the perpendicular distance from centroid to edge that
 * the apron may consume. Prevents the band from crossing the tile centre on
 * heavily squished ramp diamonds.
 */
export const APRON_CENTER_MARGIN = 0.6;

/**
 * Returns the ApronEdge labels (N/E/S/W) for all orthogonal neighbours where
 * `isRoad` returns true. Order matches ORTHO_DIRS (N → E → S → W).
 */
export function apronEdges(isRoad: (dx: number, dy: number) => boolean): ApronEdge[] {
  const result: ApronEdge[] = [];
  for (const dir of ORTHO_DIRS) {
    if (isRoad(dir.dx, dir.dy)) result.push(dir.name);
  }
  return result;
}

/**
 * Perpendicular distance from point C to the infinite line through A and B.
 * Inline helper mirroring DiamondTileVisual's perpDist.
 */
function perpDist(C: ScreenCoord, a: ScreenCoord, b: ScreenCoord): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = Math.hypot(abx, aby) || 1; // guard: coincident edge points → length 0; any apron depth is then safe
  // |cross(b-a, a-C)| / |b-a|
  return Math.abs(abx * (C.y - a.y) - aby * (C.x - a.x)) / len;
}

/**
 * Builds the apron band quad for a single shared edge.
 *
 * Corner pairing (same as buildRoadDiamond.mid in DiamondTileVisual):
 *   N → top, right   (shared with tile at dy=-1)
 *   E → right, bottom (shared with tile at dx=+1)
 *   S → bottom, left  (shared with tile at dy=+1)
 *   W → left, top    (shared with tile at dx=-1)
 *
 * Returns [p0, p1, p1+offset, p0+offset] wound so that p0/p1 are flush on
 * the shared edge and the inner pair is offset toward the tile centroid.
 */
export function apronBandQuad(
  corners: { top: ScreenCoord; right: ScreenCoord; bottom: ScreenCoord; left: ScreenCoord },
  edge: ApronEdge,
): [ScreenCoord, ScreenCoord, ScreenCoord, ScreenCoord] {
  const { top, right, bottom, left } = corners;

  // p0 and p1 are the two diamond corners bounding the shared edge, in ORTHO_DIRS order.
  let p0: ScreenCoord;
  let p1: ScreenCoord;
  switch (edge) {
    case 'N': p0 = top;    p1 = right;  break;
    case 'E': p0 = right;  p1 = bottom; break;
    case 'S': p0 = bottom; p1 = left;   break;
    case 'W': p0 = left;   p1 = top;    break;
  }

  // Centroid of the four corners.
  const C: ScreenCoord = {
    x: (top.x + right.x + bottom.x + left.x) / 4,
    y: (top.y + right.y + bottom.y + left.y) / 4,
  };

  // Edge direction vector (p1 - p0) and its unit perpendicular (screen-space 90° CCW).
  const edgeDx = p1.x - p0.x;
  const edgeDy = p1.y - p0.y;
  // Perpendicular (CCW rotation): { x: -edgeDy, y: edgeDx }
  const perpLen = Math.hypot(edgeDx, edgeDy) || 1;
  let nx = -edgeDy / perpLen;
  let ny =  edgeDx / perpLen;

  // Orient the normal toward C (flip if pointing away from centroid).
  const edgeMidX = (p0.x + p1.x) / 2;
  const edgeMidY = (p0.y + p1.y) / 2;
  const dotToC = nx * (C.x - edgeMidX) + ny * (C.y - edgeMidY);
  if (dotToC < 0) { nx = -nx; ny = -ny; }

  // Clamp depth so the band cannot cross the centroid on a squished ramp.
  // perpDist(C, p0, p1) = distance from centroid to the shared edge line.
  const distCToEdge = perpDist(C, p0, p1);
  const apronDepth = Math.min(
    APRON_DEPTH * ISO_CONFIG.TILE_HEIGHT,
    APRON_CENTER_MARGIN * distCToEdge,
  );

  // Outer side: flush on the shared edge.
  // Inner side: offset by apronDepth toward centroid.
  const inner0: ScreenCoord = { x: p0.x + nx * apronDepth, y: p0.y + ny * apronDepth };
  const inner1: ScreenCoord = { x: p1.x + nx * apronDepth, y: p1.y + ny * apronDepth };

  return [p0, p1, inner1, inner0];
}
