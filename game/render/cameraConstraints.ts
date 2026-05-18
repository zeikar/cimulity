/**
 * Pure camera-constraint helpers for the isometric map.
 *
 * Bounds are ZOOM-AWARE and MUST be recomputed per zoom/viewport change.
 * At z=2 the far edge needs a larger negative offset than a static minZoom
 * would allow; a minZoom-static minY would clamp even z=1 centering.
 * These helpers are Pixi-free (they import tileToScreen/ISO_CONFIG only).
 */

import { tileToScreen, ISO_CONFIG } from './IsoTransform';

export interface WorldExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Compute the screen-space bounding box of the full isometric map diamond.
 */
export function mapWorldExtent(mapW: number, mapH: number): WorldExtent {
  return {
    minX: tileToScreen({ x: 0, y: mapH - 1 }).x - ISO_CONFIG.TILE_WIDTH / 2,
    maxX: tileToScreen({ x: mapW - 1, y: 0 }).x + ISO_CONFIG.TILE_WIDTH / 2,
    minY: tileToScreen({ x: 0, y: 0 }).y,
    maxY: tileToScreen({ x: mapW - 1, y: mapH - 1 }).y + ISO_CONFIG.TILE_HEIGHT,
  };
}

/**
 * Compute the allowed camera position range so the map stays in view.
 * Camera position is the Pixi stage translation (pivot at top-left).
 */
export function cameraBounds(
  extent: WorldExtent,
  vpW: number,
  vpH: number,
  zoom: number,
): WorldExtent {
  return {
    minX: -extent.maxX * zoom,
    maxX: vpW - extent.minX * zoom,
    minY: -extent.maxY * zoom,
    maxY: vpH - extent.minY * zoom,
  };
}

/**
 * Compute the camera offset that centres the map in the viewport.
 */
export function centerOffset(
  extent: WorldExtent,
  vpW: number,
  vpH: number,
  zoom: number,
): { x: number; y: number } {
  const midX = (extent.minX + extent.maxX) / 2;
  const midY = (extent.minY + extent.maxY) / 2;
  return {
    x: vpW / 2 - midX * zoom,
    y: vpH / 2 - midY * zoom,
  };
}
