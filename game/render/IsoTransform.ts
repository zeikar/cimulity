/**
 * Isometric transformation utilities for diamond (classic) projection
 *
 * Diamond isometric uses 45° rotation where:
 * - Screen X increases when moving tile +X or -Y
 * - Screen Y increases when moving both +X and +Y
 */

import type { TileCoord, ScreenCoord } from '../types/coordinates';
import { ELEVATION_HEIGHT, MAX_ELEVATION, type Terrain } from '@/game/core';
import { tileCornerHeights } from './terrain/tileCornerHeights';
import { computeTerrainZIndex } from './terrain/terrainZIndex';

export const ISO_CONFIG = {
  TILE_WIDTH: 64,
  TILE_HEIGHT: 32,
} as const;

/**
 * Convert tile grid coordinates to screen coordinates (without camera transform)
 *
 * Algorithm:
 * screenX = (tileX - tileY) * (TILE_WIDTH / 2)
 * screenY = (tileX + tileY) * (TILE_HEIGHT / 2)
 */
export function tileToScreen(tile: TileCoord): ScreenCoord {
  const screenX = (tile.x - tile.y) * (ISO_CONFIG.TILE_WIDTH / 2);
  const screenY = (tile.x + tile.y) * (ISO_CONFIG.TILE_HEIGHT / 2);
  return { x: screenX, y: screenY };
}

/**
 * Convert tile grid coordinates to screen coordinates accounting for elevation.
 * At height=0 this is identical to tileToScreen.
 *
 * Algorithm:
 * screenX = (tileX - tileY) * (TILE_WIDTH / 2)
 * screenY = (tileX + tileY) * (TILE_HEIGHT / 2) - height * ELEVATION_HEIGHT
 */
export function tileToScreenWithHeight(tile: TileCoord, height: number): ScreenCoord {
  const screenX = (tile.x - tile.y) * (ISO_CONFIG.TILE_WIDTH / 2);
  const screenY = (tile.x + tile.y) * (ISO_CONFIG.TILE_HEIGHT / 2) - height * ELEVATION_HEIGHT;
  return { x: screenX, y: screenY };
}

/**
 * Fractional inverse of the iso projection — returns unfloored tile coordinates.
 *
 * Inverse derivation from:
 *   sx = (tx - ty) * TILE_WIDTH/2
 *   sy = (tx + ty) * TILE_HEIGHT/2
 * Solving: tx = (sx/(TILE_WIDTH/2) + sy/(TILE_HEIGHT/2)) / 2
 *          ty = (sy/(TILE_HEIGHT/2) - sx/(TILE_WIDTH/2)) / 2
 */
export function screenToTileRaw(sx: number, sy: number): { x: number; y: number } {
  const halfW = ISO_CONFIG.TILE_WIDTH / 2;
  const halfH = ISO_CONFIG.TILE_HEIGHT / 2;
  return {
    x: (sx / halfW + sy / halfH) / 2,
    y: (sy / halfH - sx / halfW) / 2,
  };
}

/**
 * Convert screen coordinates to tile grid coordinates (inverse transform)
 *
 * Algorithm (derived from linear algebra):
 * tileX = (screenX / (TILE_WIDTH / 2) + screenY / (TILE_HEIGHT / 2)) / 2
 * tileY = (screenY / (TILE_HEIGHT / 2) - screenX / (TILE_WIDTH / 2)) / 2
 */
export function screenToTile(screen: ScreenCoord): TileCoord {
  const r = screenToTileRaw(screen.x, screen.y);
  return { x: Math.floor(r.x), y: Math.floor(r.y) };
}

/**
 * Elevation-aware screen-to-tile picking, deformed-polygon hit-test.
 *
 * Scans candidate tiles from MAX_ELEVATION down to 0 (topmost-wins). Per band:
 * 1. Inverse-project the cursor as if it were at elevation h.
 * 2. Scan a (2 * MAX_ELEVATION + 1)^2 neighborhood around the inverse-projected
 *    tile — the lateral radius bounds the worst case where a tall wedge tile's
 *    bottom corner sits up to MAX_ELEVATION iso-rows away from the cursor's
 *    flat-projection tile.
 * 3. For each in-bounds candidate at elevation h, build its deformed polygon
 *    via projectTileCornerScreen + tileCornerHeights and test polygonContains
 *    (inclusive boundary, general polygon — handles concave deformed quads).
 * 4. Collect all hits in this band; return the one with max computeTerrainZIndex.
 *    The tie-break is required because the inclusive boundary admits multiple
 *    same-band hits at shared-edge cursors AND because the MIN-of-4 corner rule
 *    permits same-height non-adjacent area-overlap (e.g. a same-h tall wedge
 *    drapes over a same-h flat tile non-adjacent in tile coords).
 *
 * Flat fallback when no band has any hit: returns screenToTile(screen) (may be OOB).
 */
export function screenToTileWithTerrain(
  screen: ScreenCoord,
  terrain: Terrain,
  mapWidth: number,
  mapHeight: number,
): TileCoord {
  const R = MAX_ELEVATION; // worst-case lateral radius

  for (let h = MAX_ELEVATION; h >= 0; h--) {
    // Inverse-project the cursor as if it were at elevation h (undo the lift)
    const lifted = { x: screen.x, y: screen.y + h * ELEVATION_HEIGHT };
    const rawTile = screenToTileRaw(lifted.x, lifted.y);
    const center = { x: Math.floor(rawTile.x), y: Math.floor(rawTile.y) };

    let bestHit: TileCoord | null = null;
    let bestZ = -Infinity;

    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const cand = { x: center.x + dx, y: center.y + dy };

        if (cand.x < 0 || cand.x >= mapWidth || cand.y < 0 || cand.y >= mapHeight) continue;
        if (terrain.getTileElevation(cand.x, cand.y) !== h) continue;

        const c = tileCornerHeights(terrain, cand.x, cand.y);
        const poly = [
          projectTileCornerScreen(cand, 'top',    c.topH),
          projectTileCornerScreen(cand, 'right',  c.rightH),
          projectTileCornerScreen(cand, 'bottom', c.bottomH),
          projectTileCornerScreen(cand, 'left',   c.leftH),
        ];

        if (!polygonContains(poly, screen)) continue;

        const z = computeTerrainZIndex(h, cand.x, cand.y);
        if (z > bestZ) {
          bestZ = z;
          bestHit = cand;
        }
      }
    }

    if (bestHit !== null) return bestHit;
  }

  // Flat fallback — preserves current contract (may be OOB)
  return screenToTile(screen);
}

/**
 * Get the center screen position of a tile
 */
export function tileCenterToScreen(tile: TileCoord): ScreenCoord {
  const corner = tileToScreen(tile);
  return {
    x: corner.x,
    y: corner.y + ISO_CONFIG.TILE_HEIGHT / 2,
  };
}

export type CornerKey = 'top' | 'right' | 'bottom' | 'left';

/**
 * Project one corner of a deformed diamond tile to screen coordinates.
 *
 * Single source of truth for corner projection — used by DiamondTileVisual,
 * the picker (Task 6), and SelectionRenderer (Task 7).
 *
 * Derivation: start from screen0 = tileToScreenWithHeight(tile, 0), then apply
 * per-corner offset and subtract the corner's own elevation lift.
 *
 * hw = TILE_WIDTH/2, hh = TILE_HEIGHT/2
 *   top:    (screen0.x,      screen0.y - cornerHeight * ELEVATION_HEIGHT)
 *   right:  (screen0.x + hw, screen0.y + hh - cornerHeight * ELEVATION_HEIGHT)
 *   bottom: (screen0.x,      screen0.y + TILE_HEIGHT - cornerHeight * ELEVATION_HEIGHT)
 *   left:   (screen0.x - hw, screen0.y + hh - cornerHeight * ELEVATION_HEIGHT)
 */
export function projectTileCornerScreen(
  tile: TileCoord,
  corner: CornerKey,
  cornerHeight: number,
): ScreenCoord {
  const screen0 = tileToScreenWithHeight(tile, 0);
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;
  const lift = cornerHeight * ELEVATION_HEIGHT;

  switch (corner) {
    case 'top':
      return { x: screen0.x,      y: screen0.y - lift };
    case 'right':
      return { x: screen0.x + hw, y: screen0.y + hh - lift };
    case 'bottom':
      return { x: screen0.x,      y: screen0.y + ISO_CONFIG.TILE_HEIGHT - lift };
    case 'left':
      return { x: screen0.x - hw, y: screen0.y + hh - lift };
  }
}

/**
 * Returns true for any point inside the polygon (general polygon — convex OR concave)
 * OR exactly on any edge/vertex (inclusive boundary).
 *
 * Algorithm: on-segment test for every edge first (handles inclusive boundary uniformly);
 * fall through to winding-number for interior. The two-stage shape is required because
 * the MIN-of-4 corner rule permits concave deformed quads, where a convex-only half-plane
 * test misclassifies valid interior points.
 */
export function polygonContains(
  poly: ReadonlyArray<ScreenCoord>,
  point: ScreenCoord,
): boolean {
  const n = poly.length;
  const p = point;

  // Stage 1 — on-segment check (boundary inclusive).
  // For each edge, check if p is collinear and within the segment bounds.
  for (let i = 0; i < n; i++) {
    const v0 = poly[i];
    const v1 = poly[(i + 1) % n];

    const cross =
      (v1.x - v0.x) * (p.y - v0.y) - (v1.y - v0.y) * (p.x - v0.x);

    if (cross !== 0) continue; // not collinear with this edge

    // Collinear — check if p lies within the segment [v0, v1].
    const len2 =
      (v1.x - v0.x) * (v1.x - v0.x) + (v1.y - v0.y) * (v1.y - v0.y);

    if (len2 === 0) {
      // Degenerate zero-length edge: p is on it iff p equals v0.
      if (p.x === v0.x && p.y === v0.y) return true;
    } else {
      const dot =
        (p.x - v0.x) * (v1.x - v0.x) + (p.y - v0.y) * (v1.y - v0.y);
      if (dot >= 0 && dot <= len2) return true;
    }
  }

  // Stage 2 — winding-number interior check (Sunday algorithm).
  // A nonzero winding number means p is inside the polygon.
  // The Stage 1 on-segment check above means we don't hit the collinear edge
  // case here (any such point already returned true).
  let wn = 0;
  for (let i = 0; i < n; i++) {
    const v0 = poly[i];
    const v1 = poly[(i + 1) % n];

    if (v0.y <= p.y) {
      if (v1.y > p.y) {
        // Upward crossing — check if p is left of edge (v0→v1)
        const c =
          (v1.x - v0.x) * (p.y - v0.y) - (v1.y - v0.y) * (p.x - v0.x);
        if (c > 0) wn++;
      }
    } else {
      if (v1.y <= p.y) {
        // Downward crossing — check if p is right of edge (v0→v1)
        const c =
          (v1.x - v0.x) * (p.y - v0.y) - (v1.y - v0.y) * (p.x - v0.x);
        if (c < 0) wn--;
      }
    }
  }

  return wn !== 0;
}
