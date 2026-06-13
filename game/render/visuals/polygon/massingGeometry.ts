/**
 * Pure geometry for building massing: fractional tile-rects (sub-rects of a
 * structure footprint, in anchor-local tile units) projected to anchor-local
 * screen-pixel face polygons. Generalizes cubeGeometry's one-cube-per-footprint
 * to stacked/offset boxes (towers, podiums, wings, roof props) and gable roofs.
 * No Pixi imports — safe to test in a Node environment.
 */

import { ISO_CONFIG } from '@/game/render/IsoTransform';
import type { Point } from './cubeGeometry';

const HW = ISO_CONFIG.TILE_WIDTH / 2;
const HH = ISO_CONFIG.TILE_HEIGHT / 2;

/** Axis-aligned rect in fractional tile units, anchor-local (0..W, 0..H). */
export type FracRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * Project a fractional tile coordinate (anchor-local) to anchor-local screen
 * px, lifted `liftPx` above the tile plane.
 */
export function fracToLocal(tx: number, ty: number, liftPx: number): Point {
  return { x: (tx - ty) * HW, y: (tx + ty) * HH - liftPx };
}

export type BoxFaces = { top: Point[]; left: Point[]; right: Point[] };

/**
 * The three visible faces of a flat-topped box over `rect`, bottom at
 * `baseLiftPx` above the tile plane, walls `heightPx` tall.
 *
 * Same ordering conventions as cubeFacePolygons: top is [N, E, S, W]; walls are
 * [topStart, topEnd, bottomEnd, bottomStart] so wallFaceFillMatrix and
 * drawWindows apply unchanged.
 */
export function massingBoxFaces(rect: FracRect, baseLiftPx: number, heightPx: number): BoxFaces {
  const topLift = baseLiftPx + heightPx;
  const N = fracToLocal(rect.x0, rect.y0, topLift);
  const E = fracToLocal(rect.x1, rect.y0, topLift);
  const S = fracToLocal(rect.x1, rect.y1, topLift);
  const W = fracToLocal(rect.x0, rect.y1, topLift);

  const top: Point[] = [N, E, S, W];
  const left: Point[] = [S, W, { x: W.x, y: W.y + heightPx }, { x: S.x, y: S.y + heightPx }];
  const right: Point[] = [E, S, { x: S.x, y: S.y + heightPx }, { x: E.x, y: E.y + heightPx }];
  return { top, left, right };
}

export type GableFaces = {
  /** SW-facing wall (along the y1 edge). Eave wall for ridge 'x'; gable-end wall for ridge 'y'. */
  wallSW: Point[];
  /** SE-facing wall (along the x1 edge). Gable-end wall for ridge 'x'; eave wall for ridge 'y'. */
  wallSE: Point[];
  /** Triangle between the gable-end wall top and the ridge apex, on the visible end. */
  gable: { points: Point[]; side: 'SW' | 'SE' };
  /**
   * Viewer-facing roof slope (SW-facing for ridge 'x', SE-facing for ridge 'y').
   * Ordered [topStart, topEnd, bottomEnd, bottomStart] with the top edge
   * parallel to the ridge, so texture fill matrices lay shingle courses along
   * the slope.
   */
  slopeFront: Point[];
  /** Away-facing slope, same ordering; null when back-facing in projection (steep roofs). */
  slopeBack: Point[] | null;
};

/**
 * Faces of a gable-roofed box: walls up to `baseLiftPx + wallHeightPx`, ridge
 * `risePx` higher, running along `ridgeAxis` through the rect's midline.
 *
 * The away slope flips to back-facing in screen space when
 * risePx >= halfSpan * TILE_HEIGHT (shoelace winding of the projected quad);
 * it is returned as null past that point so callers never paint roof where the
 * background should show through. Wall faces keep the
 * [topStart, topEnd, bottomEnd, bottomStart] convention for texturing.
 */
export function massingGableFaces(
  rect: FracRect,
  baseLiftPx: number,
  wallHeightPx: number,
  risePx: number,
  ridgeAxis: 'x' | 'y',
): GableFaces {
  const L = baseLiftPx + wallHeightPx;
  const R = L + risePx;
  const { x0, y0, x1, y1 } = rect;

  const wall = (a: Point, b: Point): Point[] => [
    a,
    b,
    { x: b.x, y: b.y + wallHeightPx },
    { x: a.x, y: a.y + wallHeightPx },
  ];

  // Wall top corners (shared by both ridge orientations).
  const Etop = fracToLocal(x1, y0, L);
  const Stop = fracToLocal(x1, y1, L);
  const Wtop = fracToLocal(x0, y1, L);
  const Ntop = fracToLocal(x0, y0, L);

  const wallSW = wall(Stop, Wtop);
  const wallSE = wall(Etop, Stop);

  if (ridgeAxis === 'x') {
    const yc = (y0 + y1) / 2;
    const ridgeW = fracToLocal(x0, yc, R);
    const ridgeE = fracToLocal(x1, yc, R);
    const backVisible = risePx < (yc - y0) * ISO_CONFIG.TILE_HEIGHT;
    return {
      wallSW,
      wallSE,
      gable: { points: [Etop, ridgeE, Stop], side: 'SE' },
      slopeFront: [ridgeW, ridgeE, Stop, Wtop],
      slopeBack: backVisible ? [Ntop, Etop, ridgeE, ridgeW] : null,
    };
  }

  const xc = (x0 + x1) / 2;
  const ridgeN = fracToLocal(xc, y0, R);
  const ridgeS = fracToLocal(xc, y1, R);
  const backVisible = risePx < (xc - x0) * ISO_CONFIG.TILE_HEIGHT;
  return {
    wallSW,
    wallSE,
    gable: { points: [Stop, ridgeS, Wtop], side: 'SW' },
    slopeFront: [ridgeN, ridgeS, Stop, Etop],
    slopeBack: backVisible ? [Ntop, Wtop, ridgeS, ridgeN] : null,
  };
}
