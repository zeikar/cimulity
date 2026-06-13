import { describe, it, expect } from 'vitest';
import {
  apronEdges,
  apronBandQuad,
  SIDEWALK_COLOR,
  APRON_DEPTH,
  APRON_CENTER_MARGIN,
} from './apronBandGeometry';
import { ORTHO_DIRS } from '@/game/render/roadAutoTile';
import { ISO_CONFIG } from '@/game/render/IsoTransform';

// Standard flat 64×32 diamond corners (tile at origin, elevation 0).
// tileToScreen({x:0,y:0}) = {x:0,y:0}
// top:    { x:  0, y:  0 }
// right:  { x: 32, y: 16 }
// bottom: { x:  0, y: 32 }
// left:   { x:-32, y: 16 }
const FLAT_CORNERS = {
  top:    { x:  0, y:  0 },
  right:  { x: 32, y: 16 },
  bottom: { x:  0, y: 32 },
  left:   { x: -32, y: 16 },
};

const CENTROID = {
  x: (FLAT_CORNERS.top.x + FLAT_CORNERS.right.x + FLAT_CORNERS.bottom.x + FLAT_CORNERS.left.x) / 4,
  y: (FLAT_CORNERS.top.y + FLAT_CORNERS.right.y + FLAT_CORNERS.bottom.y + FLAT_CORNERS.left.y) / 4,
};

// ── apronEdges ────────────────────────────────────────────────────────────────

describe('apronEdges', () => {
  it('no road neighbours → []', () => {
    expect(apronEdges(() => false)).toEqual([]);
  });

  it('N only → ["N"]', () => {
    expect(apronEdges((dx, dy) => dx === 0 && dy === -1)).toEqual(['N']);
  });

  it('E only → ["E"]', () => {
    expect(apronEdges((dx, dy) => dx === 1 && dy === 0)).toEqual(['E']);
  });

  it('S only → ["S"]', () => {
    expect(apronEdges((dx, dy) => dx === 0 && dy === 1)).toEqual(['S']);
  });

  it('W only → ["W"]', () => {
    expect(apronEdges((dx, dy) => dx === -1 && dy === 0)).toEqual(['W']);
  });

  it('N+E → ["N","E"]', () => {
    expect(apronEdges((dx, dy) => (dx === 0 && dy === -1) || (dx === 1 && dy === 0))).toEqual(['N', 'E']);
  });

  it('all four → ["N","E","S","W"]', () => {
    expect(apronEdges(() => true)).toEqual(['N', 'E', 'S', 'W']);
  });

  it('probes exactly ORTHO_DIRS order: [[0,-1],[1,0],[0,1],[-1,0]]', () => {
    const probed: Array<[number, number]> = [];
    apronEdges((dx, dy) => { probed.push([dx, dy]); return false; });
    expect(probed).toEqual(ORTHO_DIRS.map(d => [d.dx, d.dy]));
  });
});

// ── apronBandQuad ─────────────────────────────────────────────────────────────

function sub(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function len(v: { x: number; y: number }): number {
  return Math.hypot(v.x, v.y);
}

// Perpendicular distance from point C to line through a,b.
function perpDistFromLine(C: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const L = Math.hypot(abx, aby) || 1;
  return Math.abs(abx * (C.y - a.y) - aby * (C.x - a.x)) / L;
}

describe('apronBandQuad — flat diamond', () => {
  const EPS = 1e-9;

  for (const edge of ['N', 'E', 'S', 'W'] as const) {
    describe(`edge ${edge}`, () => {
      it('outer two corners are EXACTLY the edge corners (flush)', () => {
        const [p0, p1] = apronBandQuad(FLAT_CORNERS, edge);

        const expectedPairs: Record<string, [typeof FLAT_CORNERS.top, typeof FLAT_CORNERS.right]> = {
          N: [FLAT_CORNERS.top,    FLAT_CORNERS.right],
          E: [FLAT_CORNERS.right,  FLAT_CORNERS.bottom],
          S: [FLAT_CORNERS.bottom, FLAT_CORNERS.left],
          W: [FLAT_CORNERS.left,   FLAT_CORNERS.top],
        };
        const [ep0, ep1] = expectedPairs[edge];
        expect(p0.x).toBeCloseTo(ep0.x, 9);
        expect(p0.y).toBeCloseTo(ep0.y, 9);
        expect(p1.x).toBeCloseTo(ep1.x, 9);
        expect(p1.y).toBeCloseTo(ep1.y, 9);
      });

      it('inner corners are offset toward centroid (closer than outer)', () => {
        const [p0, p1, inner1, inner0] = apronBandQuad(FLAT_CORNERS, edge);

        // inner0 should be closer to centroid than p0
        const distOuter0 = len(sub(p0, CENTROID));
        const distInner0 = len(sub(inner0, CENTROID));
        expect(distInner0).toBeLessThan(distOuter0 - EPS);

        // inner1 should be closer to centroid than p1
        const distOuter1 = len(sub(p1, CENTROID));
        const distInner1 = len(sub(inner1, CENTROID));
        expect(distInner1).toBeLessThan(distOuter1 - EPS);
      });

      it('inner and outer pairs share the same offset vector', () => {
        const [p0, p1, inner1, inner0] = apronBandQuad(FLAT_CORNERS, edge);
        const offset0 = sub(inner0, p0);
        const offset1 = sub(inner1, p1);
        // Both offsets must be the same vector (parallel band).
        expect(offset0.x).toBeCloseTo(offset1.x, 6);
        expect(offset0.y).toBeCloseTo(offset1.y, 6);
      });

      it('apron depth matches expected formula (unclamped on flat tile)', () => {
        const [p0, , inner1, inner0] = apronBandQuad(FLAT_CORNERS, edge);
        const offset = sub(inner0, p0);
        const actualDepth = len(offset);
        // On a standard flat diamond, APRON_CENTER_MARGIN * perpDist > APRON_DEPTH * TILE_HEIGHT,
        // so the unclamped value wins.
        const expectedDepth = APRON_DEPTH * ISO_CONFIG.TILE_HEIGHT;
        expect(actualDepth).toBeCloseTo(expectedDepth, 6);
        void inner1; // referenced above
      });
    });
  }

  it('on a degenerate squished diamond, clamp caps the inset (inner stays on land side)', () => {
    // Thin horizontal diamond: top/bottom at same x=0, y offset only 2px apart.
    // This makes perpDist(C, edge) very small → clamp kicks in.
    const thinCorners = {
      top:    { x:  0, y: 0 },
      right:  { x: 32, y: 1 },
      bottom: { x:  0, y: 2 },
      left:   { x: -32, y: 1 },
    };
    const thinCentroid = {
      x: (thinCorners.top.x + thinCorners.right.x + thinCorners.bottom.x + thinCorners.left.x) / 4,
      y: (thinCorners.top.y + thinCorners.right.y + thinCorners.bottom.y + thinCorners.left.y) / 4,
    };

    for (const edge of ['N', 'E', 'S', 'W'] as const) {
      const [p0, p1, inner1, inner0] = apronBandQuad(thinCorners, edge);
      // The inner side must still be on the land side (closer to centroid than the edge).
      // Measure perpendicular distance from centroid to inner edge line.
      const distCToOuter = perpDistFromLine(thinCentroid, p0, p1);
      const distCToInner = perpDistFromLine(thinCentroid, inner0, inner1);
      // inner must be strictly between edge and centroid: distCToInner < distCToOuter.
      expect(distCToInner).toBeLessThan(distCToOuter - EPS);
      // And centroid must be on the correct side — distCToInner >= 0.
      expect(distCToInner).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── constants sanity ──────────────────────────────────────────────────────────

describe('constants', () => {
  it('SIDEWALK_COLOR is a valid hex colour (0..0xffffff)', () => {
    expect(SIDEWALK_COLOR).toBeGreaterThanOrEqual(0);
    expect(SIDEWALK_COLOR).toBeLessThanOrEqual(0xffffff);
  });
  it('APRON_DEPTH is positive and less than 1', () => {
    expect(APRON_DEPTH).toBeGreaterThan(0);
    expect(APRON_DEPTH).toBeLessThan(1);
  });
  it('APRON_CENTER_MARGIN is in (0, 1]', () => {
    expect(APRON_CENTER_MARGIN).toBeGreaterThan(0);
    expect(APRON_CENTER_MARGIN).toBeLessThanOrEqual(1);
  });
});
