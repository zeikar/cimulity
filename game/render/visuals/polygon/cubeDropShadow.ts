import { ELEVATION_HEIGHT } from '@/game/core';
import { shadowOffsetScreen } from '../lighting';
import type { Point } from './cubeGeometry';

type CubeFaces = { top: Point[]; left: Point[]; right: Point[] };

export const SHADOW_COLOR = 0x000000;

// Grounding cue — visible against light terrain but stays a soft drop shadow, not a hard black blob.
export const SHADOW_ALPHA = 0.35;

// Minimum on-screen horizontal offset so even very low cubes still ground visually.
// Applied as a post-clamp on the height-derived offset from shadowOffsetScreen().
export const SHADOW_MIN_OFFSET_X = 4;

export function cubeShadowPolygon(faces: CubeFaces): Point[] {
  // left[1] = west top, left[2] = west base — same lift extraction as cubeRoofAccent.
  const mainLift = faces.left[2].y - faces.left[1].y;
  // Recover world-height from pixel lift. The shadow geometry is linear in z, so we
  // probe the light direction with z=1 once and scale. The 2:1 iso aspect
  // (offsetY = offsetX/2) falls out of the projection automatically for any light
  // with a pure east/west horizontal component; with the current
  // LIGHT_DIR_WORLD = (-1, 0, 1) the ratio holds exactly.
  const z = mainLift / ELEVATION_HEIGHT;
  const unit = shadowOffsetScreen(1);
  // Natural horizontal offset for this z; clamp up to MIN so very low cubes still
  // ground visually. dy scales in lockstep to preserve the light's projected direction.
  const dx = Math.max(SHADOW_MIN_OFFSET_X, unit.dx * z);
  const dy = unit.dy * (dx / unit.dx);
  return [
    { x: faces.top[0].x + dx, y: faces.top[0].y + mainLift + dy }, // north
    { x: faces.top[1].x + dx, y: faces.top[1].y + mainLift + dy }, // east
    { x: faces.top[2].x + dx, y: faces.top[2].y + mainLift + dy }, // south
    { x: faces.top[3].x + dx, y: faces.top[3].y + mainLift + dy }, // west
  ];
}
