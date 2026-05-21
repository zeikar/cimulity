import { describe, it, expect } from 'vitest';
import {
  shouldShowRoofAccent,
  roofAccentFaces,
  ROOF_ACCENT_MIN_LEVEL,
  ROOF_ACCENT_SPEC,
} from './cubeRoofAccent';
import type { Point } from './cubeGeometry';

// Floating-point helper: use for derived span/coordinate equality; reserve toBe for integers, booleans, nulls, spec pins.
const approx = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

// Standard 1x1 tile fixture: iso diamond with mainSpanX=64, mainSpanY=32.
const mainTop: Point[] = [
  { x: 0,   y: -32 },
  { x: 64,  y:  0  },
  { x: 0,   y:  32 },
  { x: -64, y:  0  },
];
const mainSpanX = 64;
const mainSpanY = 32;

describe('cubeRoofAccent', () => {

  // ─── Spec table ────────────────────────────────────────────────────────────

  it('ROOF_ACCENT_MIN_LEVEL is pinned to 3', () => {
    expect(ROOF_ACCENT_MIN_LEVEL).toBe(3);
  });

  it('ROOF_ACCENT_SPEC.residential is pinned', () => {
    expect(ROOF_ACCENT_SPEC.residential).toEqual({ footprintScaleX: 0.20, footprintScaleY: 0.20, heightScale: 0.30, offsetXFrac: 0.35 });
  });

  it('ROOF_ACCENT_SPEC.commercial is pinned', () => {
    expect(ROOF_ACCENT_SPEC.commercial).toEqual({ footprintScaleX: 0.10, footprintScaleY: 0.10, heightScale: 0.65, offsetXFrac: 0 });
  });

  it('ROOF_ACCENT_SPEC.industrial is pinned', () => {
    expect(ROOF_ACCENT_SPEC.industrial).toEqual({ footprintScaleX: 0.40, footprintScaleY: 0.40, heightScale: 0.22, offsetXFrac: 0.25 });
  });

  // ─── Behavioral contracts ──────────────────────────────────────────────────

  it('commercial antenna is tallest (heightScale >= 2x residential)', () => {
    expect(ROOF_ACCENT_SPEC.commercial.heightScale).toBeGreaterThanOrEqual(2 * ROOF_ACCENT_SPEC.residential.heightScale);
  });

  it('industrial smokestack is thickest (footprintScaleX >= 2x residential)', () => {
    expect(ROOF_ACCENT_SPEC.industrial.footprintScaleX).toBeGreaterThanOrEqual(2 * ROOF_ACCENT_SPEC.residential.footprintScaleX);
  });

  it('residential chimney is taller than industrial smokestack', () => {
    expect(ROOF_ACCENT_SPEC.residential.heightScale).toBeGreaterThan(ROOF_ACCENT_SPEC.industrial.heightScale);
  });

  it('commercial accent is centered (offsetXFrac===0)', () => {
    expect(ROOF_ACCENT_SPEC.commercial.offsetXFrac).toBe(0);
  });

  it('residential and industrial accents are off-center (offsetXFrac !== 0)', () => {
    expect(ROOF_ACCENT_SPEC.residential.offsetXFrac).not.toBe(0);
    expect(ROOF_ACCENT_SPEC.industrial.offsetXFrac).not.toBe(0);
  });

  it('per-type diamond containment: all four accent base vertices stay inside main top diamond', () => {
    for (const type of ['residential', 'commercial', 'industrial'] as const) {
      const { offsetXFrac: ox, footprintScaleX: fx, footprintScaleY: fy } = ROOF_ACCENT_SPEC[type];
      for (const [nx, ny] of [
        [ox + fx, 0], [ox - fx, 0],
        [ox, fy], [ox, -fy],
      ]) {
        expect(Math.abs(nx) + Math.abs(ny)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  // ─── shouldShowRoofAccent ──────────────────────────────────────────────────

  it('shouldShowRoofAccent: boundary at 3, false below', () => {
    expect(shouldShowRoofAccent(2)).toBe(false);
    expect(shouldShowRoofAccent(3)).toBe(true);
  });

  it('shouldShowRoofAccent: representative cases', () => {
    expect(shouldShowRoofAccent(5)).toBe(true);
    expect(shouldShowRoofAccent(0)).toBe(false);
  });

  // ─── Null-on-zero / rounding-to-zero guards ───────────────────────────────

  it('roofAccentFaces: all types return null for mainLift=0', () => {
    for (const type of ['residential', 'commercial', 'industrial'] as const) {
      expect(roofAccentFaces(mainTop, 0, type)).toBeNull();
    }
  });

  it('roofAccentFaces: all types return null for mainLift=-1', () => {
    for (const type of ['residential', 'commercial', 'industrial'] as const) {
      expect(roofAccentFaces(mainTop, -1, type)).toBeNull();
    }
  });

  it('residential (heightScale=0.30): mainLift=1 → null (round(0.30)=0), mainLift=2 → non-null (round(0.60)=1)', () => {
    expect(roofAccentFaces(mainTop, 1, 'residential')).toBeNull();
    expect(roofAccentFaces(mainTop, 2, 'residential')).not.toBeNull();
  });

  it('industrial (heightScale=0.22): mainLift=1 → null, mainLift=2 → null (round(0.44)=0), mainLift=3 → non-null (round(0.66)=1)', () => {
    expect(roofAccentFaces(mainTop, 1, 'industrial')).toBeNull();
    expect(roofAccentFaces(mainTop, 2, 'industrial')).toBeNull();
    expect(roofAccentFaces(mainTop, 3, 'industrial')).not.toBeNull();
  });

  // Commercial heightScale=0.65: round(0.65*1)=1, so mainLift=1 is already non-null — no positive-integer rounding-to-zero case exists.
  it('commercial (heightScale=0.65): mainLift=0 → null (guard), mainLift=1 → non-null', () => {
    expect(roofAccentFaces(mainTop, 0, 'commercial')).toBeNull();
    expect(roofAccentFaces(mainTop, 1, 'commercial')).not.toBeNull();
  });

  // ─── Per-type geometry (describe.each) ────────────────────────────────────

  describe.each(['residential', 'commercial', 'industrial'] as const)(
    'roofAccentFaces geometry — %s with mainLift=40',
    (type) => {
      const mainLift = 40;
      const spec = ROOF_ACCENT_SPEC[type];
      const accentLift = Math.round(mainLift * spec.heightScale);
      const centerX = mainSpanX * spec.offsetXFrac;
      const centerY = 0;
      const accentSpanX = mainSpanX * spec.footprintScaleX;
      const accentSpanY = mainSpanY * spec.footprintScaleY;

      it('top face center', () => {
        const { top } = roofAccentFaces(mainTop, mainLift, type)!;
        approx(top[0].x, centerX);
        approx(top[2].x, centerX);
        approx((top[0].y + top[2].y) / 2, centerY - accentLift);
      });

      it('top face span', () => {
        const { top } = roofAccentFaces(mainTop, mainLift, type)!;
        approx(top[1].x - top[3].x, 2 * accentSpanX);
        approx(top[2].y - top[0].y, 2 * accentSpanY);
      });

      it('side-face lift is exact integer', () => {
        const { left } = roofAccentFaces(mainTop, mainLift, type)!;
        expect(left[2].y - left[1].y).toBe(accentLift);
      });

      it('west-base vertex (left[2])', () => {
        const { left } = roofAccentFaces(mainTop, mainLift, type)!;
        approx(left[2].x, centerX - accentSpanX);
        approx(left[2].y, centerY);
      });

      it('east-base vertex (right[3])', () => {
        const { right } = roofAccentFaces(mainTop, mainLift, type)!;
        approx(right[3].x, centerX + accentSpanX);
        approx(right[3].y, centerY);
      });

      it('south-base vertices (left[3] and right[2] are the same point)', () => {
        const { left, right } = roofAccentFaces(mainTop, mainLift, type)!;
        approx(left[3].x, centerX);
        approx(left[3].y, centerY + accentSpanY);
        expect(right[2]).toEqual(left[3]);
      });

      it('hidden north-base: top[0].x close to centerX, top[0].y + accentLift close to centerY - accentSpanY', () => {
        const { top } = roofAccentFaces(mainTop, mainLift, type)!;
        approx(top[0].x, centerX);
        approx(top[0].y + accentLift, centerY - accentSpanY);
      });

      it('all four accent base vertices stay inside main top diamond', () => {
        // base vertices in world coords relative to main top center (cx=0, cy=0 for our fixture)
        const baseVertices = [
          { bx: centerX - accentSpanX, by: centerY },             // west
          { bx: centerX + accentSpanX, by: centerY },             // east
          { bx: centerX,               by: centerY + accentSpanY }, // south
          { bx: centerX,               by: centerY - accentSpanY }, // north
        ];
        for (const { bx, by } of baseVertices) {
          expect(Math.abs(bx) / mainSpanX + Math.abs(by) / mainSpanY).toBeLessThanOrEqual(1 + 1e-9);
        }
      });
    }
  );

  // ─── Inset inheritance ────────────────────────────────────────────────────

  it('roofAccentFaces span inherits inset from main top (residential)', () => {
    const spec = ROOF_ACCENT_SPEC.residential;
    const insetTop: Point[] = [
      { x: 0,   y: -32 },
      { x: 32,  y:  0  },
      { x: 0,   y:  32 },
      { x: -32, y:  0  },
    ];
    const r = roofAccentFaces(insetTop, 40, 'residential')!;
    approx(r.top[1].x - r.top[3].x, (insetTop[1].x - insetTop[3].x) * spec.footprintScaleX);
  });

  // ─── Lift rounding ────────────────────────────────────────────────────────

  it('roofAccentFaces lift rounds to integer (per type, mainLift=41)', () => {
    // round(41*0.30)=12, round(41*0.65)=27, round(41*0.22)=9
    const expectedFor41 = { residential: 12, commercial: 27, industrial: 9 } as const;
    for (const type of ['residential', 'commercial', 'industrial'] as const) {
      const r = roofAccentFaces(mainTop, 41, type)!;
      expect(r.left[2].y - r.left[1].y).toBe(expectedFor41[type]);
    }
  });
});
