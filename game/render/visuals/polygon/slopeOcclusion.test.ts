import { describe, it, expect } from 'vitest';
import { projectTileCornerScreen, polygonContains } from '../../IsoTransform';
import { computeTerrainZIndex } from '../../terrain/terrainZIndex';

describe('slope occlusion — same-height non-adjacent area-overlap', () => {
  // Fixture (from plan model commitment):
  // A: (5,5) cornerHeights { topH:8, rightH:8, bottomH:0, leftH:0 } — south-falling wedge
  // B: (8,8) flat all corners = 8.
  // Sample (0,180) is INTERIOR to both polygons.

  const A_tile = { x: 5, y: 5 };
  const A_c = { topH: 8, rightH: 8, bottomH: 0, leftH: 0 };
  const A_poly = [
    projectTileCornerScreen(A_tile, 'top',    A_c.topH),
    projectTileCornerScreen(A_tile, 'right',  A_c.rightH),
    projectTileCornerScreen(A_tile, 'bottom', A_c.bottomH),
    projectTileCornerScreen(A_tile, 'left',   A_c.leftH),
  ];

  const B_tile = { x: 8, y: 8 };
  const B_c = { topH: 8, rightH: 8, bottomH: 8, leftH: 8 };
  const B_poly = [
    projectTileCornerScreen(B_tile, 'top',    B_c.topH),
    projectTileCornerScreen(B_tile, 'right',  B_c.rightH),
    projectTileCornerScreen(B_tile, 'bottom', B_c.bottomH),
    projectTileCornerScreen(B_tile, 'left',   B_c.leftH),
  ];

  const sample = { x: 0, y: 180 };

  it('verified polygons match plan: A=(top(0,64), right(32,80), bottom(0,192), left(-32,176)); B=(top(0,160), right(32,176), bottom(0,192), left(-32,176))', () => {
    expect(A_poly[0]).toEqual({ x: 0,   y: 64 });
    expect(A_poly[1]).toEqual({ x: 32,  y: 80 });
    expect(A_poly[2]).toEqual({ x: 0,   y: 192 });
    expect(A_poly[3]).toEqual({ x: -32, y: 176 });

    expect(B_poly[0]).toEqual({ x: 0,   y: 160 });
    expect(B_poly[1]).toEqual({ x: 32,  y: 176 });
    expect(B_poly[2]).toEqual({ x: 0,   y: 192 });
    expect(B_poly[3]).toEqual({ x: -32, y: 176 });
  });

  it('sample point (0,180) is interior to BOTH polygons', () => {
    expect(polygonContains(A_poly, sample)).toBe(true);
    expect(polygonContains(B_poly, sample)).toBe(true);
  });

  it('z-order: B wins via computeTerrainZIndex (8_016_008 > 8_010_005)', () => {
    const zA = computeTerrainZIndex(8, 5, 5);
    const zB = computeTerrainZIndex(8, 8, 8);
    expect(zA).toBe(8_010_005);
    expect(zB).toBe(8_016_008);
    expect(zB).toBeGreaterThan(zA);
  });

  it('lemma anchor — mixed cornerHeights: every projected corner Y ≤ flat-unlifted-at-H=0 Y', () => {
    // For tile (2,2), cornerHeights { topH:2, rightH:2, bottomH:0, leftH:0 }.
    // The unlifted (h=0) "flat envelope" for tile (2,2) has corners at
    // tileToScreen(2,2).y = (2+2)*16 = 64; other corners offset from there.
    // The deformed polygon corners must all sit ABOVE OR ON the unlifted envelope
    // (projected Y ≤ envelope Y, since smaller Y = higher in screen-Y-down space).
    const tile = { x: 2, y: 2 };
    const c = { topH: 2, rightH: 2, bottomH: 0, leftH: 0 };
    const top    = projectTileCornerScreen(tile, 'top',    c.topH);
    const right  = projectTileCornerScreen(tile, 'right',  c.rightH);
    const bottom = projectTileCornerScreen(tile, 'bottom', c.bottomH);
    const left   = projectTileCornerScreen(tile, 'left',   c.leftH);
    // Unlifted (h=0) envelope: top=(0,64), right=(32,80), bottom=(0,96), left=(-32,80).
    expect(top.y).toBeLessThanOrEqual(64);
    expect(right.y).toBeLessThanOrEqual(80);
    expect(bottom.y).toBeLessThanOrEqual(96);
    expect(left.y).toBeLessThanOrEqual(80);
  });
});
