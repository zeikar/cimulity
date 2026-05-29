/**
 * Pure geometry for the power plant building — a 2×2 body with one or two
 * chimney cubes placed on corner cells of that body.
 *
 * No Pixi imports. All coordinates are anchor-local screen space
 * (origin at tileToScreen(structureAnchor)).
 */

import { rectangularUnionTopPolygon } from './cubeGeometry';
import type { Point } from './cubeGeometry';
import { tileToScreen } from '@/game/render/IsoTransform';

// BODY_HEIGHT_PX: how tall the body block is (its own vertical extent).
// CHIMNEY_HEIGHT_PX: how tall each chimney is above the body roof (its own
// vertical extent). Chimneys sit on the body roof (baseHeightPx = BODY_HEIGHT_PX)
// and rise by CHIMNEY_HEIGHT_PX above it, so their top ends at
// BODY_HEIGHT_PX + CHIMNEY_HEIGHT_PX above the tile plane.
export const BODY_HEIGHT_PX = 40;
export const CHIMNEY_HEIGHT_PX = 50;

export interface PowerPlantCubeSpec {
  cells: ReadonlyArray<{ x: number; y: number }>;
  /** NW cell of this spec (body anchor = structureAnchor; chimney anchor = its single corner cell). */
  anchor: { x: number; y: number };
  /** Cube's own vertical extent (top minus bottom). */
  heightPx: number;
  /** Height of the cube's bottom above the tile plane. Body = 0; chimneys = BODY_HEIGHT_PX. */
  baseHeightPx: number;
  role: 'body' | 'chimney';
}

/**
 * Returns the fixed 2×2 composition for a power plant:
 *   - one body spec covering the full 2×2 rect at BODY_HEIGHT_PX
 *   - two chimney specs (NE and SW corners) each a single cell at CHIMNEY_HEIGHT_PX
 *
 * NE corner = (anchor.x+1, anchor.y), SW corner = (anchor.x, anchor.y+1).
 */
export function powerPlantCubeSpecs(
  structureAnchor: { x: number; y: number },
): PowerPlantCubeSpec[] {
  const ax = structureAnchor.x;
  const ay = structureAnchor.y;

  const bodyCells = [
    { x: ax,     y: ay     },
    { x: ax + 1, y: ay     },
    { x: ax,     y: ay + 1 },
    { x: ax + 1, y: ay + 1 },
  ];

  // Chimneys on NE (ax+1, ay) and SW (ax, ay+1) corners for asymmetric silhouette.
  const chimneyNE = { x: ax + 1, y: ay };
  const chimneySW = { x: ax,     y: ay + 1 };

  return [
    {
      cells: bodyCells,
      anchor: { x: ax, y: ay },
      heightPx: BODY_HEIGHT_PX,
      baseHeightPx: 0,
      role: 'body',
    },
    {
      cells: [chimneyNE],
      anchor: chimneyNE,
      heightPx: CHIMNEY_HEIGHT_PX,
      baseHeightPx: BODY_HEIGHT_PX,
      role: 'chimney',
    },
    {
      cells: [chimneySW],
      anchor: chimneySW,
      heightPx: CHIMNEY_HEIGHT_PX,
      baseHeightPx: BODY_HEIGHT_PX,
      role: 'chimney',
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
export function powerPlantCubeFaces(
  spec: PowerPlantCubeSpec,
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

  // Both body (multi-cell NW-anchored rect) and chimney (single-cell, which is
  // also a valid NW-anchored 1×1 rect) are structurally guaranteed non-null.
  const unlifted = rectangularUnionTopPolygon(spec.cells, spec.anchor)!;

  // Translate to structure-anchor-local frame and lift to the cube roof.
  const N: Point = { x: unlifted.N.x + dx, y: unlifted.N.y + dy - totalLift };
  const E: Point = { x: unlifted.E.x + dx, y: unlifted.E.y + dy - totalLift };
  const S: Point = { x: unlifted.S.x + dx, y: unlifted.S.y + dy - totalLift };
  const W: Point = { x: unlifted.W.x + dx, y: unlifted.W.y + dy - totalLift };

  // Top face: diamond [N, E, S, W] at the cube roof.
  const top: Point[] = [N, E, S, W];

  // Side walls descend by heightPx only (the cube's own extent), so the cube
  // bottom lands at tilePlane - baseHeightPx (body roof for chimneys, ground for body).
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
