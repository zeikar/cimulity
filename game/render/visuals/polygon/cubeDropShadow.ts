import type { Point } from './cubeGeometry';

type CubeFaces = { top: Point[]; left: Point[]; right: Point[] };

export const SHADOW_COLOR = 0x000000;

// subtle grounding cue — high enough to read against light terrain, low enough not to look like a black blob
export const SHADOW_ALPHA = 0.25;

// shadow = un-lifted inset cube base; expansion deferred to round-3 because it requires a dedicated shadow sub-layer below 'building' to avoid front-shadow-over-back-face overpaint
export function cubeShadowPolygon(faces: CubeFaces): Point[] {
  // left[1] = west top, left[2] = west base — same lift extraction as cubeRoofAccent
  const mainLift = faces.left[2].y - faces.left[1].y;
  return [
    { x: faces.top[0].x, y: faces.top[0].y + mainLift }, // north
    { x: faces.top[1].x, y: faces.top[1].y + mainLift }, // east
    { x: faces.top[2].x, y: faces.top[2].y + mainLift }, // south
    { x: faces.top[3].x, y: faces.top[3].y + mainLift }, // west
  ];
}
