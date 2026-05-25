import { describe, it, expect } from 'vitest';
import {
  visibleTileBounds,
  iterateVisibleTiles,
  isBuildingVisible,
  MAX_TERRAIN_LIFT_PX,
  MAX_BUILDING_LIFT_PX,
} from './viewportCulling';
import { cubeLiftPx } from '@/game/render/visuals/polygon/cubeLift';
import { cubeTypeHeightPx } from '@/game/render/visuals/polygon/cubeTypeRatios';
import { ROOF_ACCENT_SPEC } from '@/game/render/visuals/polygon/cubeRoofAccent';
import { ZONE_MAX_LEVEL } from '@/game/core/World';

describe('viewportCulling', () => {
  // ─── visibleTileBounds ────────────────────────────────────────────────────

  it('centered first-frame zoom=1, vp=1440x900, map=64x64, padding=1 (default)', () => {
    // mapWorldExtent for 64x64: minX=-2048, maxX=2048, minY=0, maxY=2048.
    // midX = 0, midY = 1024. centerOffset = (720, -574).
    // Camera at (720, -574). Corners (screen -> world via (s - cam)/zoom):
    //   tl world = (-720, 574), tr world = (720, 574)
    //   bl world = (-720, 1474), br world = (720, 1474)
    // Terrain: BL/BR extended by MAX_TERRAIN_LIFT_PX (96):
    //   bl_ext = (-720, 1570), br_ext = (720, 1570)
    // fracInverse with HALF_W=32, HALF_H=16:
    //   tl: -720/64 + 574/32 = 6.6875,    ty = 29.1875
    //   tr:  720/64 + 574/32 = 29.1875,   ty =  6.6875
    //   bl_ext: -720/64 + 1570/32 = 37.8125, ty = 60.3125
    //   br_ext:  720/64 + 1570/32 = 60.3125, ty = 37.8125
    // minTx=6.6875, maxTx=60.3125, minTy=6.6875, maxTy=60.3125
    // Pre-clamp (padding=1):
    //   minX = floor(6.6875) - 1 = 5
    //   maxX = floor(60.3125) + 1 + 1 = 62
    //   minY = floor(6.6875) - 1 = 5
    //   maxY = floor(60.3125) + 1 + 1 = 62
    // Clamp to [0, 64): unchanged.
    // With maxBuildingLiftPx=0: buildings BL/BR extend by 0+96=96, same as terrain.
    const { terrain, buildings } = visibleTileBounds({
      cameraX: 720, cameraY: -574, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.minX).toBe(5);
    expect(terrain.maxX).toBe(62);
    expect(terrain.minY).toBe(5);
    expect(terrain.maxY).toBe(62);
    expect(buildings.minX).toBe(5);
    expect(buildings.maxX).toBe(62);
    expect(buildings.minY).toBe(5);
    expect(buildings.maxY).toBe(62);
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
    // Terrain: BL/BR extended by MAX_TERRAIN_LIFT_PX (96):
    //   bl_ext=(0,416), br_ext=(640,416)
    // fracInverse:
    //   tl: (0, 0)
    //   tr: (640/64, -640/64) = (10, -10)
    //   bl_ext: (0 + 416/32, 416/32 - 0) = (13, 13)
    //   br_ext: (640/64 + 416/32, 416/32 - 640/64) = (23, 3)
    // minTx=0, maxTx=23, minTy=-10, maxTy=13.
    // Pre-clamp (padding=0):
    //   maxX = floor(23) + 1 + 0 = 24
    //   maxY = floor(13) + 1 + 0 = 14
    const { terrain } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 640, viewportH: 320,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 0,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.maxX).toBe(24);
    expect(terrain.maxY).toBe(14);
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
    // World corners: tl=(0,0), tr=(720,0), bl=(0,450), br=(720,450).
    // Terrain BL/BR extended by MAX_TERRAIN_LIFT_PX (96):
    //   bl_ext=(0,546), br_ext=(720,546)
    // fracInverse:
    //   tl: (0, 0)
    //   tr: (11.25, -11.25)
    //   bl_ext: (0 + 546/32, 546/32 - 0) = (17.0625, 17.0625)
    //   br_ext: (720/64 + 546/32, 546/32 - 720/64) = (28.3125, 5.8125)
    // minTx=0, maxTx=28.3125, minTy=-11.25, maxTy=17.0625
    // Pre-clamp (padding=1):
    //   minX = -1 → 0
    //   maxX = floor(28.3125) + 1 + 1 = 30
    //   minY = -13 → 0
    //   maxY = floor(17.0625) + 1 + 1 = 19
    const { terrain } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 2,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 0,
    });
    expect(terrain.minX).toBe(0);
    expect(terrain.maxX).toBe(30);
    expect(terrain.minY).toBe(0);
    expect(terrain.maxY).toBe(19);
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
    // Camera=(0,0), zoom=1, vp=1440x900, padding=1, liftPx=160.
    // Building BL/BR extend by liftPx + MAX_TERRAIN_LIFT_PX = 160 + 96 = 256:
    //   bl_b = (0, 900+256=1156), br_b = (1440, 1156).
    // fracInverse:
    //   tl: (0, 0)
    //   tr: (22.5, -22.5)
    //   bl_b: (0 + 1156/32, 1156/32 - 0) = (36.125, 36.125)
    //   br_b: (22.5 + 36.125, 36.125 - 22.5) = (58.625, 13.625)
    // minTx=0, maxTx=58.625, minTy=-22.5, maxTy=36.125
    // Pre-clamp (padding=1):
    //   minX = -1 → 0
    //   maxX = floor(58.625)+1+1 = 60
    //   minY = -24 → 0
    //   maxY = floor(36.125)+1+1 = 38
    const { buildings } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 160,
    });
    expect(buildings.minX).toBe(0);
    expect(buildings.maxX).toBe(60);
    expect(buildings.minY).toBe(0);
    expect(buildings.maxY).toBe(38);
  });

  it('building bottom-edge extension is in world-space not screen-space (zoom=2)', () => {
    // Camera=(0,0), zoom=2, vp=1440x900, padding=1, liftPx=160 world-px.
    // Building BL/BR extend by liftPx + MAX_TERRAIN_LIFT_PX = 160 + 96 = 256:
    //   bl_b world: (0, 450+256=706), br_b: (720, 706)
    // fracInverse:
    //   tl: (0, 0)
    //   tr: (11.25, -11.25)
    //   bl_b: (0 + 706/32, 706/32 - 0) = (22.0625, 22.0625)
    //   br_b: (11.25 + 22.0625, 22.0625 - 11.25) = (33.3125, 10.8125)
    // minTx=0, maxTx=33.3125, minTy=-11.25, maxTy=22.0625
    // Pre-clamp (padding=1):
    //   minX = -1 → 0
    //   maxX = floor(33.3125)+1+1 = 35
    //   minY = -13 → 0
    //   maxY = floor(22.0625)+1+1 = 24
    const { buildings } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 2,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 1,
      maxBuildingLiftPx: 160,
    });
    expect(buildings.minX).toBe(0);
    expect(buildings.maxX).toBe(35);
    expect(buildings.minY).toBe(0);
    expect(buildings.maxY).toBe(24);
  });

  it('default MAX_BUILDING_LIFT_PX (220) widens buildings AABB beyond terrain', () => {
    // Omit maxBuildingLiftPx so the implementation uses MAX_BUILDING_LIFT_PX (220).
    // Compare against an explicit liftPx=0 baseline.
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
    // Building BL/BR extend by liftPx + MAX_TERRAIN_LIFT_PX = 220 + 96 = 316.
    // bl_b world=(0, 900+316=1216), fracInverse(0,1216): 1216/32=38, ty=38.
    // maxTy=38 → maxY=floor(38)+1+1=40.
    expect(withDefault.buildings.maxY).toBe(40);
  });

  it('terrain lift: elevated tiles near south edge are included (terrain.maxY > unlifted baseline)', () => {
    // Camera=(0,0), zoom=1, vp=1440x900, padding=0.
    // Without terrain lift, terrain BL/BR = (0,900) and (1440,900).
    //   fracInverse(0,900): 0 + 900/32 = 28.125, ty=28.125 → unlifted maxY = floor(28.125)+1+0 = 29.
    // With MAX_TERRAIN_LIFT_PX=96, BL/BR extended to 996:
    //   fracInverse(0,996): 0 + 996/32 = 31.125, ty=31.125 → maxY = floor(31.125)+1+0 = 32.
    const { terrain: lifted } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 0,
      maxBuildingLiftPx: 0,
    });
    // Without terrain lift (hypothetical — we measure the actual delta).
    // The ELEVATION_HEIGHT * MAX_ELEVATION = 96 lift adds 96/32 = 3 tile rows via fracInverse.
    expect(lifted.maxY).toBe(32);
    // terrain.maxY is strictly greater than it would be without the lift extension.
    // The constant MAX_TERRAIN_LIFT_PX exported from viewportCulling drives this delta.
    expect(MAX_TERRAIN_LIFT_PX).toBe(96);
  });

  it('building lift additivity: buildings.maxY > terrain.maxY by MAX_BUILDING_LIFT_PX contribution', () => {
    // Same camera; buildings extend by liftPx + MAX_TERRAIN_LIFT_PX (additive).
    // With liftPx=MAX_BUILDING_LIFT_PX (220) and terrain lift=96, total=316.
    // terrain: maxY=32 (from test above).
    // buildings: BL/BR at 900+316=1216 → fracInverse(0,1216)=38, ty=38 → maxY=39.
    const { terrain, buildings } = visibleTileBounds({
      cameraX: 0, cameraY: 0, zoom: 1,
      viewportW: 1440, viewportH: 900,
      mapWidth: 64, mapHeight: 64,
      paddingTiles: 0,
    });
    expect(buildings.maxY).toBeGreaterThan(terrain.maxY);
    // Pin the exact delta: MAX_BUILDING_LIFT_PX=220 adds 220/32=6.875 tile rows → delta=6 or 7.
    // fracInverse(0, 900+96) = 31.125 → maxY=32 (terrain)
    // fracInverse(0, 900+96+220) = fracInverse(0,1216) = 38 → maxY=39 (buildings)
    // Delta = 39 - 32 = 7 (tied to MAX_BUILDING_LIFT_PX / fracInverse math).
    expect(buildings.maxY).toBe(39);
    expect(buildings.maxY - terrain.maxY).toBe(7);
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

// If this test fails: re-derive MAX_BUILDING_LIFT_PX in viewportCulling.ts.
describe('worst-case building lift vs MAX_BUILDING_LIFT_PX', () => {
  it('worst-case cube lift (level=ZONE_MAX_LEVEL, density=2, type=commercial) is ≤ MAX_BUILDING_LIFT_PX', () => {
    const SLACK_PX = 10;
    const mainLift = cubeTypeHeightPx(cubeLiftPx(ZONE_MAX_LEVEL, 2), 'commercial');
    const accentLift = Math.round(mainLift * ROOF_ACCENT_SPEC.commercial.heightScale);
    const worstCase = mainLift + accentLift + SLACK_PX;
    expect(worstCase).toBeLessThanOrEqual(MAX_BUILDING_LIFT_PX);
  });

  it('worst-case value is exactly 195 (cubeLiftPx(5,2)=83, cubeTypeHeightPx(83,commercial)=112, accentLift=round(112*0.65)=73, worstCase=112+73+10=195)', () => {
    const SLACK_PX = 10;
    const mainLift = cubeTypeHeightPx(cubeLiftPx(ZONE_MAX_LEVEL, 2), 'commercial');
    const accentLift = Math.round(mainLift * ROOF_ACCENT_SPEC.commercial.heightScale);
    const worstCase = mainLift + accentLift + SLACK_PX;
    expect(worstCase).toBe(195);
  });
});
