// Pure rooftop-accent geometry — separate module so the coverage gate can include it without pulling in Pixi.

import type { Point } from './cubeGeometry';

export const ROOF_ACCENT_MIN_LEVEL = 3;
export const ROOF_ACCENT_FOOTPRINT_SCALE = 0.25;
export const ROOF_ACCENT_HEIGHT_SCALE = 0.25;

export function shouldShowRoofAccent(level: number): boolean {
  return level >= ROOF_ACCENT_MIN_LEVEL;
}

export function roofAccentFaces(
  mainTop: ReadonlyArray<Point>,
  mainLift: number,
): { top: Point[]; left: Point[]; right: Point[] } | null {
  const cx = (mainTop[1].x + mainTop[3].x) / 2;
  const cy = (mainTop[0].y + mainTop[2].y) / 2;
  const mainSpanX = (mainTop[1].x - mainTop[3].x) / 2;
  const mainSpanY = (mainTop[2].y - mainTop[0].y) / 2;
  const accentSpanX = mainSpanX * ROOF_ACCENT_FOOTPRINT_SCALE;
  const accentSpanY = mainSpanY * ROOF_ACCENT_FOOTPRINT_SCALE;
  const accentLift = Math.round(mainLift * ROOF_ACCENT_HEIGHT_SCALE);

  if (accentLift <= 0) return null;

  const top: Point[] = [
    { x: cx,              y: cy - accentSpanY - accentLift },
    { x: cx + accentSpanX, y: cy - accentLift },
    { x: cx,              y: cy + accentSpanY - accentLift },
    { x: cx - accentSpanX, y: cy - accentLift },
  ];

  const left: Point[] = [
    top[2],
    top[3],
    { x: top[3].x, y: top[3].y + accentLift },
    { x: top[2].x, y: top[2].y + accentLift },
  ];

  const right: Point[] = [
    top[1],
    top[2],
    { x: top[2].x, y: top[2].y + accentLift },
    { x: top[1].x, y: top[1].y + accentLift },
  ];

  return { top, left, right };
}
