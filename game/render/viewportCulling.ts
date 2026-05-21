// Pure viewport-culling helpers: derive tile-space AABBs from camera + iso projection.

import { ISO_CONFIG } from './IsoTransform';
import { ELEVATION_HEIGHT, MAX_ELEVATION } from '@/game/core';

const HALF_W = ISO_CONFIG.TILE_WIDTH / 2;   // 32 px
const HALF_H = ISO_CONFIG.TILE_HEIGHT / 2;  // 16 px

// One-tile slack at viewport edges hides off-by-one flicker during pan.
export const PADDING_TILES = 1;

// Covers main cube body (cubeLiftPx(level=5, density=2) * CUBE_TYPE_HEIGHT_MULT.commercial ≈ 112 px)
// PLUS rooftop accent height (see cubeRoofAccent.ts, per-type range ~15–75 px: industrial smokestack ~15 px → commercial antenna ~75 px) PLUS slack.
// Revisit when any of cubeLift.ts / cubeTypeRatios.ts / cubeRoofAccent.ts change.
export const MAX_BUILDING_LIFT_PX = 220;

/** Worst-case vertical screen offset due to terrain elevation.
 *  Used to extend the culling AABB bottom edge so elevated tiles are not clipped. */
export const MAX_TERRAIN_LIFT_PX = MAX_ELEVATION * ELEVATION_HEIGHT;

export interface TileBounds {
  minX: number;
  maxX: number;  // half-open (exclusive)
  minY: number;
  maxY: number;  // half-open (exclusive)
}

export interface VisibleTileBoundsResult {
  terrain: TileBounds;
  buildings: TileBounds;
}

// Alias used by TileRenderer and PixiApp — same type, friendlier name.
export type VisibleTileBounds = VisibleTileBoundsResult;

export interface VisibleTileBoundsArgs {
  cameraX: number;
  cameraY: number;
  zoom: number;
  viewportW: number;
  viewportH: number;
  mapWidth: number;
  mapHeight: number;
  // TRUSTED INTERNAL / TEST-ONLY override. Defaults to PADDING_TILES (1). Non-negative integer.
  paddingTiles?: number;
  // TRUSTED INTERNAL / TEST-ONLY override. Defaults to MAX_BUILDING_LIFT_PX (220). World pixels, non-negative.
  maxBuildingLiftPx?: number;
}

// Raw fractional inverse of the iso projection.
// tx = wx / (2*HALF_W) + wy / (2*HALF_H)
// ty = wy / (2*HALF_H) - wx / (2*HALF_W)
function fracInverse(wx: number, wy: number): { tx: number; ty: number } {
  return {
    tx: wx / (2 * HALF_W) + wy / (2 * HALF_H),
    ty: wy / (2 * HALF_H) - wx / (2 * HALF_W),
  };
}

function computeAabb(
  corners: Array<{ tx: number; ty: number }>,
  padding: number,
): TileBounds {
  let minTx = Infinity, maxTx = -Infinity;
  let minTy = Infinity, maxTy = -Infinity;
  for (const c of corners) {
    if (c.tx < minTx) minTx = c.tx;
    if (c.tx > maxTx) maxTx = c.tx;
    if (c.ty < minTy) minTy = c.ty;
    if (c.ty > maxTy) maxTy = c.ty;
  }
  return {
    minX: Math.floor(minTx) - padding,
    maxX: Math.floor(maxTx) + 1 + padding,
    minY: Math.floor(minTy) - padding,
    maxY: Math.floor(maxTy) + 1 + padding,
  };
}

function clampBounds(b: TileBounds, mapW: number, mapH: number): TileBounds {
  const minX = Math.max(0, b.minX);
  const maxX = Math.min(mapW, b.maxX);
  const minY = Math.max(0, b.minY);
  const maxY = Math.min(mapH, b.maxY);
  if (maxX <= minX || maxY <= minY) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

export function visibleTileBounds(args: VisibleTileBoundsArgs): VisibleTileBoundsResult {
  const pad = Math.max(0, Math.floor(args.paddingTiles ?? PADDING_TILES));
  const liftPx = Math.max(0, args.maxBuildingLiftPx ?? MAX_BUILDING_LIFT_PX);

  const { cameraX, cameraY, zoom, viewportW, viewportH, mapWidth, mapHeight } = args;

  // Four screen corners → world via (screenXY - camera) / zoom.
  const tl = { wx: (0         - cameraX) / zoom, wy: (0         - cameraY) / zoom };
  const tr = { wx: (viewportW - cameraX) / zoom, wy: (0         - cameraY) / zoom };
  const bl = { wx: (0         - cameraX) / zoom, wy: (viewportH - cameraY) / zoom };
  const br = { wx: (viewportW - cameraX) / zoom, wy: (viewportH - cameraY) / zoom };

  // Terrain corners: TL/TR unchanged; BL/BR extended by MAX_TERRAIN_LIFT_PX so tiles elevated
  // near the bottom viewport edge are included in the culling AABB.
  const terrainCorners = [
    fracInverse(tl.wx, tl.wy),
    fracInverse(tr.wx, tr.wy),
    fracInverse(bl.wx, bl.wy + MAX_TERRAIN_LIFT_PX),
    fracInverse(br.wx, br.wy + MAX_TERRAIN_LIFT_PX),
  ];
  const terrain = clampBounds(computeAabb(terrainCorners, pad), mapWidth, mapHeight);

  // Building bounds: BL/BR extended additively — cube lift covers anchors below the bottom
  // edge, and terrain lift covers elevated ground under those buildings.
  // TL/TR NOT extended.
  const buildingCorners = [
    fracInverse(tl.wx, tl.wy),
    fracInverse(tr.wx, tr.wy),
    fracInverse(bl.wx, bl.wy + liftPx + MAX_TERRAIN_LIFT_PX),
    fracInverse(br.wx, br.wy + liftPx + MAX_TERRAIN_LIFT_PX),
  ];
  const buildings = clampBounds(computeAabb(buildingCorners, pad), mapWidth, mapHeight);

  return { terrain, buildings };
}

export function* iterateVisibleTiles(bounds: TileBounds): Generator<{ x: number; y: number }> {
  for (let y = bounds.minY; y < bounds.maxY; y++) {
    for (let x = bounds.minX; x < bounds.maxX; x++) {
      yield { x, y };
    }
  }
}

export function isBuildingVisible(
  footprint: ReadonlyArray<{ x: number; y: number }>,
  bounds: TileBounds,
): boolean {
  return footprint.some(
    cell =>
      cell.x >= bounds.minX &&
      cell.x < bounds.maxX &&
      cell.y >= bounds.minY &&
      cell.y < bounds.maxY,
  );
}
