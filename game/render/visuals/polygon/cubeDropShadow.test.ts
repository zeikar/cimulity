import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import { SHADOW_COLOR, SHADOW_ALPHA, SHADOW_MIN_LENGTH, cubeShadowPolygon } from './cubeDropShadow';
import { shadowOffsetScreen } from '../lighting';
import { ELEVATION_HEIGHT } from '@/game/core';
import { cubeFacePolygons } from './cubeGeometry';
import { SHADOW_Z_OFFSET, CubeBuildingVisual } from './CubeBuildingVisual';

// Per-test helper mirroring cubeDropShadow's derivation: shadow offset for a given
// mainLift, derived from shadowOffsetScreen with magnitude-clamped to SHADOW_MIN_LENGTH.
const expectedOffset = (mainLift: number): { ox: number; oy: number } => {
  const unit = shadowOffsetScreen(1);
  const z = mainLift / ELEVATION_HEIGHT;
  const unitLen = Math.hypot(unit.dx, unit.dy);
  const finalLen = Math.max(SHADOW_MIN_LENGTH, unitLen * z);
  const scale = finalLen / unitLen;
  return { ox: unit.dx * scale, oy: unit.dy * scale };
};

describe('cubeDropShadow', () => {
  it('SHADOW_COLOR is 0x000000', () => {
    expect(SHADOW_COLOR).toBe(0x000000);
  });

  it('SHADOW_ALPHA is 0.35', () => {
    expect(SHADOW_ALPHA).toBe(0.35);
  });

  it('shadow direction tracks LIGHT_DIR_WORLD via shadowOffsetScreen (2:1 iso aspect for current pure-west light)', () => {
    // The cube polygon offset is derived from shadowOffsetScreen(z); for the current
    // LIGHT_DIR_WORLD = (-1, 0, 1) the projected direction is pure SE with dy = dx/2.
    const unit = shadowOffsetScreen(1);
    expect(unit.dx).toBeGreaterThan(0);
    expect(unit.dy).toBeCloseTo(unit.dx / 2, 9);
  });

  it('SHADOW_MIN_LENGTH is 4 (length floor so low cubes still cast a visible shadow)', () => {
    expect(SHADOW_MIN_LENGTH).toBe(4);
  });

  // Fixture A: full-width synthetic, mainLift = 40, un-inset base half-spans X=32 Y=16 at center y=0
  const facesA = {
    top:   [{x:0,y:-56},{x:32,y:-40},{x:0,y:-24},{x:-32,y:-40}],
    left:  [{x:0,y:-24},{x:-32,y:-40},{x:-32,y:0},{x:0,y:16}],
    right: [{x:32,y:-40},{x:0,y:-24},{x:0,y:16},{x:32,y:0}],
  };

  // Fixture B: commercial-style inset=0.125 (integer-friendly stand-in for live commercial 0.12), mainLift = 40
  const facesB = {
    top:   [{x:0,y:-52},{x:24,y:-40},{x:0,y:-28},{x:-24,y:-40}],
    left:  [{x:0,y:-28},{x:-24,y:-40},{x:-24,y:0},{x:0,y:12}],
    right: [{x:24,y:-40},{x:0,y:-28},{x:0,y:12},{x:24,y:0}],
  };

  it('fixture A (mainLift=40, factor 0.22 → 8.8 X, 4.4 Y): base diamond translated south-east, length proportional to lift', () => {
    const out = cubeShadowPolygon(facesA);
    const ox = 40 * 0.22;  // 8.8
    const oy = ox / 2;     // 4.4
    expect(out[0].x).toBeCloseTo(0 + ox, 6);
    expect(out[0].y).toBeCloseTo(-16 + oy, 6);
    expect(out[1].x).toBeCloseTo(32 + ox, 6);
    expect(out[1].y).toBeCloseTo(0 + oy, 6);
    expect(out[2].x).toBeCloseTo(0 + ox, 6);
    expect(out[2].y).toBeCloseTo(16 + oy, 6);
    expect(out[3].x).toBeCloseTo(-32 + ox, 6);
    expect(out[3].y).toBeCloseTo(0 + oy, 6);
  });

  it('fixture B (12% inset, mainLift=40): inset base diamond translated by lift-proportional offset', () => {
    const out = cubeShadowPolygon(facesB);
    const ox = 40 * 0.22;
    const oy = ox / 2;
    expect(out[0].x).toBeCloseTo(0 + ox, 6);
    expect(out[0].y).toBeCloseTo(-12 + oy, 6);
    expect(out[1].x).toBeCloseTo(24 + ox, 6);
    expect(out[2].y).toBeCloseTo(12 + oy, 6);
    expect(out[3].x).toBeCloseTo(-24 + ox, 6);
  });

  it('low-lift clamp: natural shadow length < SHADOW_MIN_LENGTH falls back to min-length floor along light direction', () => {
    // mainLift = 5 → z ≈ 0.42 → natural length ≈ 2.95·0.42 = 1.23 px, clamped UP to 4
    // px along the unit direction (0.894, 0.447) → (3.578, 1.789) px screen offset.
    const facesLow = {
      top:   [{x:0,y:-21},{x:32,y:-5},{x:0,y:11},{x:-32,y:-5}],
      left:  [{x:0,y:11},{x:-32,y:-5},{x:-32,y:0},{x:0,y:16}],   // left[2].y - left[1].y = 0 - (-5) = 5
      right: [{x:32,y:-5},{x:0,y:11},{x:0,y:16},{x:32,y:0}],
    };
    const out = cubeShadowPolygon(facesLow);
    const { ox, oy } = expectedOffset(5);
    expect(out[0].x).toBeCloseTo(0 + ox, 6);
    expect(out[0].y).toBeCloseTo(-21 + 5 + oy, 6);   // top[0].y + mainLift + oy
  });

  it('source-aligned live test: cubeFacePolygons commercial level 3', () => {
    const faces = cubeFacePolygons('commercial', 3, 1, [{x:0,y:0}], {x:0,y:0});
    expect(faces).not.toBeNull();
    const f = faces!;
    const out = cubeShadowPolygon(f);

    expect(out.length).toBe(4);

    const mainLift = f.left[2].y - f.left[1].y;
    const { ox: expectedOX, oy: expectedOY } = expectedOffset(mainLift);

    // Shadow center Y = base-plane Y + expected offset
    const basePlaneY = (f.left[2].y + f.right[3].y) / 2;
    const shadowCenterY = (out[0].y + out[2].y) / 2;
    expect(shadowCenterY).toBeCloseTo(basePlaneY + expectedOY, 6);

    // Shadow center X = top center X + expected offset
    const topCenterX = (f.top[1].x + f.top[3].x) / 2;
    const shadowCenterX = (out[1].x + out[3].x) / 2;
    expect(shadowCenterX).toBeCloseTo(topCenterX + expectedOX, 6);

    // ISO 2:1 ratio preserved (translation does not skew shape)
    const ratio = (out[1].x - out[3].x) / (out[2].y - out[0].y);
    expect(ratio).toBeCloseTo(2, 6);
  });

  it('vertex count invariant: output.length === 4 for all fixtures', () => {
    expect(cubeShadowPolygon(facesA).length).toBe(4);
    expect(cubeShadowPolygon(facesB).length).toBe(4);
    const faces = cubeFacePolygons('commercial', 3, 1, [{x:0,y:0}], {x:0,y:0})!;
    expect(cubeShadowPolygon(faces).length).toBe(4);
  });

  it('shadow centroid is base centroid translated by (offsetX, offsetX/2) where offsetX scales with mainLift', () => {
    for (const f of [facesA, facesB]) {
      const out = cubeShadowPolygon(f);
      const mainLift = f.left[2].y - f.left[1].y;
      const { ox: expectedOX, oy: expectedOY } = expectedOffset(mainLift);
      const baseCx = (f.top[0].x + f.top[1].x + f.top[2].x + f.top[3].x) / 4;
      const baseCy = (f.left[2].y + f.right[3].y) / 2;
      const outCx = (out[1].x + out[3].x) / 2;
      const outCy = (out[0].y + out[2].y) / 2;
      expect(outCx).toBeCloseTo(baseCx + expectedOX, 6);
      expect(outCy).toBeCloseTo(baseCy + expectedOY, 6);
    }
  });

  it('ISO 2:1 ratio preserved for hand-built fixtures (translation does not skew aspect)', () => {
    const outA = cubeShadowPolygon(facesA);
    expect((outA[1].x - outA[3].x) / (outA[2].y - outA[0].y)).toBeCloseTo(2, 6);

    const outB = cubeShadowPolygon(facesB);
    expect((outB[1].x - outB[3].x) / (outB[2].y - outB[0].y)).toBeCloseTo(2, 6);
  });

  it('shadow is congruent to the inset base diamond: span equals base span (no scaling)', () => {
    for (const f of [facesA, facesB]) {
      const baseSpanX = (f.top[1].x - f.top[3].x) / 2;
      const baseSpanY = (f.top[2].y - f.top[0].y) / 2;
      const out = cubeShadowPolygon(f);
      const shadowSpanX = (out[1].x - out[3].x) / 2;
      const shadowSpanY = (out[2].y - out[0].y) / 2;
      expect(shadowSpanX).toBeCloseTo(baseSpanX, 6);
      expect(shadowSpanY).toBeCloseTo(baseSpanY, 6);
    }
  });

  it('mainLift = 0 degenerate: SHADOW_MIN_LENGTH floor applies, shadow stays at top diamond plane', () => {
    const facesZeroLift = {
      top:   [{x:0,y:-16},{x:32,y:0},{x:0,y:16},{x:-32,y:0}],
      left:  [{x:0,y:16},{x:-32,y:0},{x:-32,y:0},{x:0,y:16}],
      right: [{x:32,y:0},{x:0,y:16},{x:0,y:16},{x:32,y:0}],
    };
    const out = cubeShadowPolygon(facesZeroLift);
    const { ox, oy } = expectedOffset(0);
    expect(out[0].x).toBeCloseTo(0 + ox, 6);
    expect(out[0].y).toBeCloseTo(-16 + oy, 6);
    expect(out[1].x).toBeCloseTo(32 + ox, 6);
    expect(out[1].y).toBeCloseTo(0 + oy, 6);
    expect(out[2].x).toBeCloseTo(0 + ox, 6);
    expect(out[2].y).toBeCloseTo(16 + oy, 6);
    expect(out[3].x).toBeCloseTo(-32 + ox, 6);
    expect(out[3].y).toBeCloseTo(0 + oy, 6);
  });

  // --- Multi-cell (W×H) coverage ---

  it('4×2 commercial L=5 D=2: shadow has 4 vertices, each vertex numerically pinned', () => {
    // Build a 4×2 footprint with anchor at (0,0).
    const fp: { x: number; y: number }[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) fp.push({ x, y });
    const anchor = { x: 0, y: 0 };
    const faces = cubeFacePolygons('commercial', 5, 2, fp, anchor)!;
    const out = cubeShadowPolygon(faces);

    expect(out.length).toBe(4);

    // Pinned values derived by running cubeFacePolygons + cubeShadowPolygon once
    // and recording the output (see task derivation script).
    expect(out[0].x).toBeCloseTo(32.32, 6);
    expect(out[0].y).toBeCloseTo(23.84, 6);
    expect(out[1].x).toBeCloseTo(129.6, 6);
    expect(out[1].y).toBeCloseTo(72.48, 6);
    expect(out[2].x).toBeCloseTo(80.96, 6);
    expect(out[2].y).toBeCloseTo(96.8, 6);
    expect(out[3].x).toBeCloseTo(-16.32, 6);
    expect(out[3].y).toBeCloseTo(48.16, 6);
  });

  it('4×1 vs 1×4 commercial L=3 D=1: shadows are different polygons (asymmetric silhouette)', () => {
    const anchor = { x: 0, y: 0 };

    const fp4x1: { x: number; y: number }[] = [];
    for (let x = 0; x < 4; x++) fp4x1.push({ x, y: 0 });
    const faces4x1 = cubeFacePolygons('commercial', 3, 1, fp4x1, anchor)!;
    const shadow4x1 = cubeShadowPolygon(faces4x1);

    const fp1x4: { x: number; y: number }[] = [];
    for (let y = 0; y < 4; y++) fp1x4.push({ x: 0, y });
    const faces1x4 = cubeFacePolygons('commercial', 3, 1, fp1x4, anchor)!;
    const shadow1x4 = cubeShadowPolygon(faces1x4);

    // The two shadows must differ — 4×1 and 1×4 have different parallelogram shapes.
    const same = shadow4x1.every(
      (v, i) => Math.abs(v.x - shadow1x4[i].x) < 1e-9 && Math.abs(v.y - shadow1x4[i].y) < 1e-9,
    );
    expect(same).toBe(false);
  });

  it('1×1 commercial L=3 D=1 regression: shadow vertices match expected single-cube values', () => {
    const anchor = { x: 0, y: 0 };
    const faces = cubeFacePolygons('commercial', 3, 1, [{ x: 0, y: 0 }], anchor)!;
    const out = cubeShadowPolygon(faces);

    expect(out.length).toBe(4);

    // Pinned single-cube expected values — must not regress when multi-cell path changes.
    expect(out[0].x).toBeCloseTo(17.16, 6);
    expect(out[0].y).toBeCloseTo(12.42, 6);
    expect(out[1].x).toBeCloseTo(41.48, 6);
    expect(out[1].y).toBeCloseTo(24.58, 6);
    expect(out[2].x).toBeCloseTo(17.16, 6);
    expect(out[2].y).toBeCloseTo(36.74, 6);
    expect(out[3].x).toBeCloseTo(-7.16, 6);
    expect(out[3].y).toBeCloseTo(24.58, 6);
  });

  // SHADOW_Z_OFFSET invariant: shadow Graphics draw before all face Graphics in the building layer.
  // The building layer uses sortableChildren=true; shadows get SHADOW_Z_OFFSET + computeZIndex,
  // faces get computeZIndex alone — so every shadow zIndex is strictly less than every face zIndex.
  describe('SHADOW_Z_OFFSET: shadow zIndex is always below any face zIndex', () => {
    it('SHADOW_Z_OFFSET is a large negative constant', () => {
      expect(SHADOW_Z_OFFSET).toBe(-1_000_000);
      expect(SHADOW_Z_OFFSET).toBeLessThan(-1000);
    });

    it('SHADOW_Z_OFFSET + computeZIndex < computeZIndex for extreme plausible values', () => {
      // computeZIndex = depth*1000 + tiebreakY; max plausible on a 256×256 map ≈ 512*1000+256 = 512256
      const maxPlausibleFacesZIndex = 512_256;
      const shadowZIndex = SHADOW_Z_OFFSET + maxPlausibleFacesZIndex;
      expect(shadowZIndex).toBeLessThan(maxPlausibleFacesZIndex);

      // Also check the minimum (negative depth tiles near origin)
      const minPlausibleFacesZIndex = -512_256;
      const shadowZIndexMin = SHADOW_Z_OFFSET + minPlausibleFacesZIndex;
      expect(shadowZIndexMin).toBeLessThan(minPlausibleFacesZIndex);
    });
  });

  // Lifecycle regression: TileRenderer must call CubeBuildingVisual.unmount() (not displayObject.destroy()
  // directly) so the shadow sibling is also cleaned up. Pinned here at the visual layer so future changes
  // to mount() that add more sibling Graphics get matching unmount() coverage by construction.
  describe('CubeBuildingVisual mount/unmount lifecycle (shadow sibling cleanup)', () => {
    const baseInput = {
      buildingId: 1,
      type: 'residential' as const,
      anchor: { x: 0, y: 0 },
      footprint: [{ x: 0, y: 0 }],
      density: 0 as 0 | 1 | 2,
      frontage: 'S' as const,
    };

    it('mount adds two children (faces + shadow) when level > 0; unmount removes both', () => {
      const visual = new CubeBuildingVisual();
      const parent = new Container();
      const facesGfx = visual.mount({ ...baseInput, level: 1 }, parent);

      expect(parent.children.length).toBe(2);

      visual.unmount(facesGfx);
      expect(parent.children.length).toBe(0);

      visual.dispose();
    });

    it('mount at level 0 adds only the placeholder faces Graphics (no shadow); unmount removes it cleanly', () => {
      const visual = new CubeBuildingVisual();
      const parent = new Container();
      const facesGfx = visual.mount({ ...baseInput, level: 0 }, parent);

      expect(parent.children.length).toBe(1);

      visual.unmount(facesGfx);
      expect(parent.children.length).toBe(0);

      visual.dispose();
    });
  });
});
