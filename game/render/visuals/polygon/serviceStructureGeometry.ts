/**
 * Pure geometry + palette for the simple service-building cube (police, fire,
 * hospital, school) — a single flat-topped block over the structure's 2×2
 * footprint, drawn as one cube in a per-type colour. Unlike the power plant
 * there are no chimneys; services read as plain civic blocks distinguished only
 * by colour. No Pixi imports.
 *
 * All coordinates are anchor-local screen space (origin at
 * tileToScreen(structureAnchor)), matching `powerPlantCubeFaces` so the visual
 * can position the wrapper once at tileToScreenWithHeight(anchor).
 */

import { rectangularUnionTopPolygon } from './cubeGeometry';
import type { Point } from './cubeGeometry';

/** A civic service structure rendered as a plain coloured cube. */
export type ServiceStructureType = 'police_station' | 'fire_station' | 'hospital' | 'school';

export function isServiceStructureType(t: string): t is ServiceStructureType {
  return t === 'police_station' || t === 'fire_station' || t === 'hospital' || t === 'school';
}

/** Vertical extent of the service block (matches the power-plant body height so
 *  civic buildings and the plant read at a consistent ground-floor scale). */
export const SERVICE_BODY_HEIGHT_PX = 40;

/** Per-type base colour. Distinct, conventional hues so a glance tells them
 *  apart: police blue, fire red, hospital clinical near-white, school amber.
 *  The exhaustiveness check catches any omitted type. */
export function serviceStructureBaseColor(type: ServiceStructureType): number {
  switch (type) {
    case 'police_station':
      return 0x3568b0; // blue
    case 'fire_station':
      return 0xc63a2a; // red
    case 'hospital':
      return 0xe8eef2; // near-white (clinical)
    case 'school':
      return 0xe0a52e; // amber
  }
}

/**
 * Compute the three visible cube faces for the service block in anchor-local
 * screen coordinates. The footprint is an NW-anchored 2×2 rect; the top diamond
 * is lifted by SERVICE_BODY_HEIGHT_PX and side walls descend by the same amount,
 * so the cube bottom lands on the tile plane.
 *
 * Returns null only if the footprint is not a valid NW-anchored rect (it always
 * is for a placed structure, so callers may assert non-null).
 */
export function serviceStructureCubeFaces(
  footprint: ReadonlyArray<{ x: number; y: number }>,
  anchor: { x: number; y: number },
): { top: Point[]; left: Point[]; right: Point[] } | null {
  const unlifted = rectangularUnionTopPolygon(footprint, anchor);
  if (unlifted === null) return null;

  const h = SERVICE_BODY_HEIGHT_PX;
  const N: Point = { x: unlifted.N.x, y: unlifted.N.y - h };
  const E: Point = { x: unlifted.E.x, y: unlifted.E.y - h };
  const S: Point = { x: unlifted.S.x, y: unlifted.S.y - h };
  const W: Point = { x: unlifted.W.x, y: unlifted.W.y - h };

  // Top face: diamond [N, E, S, W] at the cube roof.
  const top: Point[] = [N, E, S, W];
  // Left face: S → W → W+(0,h) → S+(0,h).
  const left: Point[] = [S, W, { x: W.x, y: W.y + h }, { x: S.x, y: S.y + h }];
  // Right face: E → S → S+(0,h) → E+(0,h).
  const right: Point[] = [E, S, { x: S.x, y: S.y + h }, { x: E.x, y: E.y + h }];

  return { top, left, right };
}
