import { describe, it, expect } from 'vitest';
import { SHADOW_COLOR, SHADOW_ALPHA, cubeShadowPolygon } from './cubeDropShadow';
import { cubeFacePolygons } from './cubeGeometry';

describe('cubeDropShadow', () => {
  it('SHADOW_COLOR is 0x000000', () => {
    expect(SHADOW_COLOR).toBe(0x000000);
  });

  it('SHADOW_ALPHA is 0.25', () => {
    expect(SHADOW_ALPHA).toBe(0.25);
  });

  // Fixture A: full-width synthetic, mainLift = 40
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

  it('fixture A: mainLift = 40 → shadow at ground level [{0,-16},{32,0},{0,16},{-32,0}]', () => {
    const out = cubeShadowPolygon(facesA);
    expect(out[0]).toEqual({x:0,y:-16});
    expect(out[1]).toEqual({x:32,y:0});
    expect(out[2]).toEqual({x:0,y:16});
    expect(out[3]).toEqual({x:-32,y:0});
  });

  it('fixture B: mainLift = 40, inset=0.125 stand-in → [{0,-12},{24,0},{0,12},{-24,0}]', () => {
    const out = cubeShadowPolygon(facesB);
    expect(out[0]).toEqual({x:0,y:-12});
    expect(out[1]).toEqual({x:24,y:0});
    expect(out[2]).toEqual({x:0,y:12});
    expect(out[3]).toEqual({x:-24,y:0});
  });

  it('source-aligned live test: cubeFacePolygons commercial level 3', () => {
    const faces = cubeFacePolygons('commercial', 3, 1, [{x:0,y:0}], {x:0,y:0});
    expect(faces).not.toBeNull();
    const f = faces!;
    const out = cubeShadowPolygon(f);

    expect(out.length).toBe(4);

    // shadow center Y = base-plane Y (not top center Y)
    const basePlaneY = (f.left[2].y + f.right[3].y) / 2;
    const shadowCenterY = (out[0].y + out[2].y) / 2;
    expect(shadowCenterY).toBeCloseTo(basePlaneY, 6);

    // ISO 2:1 ratio preserved — toBeCloseTo because real geometry has float rounding
    const ratio = (out[1].x - out[3].x) / (out[2].y - out[0].y);
    expect(ratio).toBeCloseTo(2, 6);
  });

  it('vertex count invariant: output.length === 4 for all fixtures', () => {
    expect(cubeShadowPolygon(facesA).length).toBe(4);
    expect(cubeShadowPolygon(facesB).length).toBe(4);
    const faces = cubeFacePolygons('commercial', 3, 1, [{x:0,y:0}], {x:0,y:0})!;
    expect(cubeShadowPolygon(faces).length).toBe(4);
  });

  it('Y placement is the un-lifted base: center Y ≈ 0 for fixtures A and B', () => {
    const outA = cubeShadowPolygon(facesA);
    expect((outA[0].y + outA[2].y) / 2).toBeCloseTo(0, 6);
    expect((outA[1].y + outA[3].y) / 2).toBeCloseTo(0, 6);

    const outB = cubeShadowPolygon(facesB);
    expect((outB[0].y + outB[2].y) / 2).toBeCloseTo(0, 6);
    expect((outB[1].y + outB[3].y) / 2).toBeCloseTo(0, 6);
  });

  it('ISO 2:1 ratio preserved for hand-built fixtures', () => {
    const outA = cubeShadowPolygon(facesA);
    expect((outA[1].x - outA[3].x) / (outA[2].y - outA[0].y)).toBe(2);

    const outB = cubeShadowPolygon(facesB);
    expect((outB[1].x - outB[3].x) / (outB[2].y - outB[0].y)).toBe(2);
  });

  it('south vertex matches faces.left[3] and faces.right[2] for hand-built fixtures', () => {
    const outA = cubeShadowPolygon(facesA);
    expect(outA[2].x).toBe(facesA.left[3].x);
    expect(outA[2].y).toBe(facesA.left[3].y);
    expect(outA[2].x).toBe(facesA.right[2].x);
    expect(outA[2].y).toBe(facesA.right[2].y);

    const outB = cubeShadowPolygon(facesB);
    expect(outB[2].x).toBe(facesB.left[3].x);
    expect(outB[2].y).toBe(facesB.left[3].y);
    expect(outB[2].x).toBe(facesB.right[2].x);
    expect(outB[2].y).toBe(facesB.right[2].y);
  });

  it('mainLift = 0 degenerate: output equals top diamond unchanged', () => {
    const facesZeroLift = {
      top:   [{x:0,y:-16},{x:32,y:0},{x:0,y:16},{x:-32,y:0}],
      left:  [{x:0,y:16},{x:-32,y:0},{x:-32,y:0},{x:0,y:16}],  // base at same Y as top base
      right: [{x:32,y:0},{x:0,y:16},{x:0,y:16},{x:32,y:0}],
    };
    // mainLift = left[2].y - left[1].y = 0 - 0 = 0
    const out = cubeShadowPolygon(facesZeroLift);
    expect(out[0]).toEqual({x:0,y:-16});
    expect(out[1]).toEqual({x:32,y:0});
    expect(out[2]).toEqual({x:0,y:16});
    expect(out[3]).toEqual({x:-32,y:0});
  });
});
