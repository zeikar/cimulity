import type { Point } from './cubeGeometry';

type CubeFaces = { top: Point[]; left: Point[]; right: Point[] };

export const SHADOW_COLOR = 0x000000;

// Grounding cue — visible against light terrain but stays a soft drop shadow, not a hard black blob.
export const SHADOW_ALPHA = 0.35;

// Tall buildings cast longer shadows — offset = mainLift × factor, clamped to a min so low cubes still ground.
// Ratio Y = X/2 preserves the iso 2:1 aspect so the shadow direction reads as "east" diagonally.
export const SHADOW_LIFT_FACTOR_X = 0.22;
export const SHADOW_MIN_OFFSET_X = 4;

export function cubeShadowPolygon(faces: CubeFaces): Point[] {
  // left[1] = west top, left[2] = west base — same lift extraction as cubeRoofAccent.
  const mainLift = faces.left[2].y - faces.left[1].y;
  const offsetX = Math.max(SHADOW_MIN_OFFSET_X, mainLift * SHADOW_LIFT_FACTOR_X);
  const offsetY = offsetX / 2;
  return [
    { x: faces.top[0].x + offsetX, y: faces.top[0].y + mainLift + offsetY }, // north
    { x: faces.top[1].x + offsetX, y: faces.top[1].y + mainLift + offsetY }, // east
    { x: faces.top[2].x + offsetX, y: faces.top[2].y + mainLift + offsetY }, // south
    { x: faces.top[3].x + offsetX, y: faces.top[3].y + mainLift + offsetY }, // west
  ];
}
