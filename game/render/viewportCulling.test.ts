import { describe, it, expect } from 'vitest';
import {
  visibleTileBounds,
  iterateVisibleTiles,
  isBuildingVisible,
} from './viewportCulling';

describe('viewportCulling', () => {
  // ─── visibleTileBounds ────────────────────────────────────────────────────

  it('centered first-frame zoom=1, vp=1440x900, map=64x64, padding=1 (default)', () => {
    // mapWorldExtent for 64x64: minX=-2048, maxX=2048, minY=0, maxY=2048.
    // midX = 0, midY = 1024. centerOffset = (720, -574).
    // Camera at (720, -574). Corners (screen -> world via (s - cam)/zoom):
    //   tl world = (0-720, 0-(-574)) = (-720, 574)
    //   tr world = (1440-720, 574)   = (720, 574)
    //   bl world = (-720, 900+574)   = (-720, 1474)
    //   br world = (720, 1474)
    // fracInverse with HALF_W=32, HALF_H=16, divisors are 64 and 32:
    //   tl: -720/64 + 574/32 = -11.25 + 17.9375 = 6.6875    ty: 574/32 - (-720/64) = 17.9375 + 11.25 = 29.1875
    //   tr:  720/64 + 574/32 =  11.25 + 17.9375 = 29.1875   ty: 17.9375 - 11.25 = 6.6875
    //   bl: -720/64 + 1474/32 = -11.25 + 46.0625 = 34.8125  ty: 46.0625 + 11.25 = 57.3125
    //   br:  720/64 + 1474/32 =  11.25 + 46.0625 = 57.3125  ty: 46.0625 - 11.25 = 34.8125
    // minTx=6.6875, maxTx=57.3125, minTy=6.6875, maxTy=57.3125
    // Pre-clamp (padding=1):
    //   minX = floor(6.6875) - 1 = 5
    //   maxX = floor(57.3125) + 1 + 1 = 59
    //   minY = floor(6.6875) - 1 = 5
    //   maxY = floor(57.3125) + 1 + 1 = 59
    // Clamp to [0, 64): unchanged.
    const { terrain, buildings } = visibleTileBounds({
      cameraX: 720, cameraY: -574, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.minX).toBe(5);
    expect(terrain.maxX).toBe(59);
    expect(terrain.minY).toBe(5);
    expect(terrain.maxY).toBe(59);
    expect(buildings.minX).toBe(5);
    expect(buildings.maxX).toBe(59);
    expect(buildings.minY).toBe(5);
    expect(buildings.maxY).toBe(59);
  });

  it('maxBuildingLiftPx: 0 invariant — buildings AABB equals terrain AABB', () => {
    // Any non-trivial camera args; with liftPx=0 building corners equal terrain corners.
    const { terrain, buildings } = visibleTileBounds({
      cameraX: 100, cameraY: 200, zoom: 1,
      viewportW: 800, viewportH: 600,
      mapWidth: 64, mapHeight: 64,
      maxBuildingLiftPx: 0,
    });
    expect(buildings.minX).toBe(terrain.minX);
    expect(buildings.maxX).toBe(terrain.maxX);
    expect(buildings.minY).toBe(terrain.minY);
    expect(buildings.maxY).toBe(terrain.maxY);
  });

  it('half-open max boundary: floor(maxTx)+1 not floor or ceil (integer maxTx edge)', () => {
    // Camera=(0,0), zoom=1, vp=(640,320), paddingTiles=0.
    // Corners (screen -> world): tl=(0,0), tr=(640,0), bl=(0,320), br=(640,320).
    // fracInverse:
    //   tl: (0, 0)
    //   tr: (640/64 + 0, 0 - 640/64) = (10, -10)
    //   bl: (0 + 320/32, 320/32 - 0) = (10, 10)
    //   br: (640/64 + 320/32, 320/32 - 640/64) = (10+10, 10-10) = (20, 0)
    // minTx=0, maxTx=20, minTy=-10, maxTy=10.
    // Pre-clamp (padding=0):
    //   maxX = floor(20) + 1 + 0 = 21  (NOT 20, NOT 22)
    //   maxY = floor(10) + 1 + 0 = 11
    const { terrain } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 640, viewportH: 320,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 0,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.maxX).toBe(21);
    expect(terrain.maxY).toBe(11);
  });

  it('negative paddingTiles: -1 clamps to same as paddingTiles: 0', () => {
    const base = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 640, viewportH: 320,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 0,
      maxBuildingLiftPx: 0,
    });
    const neg = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 640, viewportH: 320,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: -1,
      maxBuildingLiftPx: 0,
    });
    expect(neg.terrain.minX).toBe(base.terrain.minX);
    expect(neg.terrain.maxX).toBe(base.terrain.maxX);
    expect(neg.terrain.minY).toBe(base.terrain.minY);
    expect(neg.terrain.maxY).toBe(base.terrain.maxY);
  });

  it('fractional paddingTiles: 1.7 floors to 1', () => {
    const p1 = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 640, viewportH: 320,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 0,
    });
    const p17 = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 640, viewportH: 320,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1.7,
      maxBuildingLiftPx: 0,
    });
    expect(p17.terrain.minX).toBe(p1.terrain.minX);
    expect(p17.terrain.maxX).toBe(p1.terrain.maxX);
    expect(p17.terrain.minY).toBe(p1.terrain.minY);
    expect(p17.terrain.maxY).toBe(p1.terrain.maxY);
  });

  it('camera at map corner top-left: minX/minY clamp to 0', () => {
    // Camera far off to top-left means world corners are positive and large,
    // the AABB's negative-side won't matter; we verify minX===0, minY===0 after clamp.
    // cameraX=0, cameraY=0, zoom=1, small vp to avoid exceeding map.
    // tl world=(0,0) → fracInverse=(0,0): minTx=0, minTy would be negative from tr.
    // With padding=0: pre-clamp minX = floor(0)-0 = 0, clamped to 0.
    const { terrain } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 64, viewportH: 64,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 0,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.minX).toBe(0);
    expect(terrain.minY).toBe(0);
  });

  it('camera at map corner bottom-right: maxX/maxY clamp to mapWidth/mapHeight', () => {
    // Zoom=0.25 over a small viewport centered on the map's far corner ensures
    // the raw AABB extends far past the map right/bottom edges. After clamping,
    // maxX===mapWidth and maxY===mapHeight.
    const mapWidth = 64;
    const mapHeight = 64;
    const { terrain } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 0.25,
      viewportW: 800, viewportH: 600,
      mapWidth, mapHeight,
      paddingTiles: 0,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.maxX).toBe(mapWidth);
    expect(terrain.maxY).toBe(mapHeight);
  });

  it('zoom=2 gives smaller AABB than zoom=1', () => {
    // Camera=(0,0), zoom=2, vp=1440x900, padding=1, liftPx=0.
    // Corners: tl=(0,0), tr=(720,0), bl=(0,450), br=(720,450).
    // fracInverse:
    //   tl: (0, 0)
    //   tr: (720/64 + 0, 0 - 720/64) = (11.25, -11.25)
    //   bl: (0 + 450/32, 450/32 - 0) = (14.0625, 14.0625)
    //   br: (720/64 + 450/32, 450/32 - 720/64) = (11.25+14.0625, 14.0625-11.25) = (25.3125, 2.8125)
    // minTx=0, maxTx=25.3125, minTy=-11.25, maxTy=14.0625
    // Pre-clamp (padding=1):
    //   minX = floor(0) - 1 = -1 → clamped to 0
    //   maxX = floor(25.3125) + 1 + 1 = 27
    //   minY = floor(-11.25) - 1 = -13 → clamped to 0
    //   maxY = floor(14.0625) + 1 + 1 = 16
    const { terrain } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 2,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.minX).toBe(0);
    expect(terrain.maxX).toBe(27);
    expect(terrain.minY).toBe(0);
    expect(terrain.maxY).toBe(16);
  });

  it('zoom=0.25 zoomed-out: AABB clamps to full map', () => {
    // At zoom=0.25, world corners are huge (pixels scaled by 1/0.25=4).
    // The tile AABB exceeds the map in every direction; clamp to [0, mapSize).
    const { terrain, buildings } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 0.25,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 0,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.minX).toBe(0);
    expect(terrain.maxX).toBe(64);
    expect(terrain.minY).toBe(0);
    expect(terrain.maxY).toBe(64);
    expect(buildings.minX).toBe(0);
    expect(buildings.maxX).toBe(64);
    expect(buildings.minY).toBe(0);
    expect(buildings.maxY).toBe(64);
  });

  it('building bottom-edge world extension at zoom=1', () => {
    // Camera=(0,0), zoom=1, vp=1440x900, padding=1, liftPx=MAX_BUILDING_LIFT_PX (160).
    // Terrain corners (from cameraless-origin test): tl=(0,0), tr=(1440,0), bl=(0,900), br=(1440,900).
    // Building corners extend bl/br by +160 world-Y:
    //   bl_b = (0, 1060), br_b = (1440, 1060).
    // fracInverse:
    //   tl: (0, 0)
    //   tr: (1440/64 + 0, 0 - 1440/64) = (22.5, -22.5)
    //   bl_b: (0 + 1060/32, 1060/32 - 0) = (33.125, 33.125)
    //   br_b: (1440/64 + 1060/32, 1060/32 - 1440/64) = (22.5+33.125, 33.125-22.5) = (55.625, 10.625)
    // minTx=0, maxTx=55.625, minTy=-22.5, maxTy=33.125
    // Pre-clamp (padding=1):
    //   minX = floor(0)-1 = -1 → 0
    //   maxX = floor(55.625)+1+1 = 57
    //   minY = floor(-22.5)-1 = -23-1 = -24 → 0
    //   maxY = floor(33.125)+1+1 = 35
    const { buildings } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 160,
    });
    expect(buildings.minX).toBe(0);
    expect(buildings.maxX).toBe(57);
    expect(buildings.minY).toBe(0);
    expect(buildings.maxY).toBe(35);
  });

  it('building bottom-edge extension is in world-space not screen-space (zoom=2)', () => {
    // Camera=(0,0), zoom=2, vp=1440x900, padding=1, liftPx=160 world-px.
    // Terrain bl/br at world: (0, 450), (720, 450).
    // Building bl_b/br_b at world: (0, 450+160=610), (720, 610).
    // fracInverse:
    //   tl: (0, 0)
    //   tr: (720/64, -720/64) = (11.25, -11.25)
    //   bl_b: (0 + 610/32, 610/32 - 0) = (19.0625, 19.0625)
    //   br_b: (720/64 + 610/32, 610/32 - 720/64) = (11.25+19.0625, 19.0625-11.25) = (30.3125, 7.8125)
    // minTx=0, maxTx=30.3125, minTy=-11.25, maxTy=19.0625
    // Pre-clamp (padding=1):
    //   minX = floor(0)-1 = -1 → 0
    //   maxX = floor(30.3125)+1+1 = 32
    //   minY = floor(-11.25)-1 = -13 → 0
    //   maxY = floor(19.0625)+1+1 = 21
    const { buildings } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 2,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 160,
    });
    expect(buildings.minX).toBe(0);
    expect(buildings.maxX).toBe(32);
    expect(buildings.minY).toBe(0);
    expect(buildings.maxY).toBe(21);
  });

  it('default MAX_BUILDING_LIFT_PX (220) widens buildings AABB beyond terrain', () => {
    // Omit maxBuildingLiftPx so the implementation uses MAX_BUILDING_LIFT_PX (220).
    // Compare against an explicit liftPx=0 baseline: buildings.maxY must exceed terrain.maxY
    // by the amount that 220 world-px of extension adds in tile space (at zoom=1, padding=1).
    const base = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 0,
    });
    const withDefault = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
    });
    // Default lift extends building AABB further than zero lift.
    expect(withDefault.buildings.maxY).toBeGreaterThan(base.buildings.maxY);
    // Literal pin: zoom=1, vp=1440x900, cam=(0,0), pad=1, liftPx=220.
    // bl_b world=(0,1120), fracInverse→maxTy=35, maxY=floor(35)+1+1=37.
    expect(withDefault.buildings.maxY).toBe(37);
  });

  it('camera far off-map clamps both bounds to {0,0,0,0}', () => {
    // cameraX=-1e6, cameraY=-1e6: world corners are large positives; fractional tile coords
    // exceed mapSize. After clamp max<=min, both bounds collapse to {0,0,0,0}.
    const { terrain, buildings } = visibleTileBounds({
      cameraX: -1e6, cameraY: -1e6, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
    });
    expect(terrain).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
    expect(buildings).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });

  it('tiny map clamps both bounds to full map', () => {
    // mapWidth=2, mapHeight=2, large vp: raw AABB exceeds map; clamp to [0,2).
    const { terrain, buildings } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 2, mapHeight: 2,
    });
    expect(terrain.minX).toBe(0);
    expect(terrain.maxX).toBe(2);
    expect(terrain.minY).toBe(0);
    expect(terrain.maxY).toBe(2);
    expect(buildings.minX).toBe(0);
    expect(buildings.maxX).toBe(2);
    expect(buildings.minY).toBe(0);
    expect(buildings.maxY).toBe(2);
  });

  // ─── iterateVisibleTiles ──────────────────────────────────────────────────

  it('iterateVisibleTiles empty bounds yields nothing', () => {
    const result = [...iterateVisibleTiles({ minX: 0, maxX: 0, minY: 0, maxY: 0 })];
    expect(result).toHaveLength(0);
  });

  it('iterateVisibleTiles {2,5,3,6} yields 9 cells in y-outer x-inner order', () => {
    // Half-open: x in [2,5), y in [3,6) = 3*3 = 9 cells.
    // y-outer, x-inner order:
    //   y=3: (2,3),(3,3),(4,3)
    //   y=4: (2,4),(3,4),(4,4)
    //   y=5: (2,5),(3,5),(4,5)
    const result = [...iterateVisibleTiles({ minX: 2, maxX: 5, minY: 3, maxY: 6 })];
    expect(result).toHaveLength(9);
    expect(result).toEqual([
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
      { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
      { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 },
    ]);
  });

  // ─── isBuildingVisible ────────────────────────────────────────────────────

  it('isBuildingVisible single-cell footprint inside bounds → true', () => {
    expect(isBuildingVisible([{ x: 5, y: 5 }], { minX: 0, maxX: 10, minY: 0, maxY: 10 })).toBe(true);
  });

  it('isBuildingVisible single-cell footprint at maxX boundary → false (half-open)', () => {
    // x===maxX is OUTSIDE the half-open range [minX, maxX).
    expect(isBuildingVisible([{ x: 10, y: 5 }], { minX: 0, maxX: 10, minY: 0, maxY: 10 })).toBe(false);
  });

  it('isBuildingVisible multi-cell footprint: true if ANY cell is inside', () => {
    // [{x:5,y:5},{x:9,y:5}] against {8,12,0,10}: x=9 is in [8,12), y=5 in [0,10).
    expect(isBuildingVisible([{ x: 5, y: 5 }, { x: 9, y: 5 }], { minX: 8, maxX: 12, minY: 0, maxY: 10 })).toBe(true);
  });

  it('isBuildingVisible multi-cell footprint: false if ALL cells are outside', () => {
    // [{x:5,y:5},{x:6,y:5}] against {8,12,0,10}: both x < minX.
    expect(isBuildingVisible([{ x: 5, y: 5 }, { x: 6, y: 5 }], { minX: 8, maxX: 12, minY: 0, maxY: 10 })).toBe(false);
  });

  it('isBuildingVisible Codex Round 1 regression: anchor out, other cell in → true', () => {
    // Multi-cell [{x:0,y:0},{x:5,y:5}] against {4,10,4,10}.
    // anchor (0,0) is outside, (5,5) is inside → should be true.
    expect(isBuildingVisible([{ x: 0, y: 0 }, { x: 5, y: 5 }], { minX: 4, maxX: 10, minY: 4, maxY: 10 })).toBe(true);
  });

  it('isBuildingVisible empty footprint → false', () => {
    expect(isBuildingVisible([], { minX: 0, maxX: 10, minY: 0, maxY: 10 })).toBe(false);
  });
});
