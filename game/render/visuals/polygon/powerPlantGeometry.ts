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

// Tuned so the body sits visibly above neighboring residential cubes and the
// chimney rises clearly above the body — together they read as a power plant.
export const BODY_HEIGHT_PX = 40;
export const CHIMNEY_HEIGHT_PX = 80;

export interface PowerPlantCubeSpec {
  cells: ReadonlyArray<{ x: number; y: number }>;
  /** NW cell of this spec (body anchor = structureAnchor; chimney anchor = its single corner cell). */
  anchor: { x: number; y: number };
  heightPx: number;
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
      role: 'body',
    },
    {
      cells: [chimneyNE],
      anchor: chimneyNE,
      heightPx: CHIMNEY_HEIGHT_PX,
      role: 'chimney',
    },
    {
      cells: [chimneySW],
      anchor: chimneySW,
      heightPx: CHIMNEY_HEIGHT_PX,
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
  const lift = spec.heightPx;

  // Screen offset of this spec's anchor relative to the structure anchor.
  const specScreen = tileToScreen(spec.anchor);
  const structScreen = tileToScreen(structureAnchor);
  const dx = specScreen.x - structScreen.x;
  const dy = specScreen.y - structScreen.y;

  // Both body (multi-cell NW-anchored rect) and chimney (single-cell, which is
  // also a valid NW-anchored 1×1 rect) are structurally guaranteed non-null.
  const unlifted = rectangularUnionTopPolygon(spec.cells, spec.anchor)!;

  // Translate to structure-anchor-local frame and lift.
  const N: Point = { x: unlifted.N.x + dx, y: unlifted.N.y + dy - lift };
  const E: Point = { x: unlifted.E.x + dx, y: unlifted.E.y + dy - lift };
  const S: Point = { x: unlifted.S.x + dx, y: unlifted.S.y + dy - lift };
  const W: Point = { x: unlifted.W.x + dx, y: unlifted.W.y + dy - lift };

  // Top face: diamond [N, E, S, W] lifted.
  const top: Point[] = [N, E, S, W];

  // Left face: S → W → W+(0,lift) → S+(0,lift).
  const left: Point[] = [
    S,
    W,
    { x: W.x, y: W.y + lift },
    { x: S.x, y: S.y + lift },
  ];

  // Right face: E → S → S+(0,lift) → E+(0,lift).
  const right: Point[] = [
    E,
    S,
    { x: S.x, y: S.y + lift },
    { x: E.x, y: E.y + lift },
  ];

  return { top, left, right };
}
