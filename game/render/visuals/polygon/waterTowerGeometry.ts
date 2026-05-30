/**
 * Pure geometry for the water tower structure — a compact 1×1 support body with
 * a single elevated tank cube stacked on top, giving a tall, narrow silhouette
 * distinct from the broad 2×2 power plant.
 *
 * No Pixi imports. All coordinates are anchor-local screen space
 * (origin at tileToScreen(structureAnchor)).
 */

import { rectangularUnionTopPolygon } from './cubeGeometry';
import type { Point } from './cubeGeometry';
import { tileToScreen } from '@/game/render/IsoTransform';

// BODY_HEIGHT_PX: vertical extent of the 1×1 support column.
// TANK_HEIGHT_PX: vertical extent of the elevated tank cube above the body roof.
// The tank sits on the body roof (baseHeightPx = BODY_HEIGHT_PX) and rises by
// TANK_HEIGHT_PX above it, so the tank top ends at BODY_HEIGHT_PX + TANK_HEIGHT_PX
// above the tile plane.
export const BODY_HEIGHT_PX = 30;
export const TANK_HEIGHT_PX = 45;

export interface WaterTowerCubeSpec {
  cells: ReadonlyArray<{ x: number; y: number }>;
  /** NW cell of this spec — for the 1×1 tower both specs sit on structureAnchor. */
  anchor: { x: number; y: number };
  /** Cube's own vertical extent (top minus bottom). */
  heightPx: number;
  /** Height of the cube's bottom above the tile plane. Body = 0; tank = BODY_HEIGHT_PX. */
  baseHeightPx: number;
  role: 'body' | 'tank';
}

/**
 * Returns the fixed 1×1 composition for a water tower:
 *   - one body spec covering the single footprint cell at BODY_HEIGHT_PX
 *   - one tank spec stacked on the body roof at TANK_HEIGHT_PX
 *
 * Both specs occupy the single footprint cell (structureAnchor), so the tower
 * renders as one tall column split into a body band and a taller tank band.
 */
export function waterTowerCubeSpecs(
  structureAnchor: { x: number; y: number },
): WaterTowerCubeSpec[] {
  const ax = structureAnchor.x;
  const ay = structureAnchor.y;

  const cell = [{ x: ax, y: ay }];

  return [
    {
      cells: cell,
      anchor: { x: ax, y: ay },
      heightPx: BODY_HEIGHT_PX,
      baseHeightPx: 0,
      role: 'body',
    },
    {
      cells: cell,
      anchor: { x: ax, y: ay },
      heightPx: TANK_HEIGHT_PX,
      baseHeightPx: BODY_HEIGHT_PX,
      role: 'tank',
    },
  ];
}

/**
 * Compute the three visible cube faces for one spec in structure-anchor-local
 * screen coordinates (origin at tileToScreen(structureAnchor)).
 *
 * The per-spec screen offset `tileToScreen(spec.anchor) - tileToScreen(structureAnchor)`
 * is added to every point so all specs share one coordinate frame and can be
 * drawn with a single `position = tileToScreen(structureAnchor)` on the container.
 */
export function waterTowerCubeFaces(
  spec: WaterTowerCubeSpec,
  structureAnchor: { x: number; y: number },
): { top: Point[]; left: Point[]; right: Point[] } {
  const { heightPx, baseHeightPx } = spec;
  // Total lift from the tile plane to the cube's top (roof).
  const totalLift = baseHeightPx + heightPx;

  // Screen offset of this spec's anchor relative to the structure anchor.
  const specScreen = tileToScreen(spec.anchor);
  const structScreen = tileToScreen(structureAnchor);
  const dx = specScreen.x - structScreen.x;
  const dy = specScreen.y - structScreen.y;

  // Both body and tank are single-cell (1×1) rects, structurally non-null.
  const unlifted = rectangularUnionTopPolygon(spec.cells, spec.anchor)!;

  // Translate to structure-anchor-local frame and lift to the cube roof.
  const N: Point = { x: unlifted.N.x + dx, y: unlifted.N.y + dy - totalLift };
  const E: Point = { x: unlifted.E.x + dx, y: unlifted.E.y + dy - totalLift };
  const S: Point = { x: unlifted.S.x + dx, y: unlifted.S.y + dy - totalLift };
  const W: Point = { x: unlifted.W.x + dx, y: unlifted.W.y + dy - totalLift };

  // Top face: diamond [N, E, S, W] at the cube roof.
  const top: Point[] = [N, E, S, W];

  // Side walls descend by heightPx only (the cube's own extent), so the cube
  // bottom lands at tilePlane - baseHeightPx (body roof for tank, ground for body).
  // Left face: S → W → W+(0,heightPx) → S+(0,heightPx).
  const left: Point[] = [
    S,
    W,
    { x: W.x, y: W.y + heightPx },
    { x: S.x, y: S.y + heightPx },
  ];

  // Right face: E → S → S+(0,heightPx) → E+(0,heightPx).
  const right: Point[] = [
    E,
    S,
    { x: S.x, y: S.y + heightPx },
    { x: E.x, y: E.y + heightPx },
  ];

  return { top, left, right };
}
