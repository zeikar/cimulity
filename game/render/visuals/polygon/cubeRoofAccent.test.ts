import { describe, it, expect } from 'vitest';
import {
  shouldShowRoofAccent,
  roofAccentFaces,
  ROOF_ACCENT_MIN_LEVEL,
  ROOF_ACCENT_FOOTPRINT_SCALE,
  ROOF_ACCENT_HEIGHT_SCALE,
} from './cubeRoofAccent';
import type { Point } from './cubeGeometry';

const mainTop: Point[] = [
  { x: 0,   y: -32 },
  { x: 64,  y:  0  },
  { x: 0,   y:  32 },
  { x: -64, y:  0  },
];
const cx = 0;
const cy = 0;
const mainSpanX = 64;
const mainSpanY = 32;
const mainLift = 40;
const accentLift = Math.round(mainLift * ROOF_ACCENT_HEIGHT_SCALE);
const accentSpanX = mainSpanX * ROOF_ACCENT_FOOTPRINT_SCALE;
const accentSpanY = mainSpanY * ROOF_ACCENT_FOOTPRINT_SCALE;

describe('cubeRoofAccent', () => {
  it('ROOF_ACCENT_MIN_LEVEL is pinned to 3', () => {
    expect(ROOF_ACCENT_MIN_LEVEL).toBe(3);
  });

  it('shouldShowRoofAccent: boundary at 3, false below', () => {
    expect(shouldShowRoofAccent(2)).toBe(false);
    expect(shouldShowRoofAccent(3)).toBe(true);
  });

  it('shouldShowRoofAccent: representative cases', () => {
    expect(shouldShowRoofAccent(5)).toBe(true);
    expect(shouldShowRoofAccent(0)).toBe(false);
  });

  it('roofAccentFaces returns null for zero, negative, or rounding-to-zero lift', () => {
    expect(roofAccentFaces(mainTop, 0)).toBeNull();
    expect(roofAccentFaces(mainTop, -1)).toBeNull();
    expect(roofAccentFaces(mainTop, 1)).toBeNull();
  });

  it('roofAccentFaces returns non-null at smallest non-null lift boundary', () => {
    expect(roofAccentFaces(mainTop, 2)).not.toBeNull();
  });

  it('roofAccentFaces top face is centered on main top', () => {
    const { top } = roofAccentFaces(mainTop, mainLift)!;
    expect(top[0].x).toBe(cx);
    expect(top[2].x).toBe(cx);
    expect((top[0].y + top[2].y) / 2).toBe(cy - accentLift);
  });

  it('roofAccentFaces top face span and lift dimensions', () => {
    const { top, left } = roofAccentFaces(mainTop, mainLift)!;
    expect(top[1].x - top[3].x).toBe(2 * accentSpanX);
    expect(top[2].y - top[0].y).toBe(2 * accentSpanY);
    expect(left[2].y - left[1].y).toBe(accentLift);
  });

  it('roofAccentFaces base vertices land on main top face', () => {
    const { left, right } = roofAccentFaces(mainTop, mainLift)!;
    expect(left[2].y).toBe(cy);
    expect(right[3].y).toBe(cy);
    expect(left[3].y).toBe(cy + accentSpanY);
    expect(right[2].y).toBe(cy + accentSpanY);
  });

  it('roofAccentFaces span inherits inset from main top', () => {
    const insetTop: Point[] = [
      { x: 0,   y: -32 },
      { x: 32,  y:  0  },
      { x: 0,   y:  32 },
      { x: -32, y:  0  },
    ];
    const r = roofAccentFaces(insetTop, 40)!;
    expect(r.top[1].x - r.top[3].x).toBe((insetTop[1].x - insetTop[3].x) * ROOF_ACCENT_FOOTPRINT_SCALE);
  });

  it('roofAccentFaces lift rounds to integer', () => {
    const r = roofAccentFaces(mainTop, 41)!;
    expect(r.left[2].y - r.left[1].y).toBe(Math.round(41 * ROOF_ACCENT_HEIGHT_SCALE));
  });
});
