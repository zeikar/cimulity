import { ELEVATION_HEIGHT } from '@/game/core';
import { shadowOffsetScreen } from '../lighting';
import type { Point } from './cubeGeometry';

type CubeFaces = { top: Point[]; left: Point[]; right: Point[] };

export const SHADOW_COLOR = 0x000000;

// Grounding cue — visible against light terrain but stays a soft drop shadow, not a hard black blob.
export const SHADOW_ALPHA = 0.35;

// Minimum on-screen shadow length (in screen-pixel magnitude along the light's projected
// direction) so even very low cubes still ground visually. Applied as a post-clamp on the
// height-derived offset from shadowOffsetScreen() — clamping the FULL VECTOR magnitude,
// not the X component alone, so the floor stays well-defined for any light direction
// (including a future pure-N/S world light whose screen-x projection would be zero).
export const SHADOW_MIN_LENGTH = 4;

export function cubeShadowPolygon(faces: CubeFaces): Point[] {
  // left[1] = west top, left[2] = west base — same lift extraction as cubeRoofAccent.
  const mainLift = faces.left[2].y - faces.left[1].y;
  // Recover world-height from pixel lift. The shadow geometry is linear in z, so we
  // probe the light direction with z=1 once and scale by magnitude (not by dx alone)
  // so the MIN clamp stays correct even if a future light makes unit.dx zero.
  const z = mainLift / ELEVATION_HEIGHT;
  const unit = shadowOffsetScreen(1);
  const unitLen = Math.hypot(unit.dx, unit.dy);
  // unitLen === 0 only if SHADOW_LENGTH_SCALE is 0 or the light is straight up (no
  // horizontal component). Both are degenerate "no shadow" cases — return zero offset
  // and rely on the natural cube-on-ground appearance.
  if (unitLen === 0) {
    return faces.top.map((p) => ({ x: p.x, y: p.y + mainLift }));
  }
  const naturalLen = unitLen * z;
  const finalLen = Math.max(SHADOW_MIN_LENGTH, naturalLen);
  const scale = finalLen / unitLen;
  const dx = unit.dx * scale;
  const dy = unit.dy * scale;
  return [
    { x: faces.top[0].x + dx, y: faces.top[0].y + mainLift + dy }, // north
    { x: faces.top[1].x + dx, y: faces.top[1].y + mainLift + dy }, // east
    { x: faces.top[2].x + dx, y: faces.top[2].y + mainLift + dy }, // south
    { x: faces.top[3].x + dx, y: faces.top[3].y + mainLift + dy }, // west
  ];
}
