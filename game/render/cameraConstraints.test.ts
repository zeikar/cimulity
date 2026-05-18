import { describe, it, expect } from 'vitest';
import { mapWorldExtent, cameraBounds, centerOffset } from './cameraConstraints';

describe('mapWorldExtent', () => {
  it('returns correct bounds for a 64×64 map', () => {
    expect(mapWorldExtent(64, 64)).toEqual({
      minX: -2048,
      maxX: 2048,
      minY: 0,
      maxY: 2048,
    });
  });

  it('returns correct bounds for a rectangular 32×16 map', () => {
    expect(mapWorldExtent(32, 16)).toEqual({
      minX: -512,
      maxX: 1024,
      minY: 0,
      maxY: 768,
    });
  });
});

describe('cameraBounds', () => {
  const extent64 = { minX: -2048, maxX: 2048, minY: 0, maxY: 2048 };

  it('64×64 map at z=0.25, 1280×720 viewport', () => {
    expect(cameraBounds(extent64, 1280, 720, 0.25)).toEqual({
      minX: -512,
      maxX: 1792,
      minY: -512,
      maxY: 720,
    });
  });

  it('64×64 map at z=1, 1280×720 viewport', () => {
    expect(cameraBounds(extent64, 1280, 720, 1)).toEqual({
      minX: -2048,
      maxX: 3328,
      minY: -2048,
      maxY: 720,
    });
  });

  it('64×64 map at z=2, 1280×720 viewport', () => {
    expect(cameraBounds(extent64, 1280, 720, 2)).toEqual({
      minX: -4096,
      maxX: 5376,
      minY: -4096,
      maxY: 720,
    });
  });

  it('32×16 map at z=1, 1280×720 viewport', () => {
    // minX = -1024*1 = -1024, maxX = 1280 - (-512)*1 = 1792
    // minY = -768*1 = -768,   maxY = 720 - 0*1 = 720
    const extent32x16 = { minX: -512, maxX: 1024, minY: 0, maxY: 768 };
    expect(cameraBounds(extent32x16, 1280, 720, 1)).toEqual({
      minX: -1024,
      maxX: 1792,
      minY: -768,
      maxY: 720,
    });
  });
});

describe('centerOffset', () => {
  const extent64 = { minX: -2048, maxX: 2048, minY: 0, maxY: 2048 };

  it('64×64 map at z=1, 1280×720 viewport', () => {
    // midX=0, midY=1024 → x=640-0=640, y=360-1024=-664
    expect(centerOffset(extent64, 1280, 720, 1)).toEqual({ x: 640, y: -664 });
  });

  it('64×64 map at z=0.25, 1280×720 viewport', () => {
    // midX=0, midY=1024 → x=640, y=360-256=104
    expect(centerOffset(extent64, 1280, 720, 0.25)).toEqual({ x: 640, y: 104 });
  });

  it('32×16 map at z=1, 1280×720 viewport', () => {
    // midX=(-512+1024)/2=256, midY=(0+768)/2=384
    // x=640-256=384, y=360-384=-24
    const extent32x16 = { minX: -512, maxX: 1024, minY: 0, maxY: 768 };
    expect(centerOffset(extent32x16, 1280, 720, 1)).toEqual({ x: 384, y: -24 });
  });
});

describe('centerOffset is inside cameraBounds', () => {
  const extent64 = { minX: -2048, maxX: 2048, minY: 0, maxY: 2048 };
  const vp = { w: 1280, h: 720 };

  for (const zoom of [0.25, 1, 2] as const) {
    it(`64×64 center is within cameraBounds at z=${zoom}`, () => {
      const bounds = cameraBounds(extent64, vp.w, vp.h, zoom);
      const offset = centerOffset(extent64, vp.w, vp.h, zoom);
      expect(offset.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(offset.x).toBeLessThanOrEqual(bounds.maxX);
      expect(offset.y).toBeGreaterThanOrEqual(bounds.minY);
      expect(offset.y).toBeLessThanOrEqual(bounds.maxY);
    });
  }

  it('32×16 center is within cameraBounds at z=1', () => {
    const extent32x16 = { minX: -512, maxX: 1024, minY: 0, maxY: 768 };
    const bounds = cameraBounds(extent32x16, vp.w, vp.h, 1);
    const offset = centerOffset(extent32x16, vp.w, vp.h, 1);
    expect(offset.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(offset.x).toBeLessThanOrEqual(bounds.maxX);
    expect(offset.y).toBeGreaterThanOrEqual(bounds.minY);
    expect(offset.y).toBeLessThanOrEqual(bounds.maxY);
  });
});
