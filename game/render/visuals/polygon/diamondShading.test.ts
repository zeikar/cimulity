import { describe, it, expect } from 'vitest';
import { planDiamondShading } from './diamondShading';
import type { CornerHeights } from '../../terrain/tileCornerHeights';
import { faceBrightness, upwardTriangleNormal, LIGHTING_Z_SCALE, AMBIENT } from '../lighting';

const ch = (topH: number, rightH: number, bottomH: number, leftH: number): CornerHeights => ({
  topH, rightH, bottomH, leftH,
});

type Vec3 = [number, number, number];

const corner = (x: number, y: number, h: number): Vec3 =>
  [x, y, h * LIGHTING_Z_SCALE];

const brightnessOf = (a: Vec3, b: Vec3, c: Vec3): number =>
  faceBrightness(upwardTriangleNormal(a, b, c));

// Draw-time winding (matches DiamondTileVisual.ts):
//   TB West:   fillTri(bottom, left, top)   → corner(1,1,bH), corner(0,1,lH), corner(0,0,tH)
//   TB East:   fillTri(bottom, right, top)  → corner(1,1,bH), corner(1,0,rH), corner(0,0,tH)
//   LR North:  fillTri(left, top, right)    → corner(0,1,lH), corner(0,0,tH), corner(1,0,rH)
//   LR South:  fillTri(left, bottom, right) → corner(0,1,lH), corner(1,1,bH), corner(1,0,rH)

describe('planDiamondShading', () => {
  describe('flat tile (all corners equal)', () => {
    it('h=0 — no shading, no stroke', () => {
      const plan = planDiamondShading(ch(0, 0, 0, 0));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('h=5 — no shading, no stroke', () => {
      const plan = planDiamondShading(ch(5, 5, 5, 5));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
  });

  // Planar cardinal slopes — both halves shade equally, fold is fake (no stroke).
  // tbDiff = lrDiff = 1 → tie → TB split.
  describe('cardinal slopes (planar)', () => {
    it('slope_e — high W, low E', () => {
      // topH=2, rightH=1, bottomH=1, leftH=2 → tbDiff=1=lrDiff → TB
      // planar: 2+1 === 2+1
      const plan = planDiamondShading(ch(2, 1, 1, 2));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,1), corner(0,1,2), corner(0,0,2)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,1), corner(1,0,1), corner(0,0,2)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('slope_w — high E, low W', () => {
      const plan = planDiamondShading(ch(1, 2, 2, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,2), corner(0,1,1), corner(0,0,1)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,2), corner(1,0,2), corner(0,0,1)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('slope_n — high S, low N', () => {
      const plan = planDiamondShading(ch(1, 1, 2, 2));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,2), corner(0,1,2), corner(0,0,1)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,2), corner(1,0,1), corner(0,0,1)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('slope_s — high N, low S', () => {
      const plan = planDiamondShading(ch(2, 2, 1, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,1), corner(0,1,1), corner(0,0,2)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,1), corner(1,0,2), corner(0,0,2)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
  });

  // Diagonal-drop slopes — one corner dropped via a diagonal neighbor.
  // Non-planar → stroke. Adaptive split puts the dropped corner in ONE triangle
  // so only that triangle shades; the other stays at maxH.
  describe('diagonal-drop slopes (non-planar)', () => {
    it('slope_ne — rightH dropped → TB split, east shades, stroke', () => {
      // tbDiff=|2-2|=0, lrDiff=|2-1|=1 → TB
      const plan = planDiamondShading(ch(2, 1, 2, 2));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      // West triangle: bottom=(1,1,2), left=(0,1,2), top=(0,0,2) — all at max, brightness 1.0
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,2), corner(1,0,1), corner(0,0,2)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('slope_nw — topH dropped → LR split, north shades, stroke', () => {
      // tbDiff=|1-2|=1, lrDiff=|2-2|=0 → LR
      const plan = planDiamondShading(ch(1, 2, 2, 2));
      expect(plan.diagonal).toBe('lr');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBeCloseTo(brightnessOf(corner(0,1,2), corner(0,0,1), corner(1,0,2)), 9);
      // South triangle: left=(0,1,2), bottom=(1,1,2), right=(1,0,2) — all at max, brightness 1.0
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('slope_se — bottomH dropped → LR split, south shades, stroke', () => {
      const plan = planDiamondShading(ch(2, 2, 1, 2));
      expect(plan.diagonal).toBe('lr');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBe(1.0);
      // North triangle: left=(0,1,2), top=(0,0,2), right=(1,0,2) — all at max, brightness 1.0
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBeCloseTo(brightnessOf(corner(0,1,2), corner(1,1,1), corner(1,0,2)), 9);
    });
    it('slope_sw — leftH dropped → TB split, west shades, stroke', () => {
      const plan = planDiamondShading(ch(2, 2, 2, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,2), corner(0,1,1), corner(0,0,2)), 9);
      // East triangle: bottom=(1,1,2), right=(1,0,2), top=(0,0,2) — all at max, brightness 1.0
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
  });

  // Tents — one corner high, three corners low. Non-planar, both halves shade.
  // Adaptive split puts the fold PERPENDICULAR to the peak corner so the
  // peak ends up in one triangle (the other has 3 low corners).
  describe('tents (one-corner-high, non-planar)', () => {
    it('top-high (peak N) → LR split, both shade, stroke perpendicular to peak', () => {
      // tbDiff=|2-1|=1, lrDiff=|1-1|=0 → LR (fold runs L-R, peak above the line)
      const plan = planDiamondShading(ch(2, 1, 1, 1));
      expect(plan.diagonal).toBe('lr');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBeCloseTo(brightnessOf(corner(0,1,1), corner(0,0,2), corner(1,0,1)), 9);
      expect(plan.brightnessSouth).toBeCloseTo(brightnessOf(corner(0,1,1), corner(1,1,1), corner(1,0,1)), 9);
    });
    it('bottom-high (peak S) → LR split, both shade, stroke', () => {
      const plan = planDiamondShading(ch(1, 1, 2, 1));
      expect(plan.diagonal).toBe('lr');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBeCloseTo(brightnessOf(corner(0,1,1), corner(0,0,1), corner(1,0,1)), 9);
      expect(plan.brightnessSouth).toBeCloseTo(brightnessOf(corner(0,1,1), corner(1,1,2), corner(1,0,1)), 9);
    });
    it('left-high (peak W) → TB split, both shade, stroke', () => {
      // tbDiff=|1-1|=0, lrDiff=|2-1|=1 → TB
      const plan = planDiamondShading(ch(1, 1, 1, 2));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,1), corner(0,1,2), corner(0,0,1)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,1), corner(1,0,1), corner(0,0,1)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('right-high (peak E) → TB split, both shade, stroke', () => {
      const plan = planDiamondShading(ch(1, 2, 1, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,1), corner(0,1,1), corner(0,0,1)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,1), corner(1,0,2), corner(0,0,1)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
  });

  // Planar axis-aligned cliffs — 2-step drop along one cardinal direction.
  // Both halves shade strongly but the quad is still PLANAR so no stroke.
  describe('cliffs (planar 2-step drops)', () => {
    it('south-facing cliff (3,3,1,1) — TB tie, both shade, no stroke', () => {
      const plan = planDiamondShading(ch(3, 3, 1, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,1), corner(0,1,1), corner(0,0,3)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,1), corner(1,0,3), corner(0,0,3)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('north-facing cliff (1,1,3,3) — TB tie, both shade, no stroke', () => {
      const plan = planDiamondShading(ch(1, 1, 3, 3));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,3), corner(0,1,3), corner(0,0,1)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,3), corner(1,0,1), corner(0,0,1)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('east-facing cliff (3,1,1,3) — TB tie, both shade, no stroke', () => {
      const plan = planDiamondShading(ch(3, 1, 1, 3));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,1), corner(0,1,3), corner(0,0,3)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,1), corner(1,0,1), corner(0,0,3)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('west-facing cliff (1,3,3,1) — TB tie, both shade, no stroke', () => {
      const plan = planDiamondShading(ch(1, 3, 3, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,3), corner(0,1,1), corner(0,0,1)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,3), corner(1,0,3), corner(0,0,1)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
  });

  // Multi-drop rough cases — corner heights with mixed drops in several directions.
  // Non-planar → stroke. Per-triangle shading falls out of the brightness calculation.
  describe('rough / multi-drop tiles', () => {
    it('saddle (2,1,3,2) — TB tie picks TB, both halves shade, stroke', () => {
      // tbDiff=|2-3|=1, lrDiff=|2-1|=1 → tie → TB
      // non-planar: 2+3=5 ≠ 2+1=3
      const plan = planDiamondShading(ch(2, 1, 3, 2));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,3), corner(0,1,2), corner(0,0,2)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,3), corner(1,0,1), corner(0,0,2)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('two adjacent corners high (2,2,1,1) — same as slope_s (planar)', () => {
      const plan = planDiamondShading(ch(2, 2, 1, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(false);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,1), corner(0,1,1), corner(0,0,2)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,1), corner(1,0,2), corner(0,0,2)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('two opposite corners high (2,1,2,1) — planar saddle, both shade, no stroke', () => {
      // tbDiff=0, lrDiff=0 → TB
      // topH+bottomH = 2+2 = 4; leftH+rightH = 1+1 = 2. NOT planar → stroke.
      const plan = planDiamondShading(ch(2, 1, 2, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,2), corner(0,1,1), corner(0,0,2)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,2), corner(1,0,1), corner(0,0,2)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('three-corner ridge (2,2,2,1) — TB split, west shades only, stroke', () => {
      // Same as slope_sw. tbDiff=0, lrDiff=1 → TB.
      const plan = planDiamondShading(ch(2, 2, 2, 1));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,2), corner(0,1,1), corner(0,0,2)), 9);
      // East triangle: bottom=(1,1,2), right=(1,0,2), top=(0,0,2) — all at max, brightness 1.0
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
  });

  // Concave projection cases. The MIN-of-4 corner rule lets a vertex sink so
  // far below its neighbors that the projected polygon goes non-convex. For
  // those cases the smaller-diff diagonal can land OUTSIDE the polygon body —
  // shading would paint into neighbor tiles. The helper detects concavity and
  // overrides the diagonal to the one through the concave vertex.
  //
  // Iso-projection asymmetry: among single-corner-drop fixtures with the
  // others at MAX_ELEVATION, only topH/leftH/rightH drops yield concavity
  // (always at the bottom vertex — bottom is the iso-projection's natural
  // "interior" point when its peers lift while it stays at base offset).
  // bottomH=0 stays convex because bottom is already the southernmost vertex
  // and dropping it further can't create an inward dent.
  describe('concave projected quads (override smaller-diff)', () => {
    it('topH=0, others=8 (verified fixture from IsoTransform.test:307) → concave at bottom → TB override', () => {
      // smaller-diff would say LR (lrDiff=0 vs tbDiff=8) but LR lies outside.
      const plan = planDiamondShading(ch(0, 8, 8, 8));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,8), corner(0,1,8), corner(0,0,0)), 9);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,8), corner(1,0,8), corner(0,0,0)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('leftH=0, others=8 → concave at bottom → TB override, only west shades', () => {
      // smaller-diff would say TB anyway (tbDiff=0). Concavity confirms TB.
      // westMean has leftH=0; eastMean has all at 8 → east brightness = 1.0
      const plan = planDiamondShading(ch(8, 8, 8, 0));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBeCloseTo(brightnessOf(corner(1,1,8), corner(0,1,0), corner(0,0,8)), 9);
      // East triangle: bottom=(1,1,8), right=(1,0,8), top=(0,0,8) — all at max, brightness 1.0
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('rightH=0, others=8 → concave at bottom → TB override, only east shades', () => {
      // Mirror of leftH=0 case.
      const plan = planDiamondShading(ch(8, 0, 8, 8));
      expect(plan.diagonal).toBe('tb');
      expect(plan.strokeFold).toBe(true);
      // West triangle: bottom=(1,1,8), left=(0,1,8), top=(0,0,8) — all at max, brightness 1.0
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBeCloseTo(brightnessOf(corner(1,1,8), corner(1,0,0), corner(0,0,8)), 9);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('bottomH=0, others=8 → CONVEX (no override) → smaller-diff picks LR, only south shades', () => {
      // bottom is the southernmost vertex; dropping it further keeps polygon
      // convex (arrowhead shape). Falls through to smaller-diff: lrDiff=0,
      // tbDiff=8 → LR.
      const plan = planDiamondShading(ch(8, 8, 0, 8));
      expect(plan.diagonal).toBe('lr');
      expect(plan.strokeFold).toBe(true);
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBe(1.0);
      // North triangle: left=(0,1,8), top=(0,0,8), right=(1,0,8) — all at max, brightness 1.0
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBeCloseTo(brightnessOf(corner(0,1,8), corner(1,1,0), corner(1,0,8)), 9);
    });
  });

  // Determinism: tie-break is TB (matches the documented contract).
  describe('split tie-break', () => {
    it('all-equal corners → TB (degenerate flat case)', () => {
      const plan = planDiamondShading(ch(2, 2, 2, 2));
      expect(plan.diagonal).toBe('tb');
    });
    it('tbDiff === lrDiff (cardinal slope) → TB', () => {
      const plan = planDiamondShading(ch(2, 1, 1, 2));
      expect(plan.diagonal).toBe('tb');
    });
  });

  describe('lighting contract anchors (literal expectations)', () => {
    it('flat ch(1,1,1,1) — brightnessWest === 1.0 exact', () => {
      const plan = planDiamondShading(ch(1, 1, 1, 1));
      expect(plan.brightnessWest).toBe(1.0);
    });
    it('south-facing planar ch(2,2,1,1) — both triangles ≈ 0.8682', () => {
      // Light = (-1, 0, 1)/√2. Normal normalize([0, 1, 1]) = (0, 0.707, 0.707).
      // dot = 0 + 0 + 0.707·0.707 = 0.5; /FLAT_DOT = 0.5/0.707 = 0.707;
      // brightness = 0.55 + 0.45·0.707 = 0.8682.
      const plan = planDiamondShading(ch(2, 2, 1, 1));
      expect(plan.brightnessWest).toBeCloseTo(0.8682, 3);
      expect(plan.brightnessEast).toBeCloseTo(0.8682, 3);
    });
    it('north-facing planar ch(1,1,2,2) — both triangles ≈ 0.8682 (equal to south under y=0 light)', () => {
      // Normal normalize([0, -1, 1]) = (0, -0.707, 0.707).
      // dot = 0 + 0 + 0.707·0.707 = 0.5 (same as south case — the y component is
      // multiplied by light.y = 0, so sign flip on y doesn't change the result).
      // Brightness identical to south-facing fixture above.
      const plan = planDiamondShading(ch(1, 1, 2, 2));
      expect(plan.brightnessWest).toBeCloseTo(0.8682, 3);
      expect(plan.brightnessEast).toBeCloseTo(0.8682, 3);
    });
  });

  describe('light-direction sanity (W-facing > E-facing, N === S)', () => {
    it('N-facing ch(1,1,2,2) === S-facing ch(2,2,1,1) (light.y = 0 → N/S collapse)', () => {
      const north = planDiamondShading(ch(1, 1, 2, 2));
      const south = planDiamondShading(ch(2, 2, 1, 1));
      expect(north.brightnessWest).toBeCloseTo(south.brightnessWest, 9);
      expect(north.brightnessEast).toBeCloseTo(south.brightnessEast, 9);
    });
    it('west-slope ch(1,2,2,1) brighter than east-slope ch(2,1,1,2)', () => {
      const west = planDiamondShading(ch(1, 2, 2, 1));
      const east = planDiamondShading(ch(2, 1, 1, 2));
      // west-slope has lower topH/bottomH so triangles face NW; east-slope faces SE
      expect(west.brightnessWest).toBeGreaterThan(east.brightnessWest);
    });
    it('planar same-normal ch(2,1,1,2) — brightnessWest === brightnessEast (strict)', () => {
      // Both triangles share the same planar normal → identical brightness
      const plan = planDiamondShading(ch(2, 1, 1, 2));
      expect(plan.brightnessWest).toBe(plan.brightnessEast);
    });
    it('flat symmetry ch(1,1,1,1) — all four brightness === 1.0', () => {
      const plan = planDiamondShading(ch(1, 1, 1, 1));
      expect(plan.brightnessWest).toBe(1.0);
      expect(plan.brightnessEast).toBe(1.0);
      expect(plan.brightnessNorth).toBe(1.0);
      expect(plan.brightnessSouth).toBe(1.0);
    });
    it('top-peak tent ch(2,1,1,1) — brightnessSouth > brightnessNorth; brightnessNorth === AMBIENT', () => {
      // LR split. North triangle contains the top peak; normal faces SE → lambert=0 → AMBIENT.
      // South triangle has all-low corners → flat-ish normal → brightness = 1.0.
      const plan = planDiamondShading(ch(2, 1, 1, 1));
      expect(plan.brightnessSouth).toBeGreaterThan(plan.brightnessNorth);
      expect(plan.brightnessNorth).toBeCloseTo(AMBIENT, 9);
    });
    it('bottom-peak tent ch(1,1,2,1) — both brightnessNorth and brightnessSouth ≈ 1.0', () => {
      // South triangle: normal has z-flip applied → NW-up → fully lit (clamped to 1.0).
      // North triangle: all-low corners → flat normal → 1.0.
      const plan = planDiamondShading(ch(1, 1, 2, 1));
      expect(plan.brightnessNorth).toBeCloseTo(1.0, 9);
      expect(plan.brightnessSouth).toBeCloseTo(1.0, 9);
    });
  });
});
