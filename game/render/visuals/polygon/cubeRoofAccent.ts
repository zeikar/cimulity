// Pure rooftop-accent geometry — separate module so the coverage gate can include it without pulling in Pixi.

import type { Point } from './cubeGeometry';
import type { BuildingType } from '@/game/core/Building';

export const ROOF_ACCENT_MIN_LEVEL = 3;

// Per-type accent spec: silhouette differentiation for R/C/I (chimney / antenna / smokestack).
export const ROOF_ACCENT_SPEC: Readonly<Record<BuildingType, {
  footprintScaleX: number;
  footprintScaleY: number;
  heightScale: number;
  offsetXFrac: number;
}>> = {
  residential: { footprintScaleX: 0.20, footprintScaleY: 0.20, heightScale: 0.30, offsetXFrac: 0.35 },
  commercial:  { footprintScaleX: 0.10, footprintScaleY: 0.10, heightScale: 0.65, offsetXFrac: 0    },
  industrial:  { footprintScaleX: 0.40, footprintScaleY: 0.40, heightScale: 0.22, offsetXFrac: 0.25 },
};

export function shouldShowRoofAccent(level: number): boolean {
  return level >= ROOF_ACCENT_MIN_LEVEL;
}

export function roofAccentFaces(
  mainTop: ReadonlyArray<Point>,
  mainLift: number,
  type: BuildingType,
): { top: Point[]; left: Point[]; right: Point[] } | null {
  const spec = ROOF_ACCENT_SPEC[type];
  const cx = (mainTop[1].x + mainTop[3].x) / 2;
  const cy = (mainTop[0].y + mainTop[2].y) / 2;
  const mainSpanX = (mainTop[1].x - mainTop[3].x) / 2;
  const mainSpanY = (mainTop[2].y - mainTop[0].y) / 2;
  const offsetX = mainSpanX * spec.offsetXFrac;
  const accentSpanX = mainSpanX * spec.footprintScaleX;
  const accentSpanY = mainSpanY * spec.footprintScaleY;
  const accentLift = Math.round(mainLift * spec.heightScale);

  if (accentLift <= 0) return null;

  const ocx = cx + offsetX;

  const top: Point[] = [
    { x: ocx,              y: cy - accentSpanY - accentLift },  // north
    { x: ocx + accentSpanX, y: cy - accentLift },               // east
    { x: ocx,              y: cy + accentSpanY - accentLift },  // south
    { x: ocx - accentSpanX, y: cy - accentLift },               // west
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
