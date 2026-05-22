import { describe, it, expect } from 'vitest';
import { planDiamondShading, type ShadingPlan } from './diamondShading';
import type { CornerHeights } from '../../terrain/tileCornerHeights';

const ch = (topH: number, rightH: number, bottomH: number, leftH: number): CornerHeights => ({
  topH, rightH, bottomH, leftH,
});

const tb = (shadeWest: boolean, shadeEast: boolean, strokeFold: boolean): ShadingPlan => ({
  diagonal: 'tb',
  shadeWest, shadeEast,
  shadeNorth: false, shadeSouth: false,
  strokeFold,
});

const lr = (shadeNorth: boolean, shadeSouth: boolean, strokeFold: boolean): ShadingPlan => ({
  diagonal: 'lr',
  shadeWest: false, shadeEast: false,
  shadeNorth, shadeSouth,
  strokeFold,
});

describe('planDiamondShading', () => {
  describe('flat tile (all corners equal)', () => {
    it('h=0 — no shading, no stroke', () => {
      expect(planDiamondShading(ch(0, 0, 0, 0))).toEqual(tb(false, false, false));
    });
    it('h=5 — no shading, no stroke', () => {
      expect(planDiamondShading(ch(5, 5, 5, 5))).toEqual(tb(false, false, false));
    });
  });

  // Planar cardinal slopes — both halves shade equally, fold is fake (no stroke).
  // tbDiff = lrDiff = 1 → tie → TB split.
  describe('cardinal slopes (planar)', () => {
    it('slope_e — high W, low E', () => {
      // topH=2, rightH=1, bottomH=1, leftH=2 → tbDiff=1=lrDiff → TB
      // westMean=(1+2+2)/3=5/3<2; eastMean=(1+1+2)/3=4/3<2 → both shade
      // planar: 2+1 === 2+1
      expect(planDiamondShading(ch(2, 1, 1, 2))).toEqual(tb(true, true, false));
    });
    it('slope_w — high E, low W', () => {
      expect(planDiamondShading(ch(1, 2, 2, 1))).toEqual(tb(true, true, false));
    });
    it('slope_n — high S, low N', () => {
      expect(planDiamondShading(ch(1, 1, 2, 2))).toEqual(tb(true, true, false));
    });
    it('slope_s — high N, low S', () => {
      expect(planDiamondShading(ch(2, 2, 1, 1))).toEqual(tb(true, true, false));
    });
  });

  // Diagonal-drop slopes — one corner dropped via a diagonal neighbor.
  // Non-planar → stroke. Adaptive split puts the dropped corner in ONE triangle
  // so only that triangle shades; the other stays at maxH.
  describe('diagonal-drop slopes (non-planar)', () => {
    it('slope_ne — rightH dropped → TB split, east shades, stroke', () => {
      // tbDiff=|2-2|=0, lrDiff=|2-1|=1 → TB
      // westMean=(2+2+2)/3=2 (=maxH, no shade); eastMean=(2+1+2)/3=5/3<2 (shade)
      expect(planDiamondShading(ch(2, 1, 2, 2))).toEqual(tb(false, true, true));
    });
    it('slope_nw — topH dropped → LR split, north shades, stroke', () => {
      // tbDiff=|1-2|=1, lrDiff=|2-2|=0 → LR
      expect(planDiamondShading(ch(1, 2, 2, 2))).toEqual(lr(true, false, true));
    });
    it('slope_se — bottomH dropped → LR split, south shades, stroke', () => {
      expect(planDiamondShading(ch(2, 2, 1, 2))).toEqual(lr(false, true, true));
    });
    it('slope_sw — leftH dropped → TB split, west shades, stroke', () => {
      expect(planDiamondShading(ch(2, 2, 2, 1))).toEqual(tb(true, false, true));
    });
  });

  // Tents — one corner high, three corners low. Non-planar, both halves shade.
  // Adaptive split puts the fold PERPENDICULAR to the peak corner so the
  // peak ends up in one triangle (the other has 3 low corners).
  describe('tents (one-corner-high, non-planar)', () => {
    it('top-high (peak N) → LR split, both shade, stroke perpendicular to peak', () => {
      // tbDiff=|2-1|=1, lrDiff=|1-1|=0 → LR (fold runs L-R, peak above the line)
      // northMean=(1+2+1)/3=4/3<2; southMean=(1+1+1)/3=1<2 → both shade
      expect(planDiamondShading(ch(2, 1, 1, 1))).toEqual(lr(true, true, true));
    });
    it('bottom-high (peak S) → LR split, both shade, stroke', () => {
      expect(planDiamondShading(ch(1, 1, 2, 1))).toEqual(lr(true, true, true));
    });
    it('left-high (peak W) → TB split, both shade, stroke', () => {
      // tbDiff=|1-1|=0, lrDiff=|2-1|=1 → TB
      expect(planDiamondShading(ch(1, 1, 1, 2))).toEqual(tb(true, true, true));
    });
    it('right-high (peak E) → TB split, both shade, stroke', () => {
      expect(planDiamondShading(ch(1, 2, 1, 1))).toEqual(tb(true, true, true));
    });
  });

  // Planar axis-aligned cliffs — 2-step drop along one cardinal direction.
  // Both halves shade strongly but the quad is still PLANAR so no stroke.
  describe('cliffs (planar 2-step drops)', () => {
    it('south-facing cliff (3,3,1,1) — TB tie, both shade, no stroke', () => {
      expect(planDiamondShading(ch(3, 3, 1, 1))).toEqual(tb(true, true, false));
    });
    it('north-facing cliff (1,1,3,3) — TB tie, both shade, no stroke', () => {
      expect(planDiamondShading(ch(1, 1, 3, 3))).toEqual(tb(true, true, false));
    });
    it('east-facing cliff (3,1,1,3) — TB tie, both shade, no stroke', () => {
      expect(planDiamondShading(ch(3, 1, 1, 3))).toEqual(tb(true, true, false));
    });
    it('west-facing cliff (1,3,3,1) — TB tie, both shade, no stroke', () => {
      expect(planDiamondShading(ch(1, 3, 3, 1))).toEqual(tb(true, true, false));
    });
  });

  // Multi-drop rough cases — corner heights with mixed drops in several directions.
  // Non-planar → stroke. Per-triangle shading falls out of the mean predicate.
  describe('rough / multi-drop tiles', () => {
    it('saddle (2,1,3,2) — TB tie picks TB, both halves shade, stroke', () => {
      // tbDiff=|2-3|=1, lrDiff=|2-1|=1 → tie → TB
      // westMean=(3+2+2)/3=7/3<3; eastMean=(3+1+2)/3=2<3 → both shade
      // non-planar: 2+3=5 ≠ 2+1=3
      expect(planDiamondShading(ch(2, 1, 3, 2))).toEqual(tb(true, true, true));
    });
    it('two adjacent corners high (2,2,1,1) — same as slope_s (planar)', () => {
      expect(planDiamondShading(ch(2, 2, 1, 1))).toEqual(tb(true, true, false));
    });
    it('two opposite corners high (2,1,2,1) — planar saddle, both shade, no stroke', () => {
      // tbDiff=0, lrDiff=0 → TB
      // westMean=(2+1+2)/3=5/3<2; eastMean=(2+1+2)/3=5/3<2 → both shade
      // planar: 2+2=4 === 1+1=2? NO, 4 ≠ 2. Wait that's non-planar.
      // Recompute: topH+bottomH = 2+2 = 4; leftH+rightH = 1+1 = 2. NOT planar → stroke.
      expect(planDiamondShading(ch(2, 1, 2, 1))).toEqual(tb(true, true, true));
    });
    it('three-corner ridge (2,2,2,1) — TB split, west shades only, stroke', () => {
      // Same as slope_sw. tbDiff=0, lrDiff=1 → TB.
      expect(planDiamondShading(ch(2, 2, 2, 1))).toEqual(tb(true, false, true));
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
      // TB: westMean=eastMean=(8+8+0)/3=16/3<8 → both shade.
      expect(planDiamondShading(ch(0, 8, 8, 8))).toEqual(tb(true, true, true));
    });
    it('leftH=0, others=8 → concave at bottom → TB override, only west shades', () => {
      // smaller-diff would say TB anyway (tbDiff=0). Concavity confirms TB.
      // westMean=(8+0+8)/3=16/3<8; eastMean=(8+8+8)/3=8 (maxH) → only west shades.
      expect(planDiamondShading(ch(8, 8, 8, 0))).toEqual(tb(true, false, true));
    });
    it('rightH=0, others=8 → concave at bottom → TB override, only east shades', () => {
      // Mirror of leftH=0 case. eastMean=16/3<8; westMean=8 (maxH).
      expect(planDiamondShading(ch(8, 0, 8, 8))).toEqual(tb(false, true, true));
    });
    it('bottomH=0, others=8 → CONVEX (no override) → smaller-diff picks LR, only south shades', () => {
      // bottom is the southernmost vertex; dropping it further keeps polygon
      // convex (arrowhead shape). Falls through to smaller-diff: lrDiff=0,
      // tbDiff=8 → LR. northMean=8=maxH (no shade); southMean=(8+0+8)/3<8.
      expect(planDiamondShading(ch(8, 8, 0, 8))).toEqual(lr(false, true, true));
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
});
