import { describe, it, expect } from 'vitest';
import {
  ISO_CONFIG,
  tileToScreen,
  tileToScreenWithHeight,
  screenToTile,
  screenToTileRaw,
  screenToTileWithTerrain,
  tileCenterToScreen,
  projectTileCornerScreen,
  polygonContains,
} from './IsoTransform';
import { Terrain, ELEVATION_HEIGHT, MAX_ELEVATION } from '@/game/core';

describe('tileToScreen', () => {
  it('maps the origin to the screen origin', () => {
    expect(tileToScreen({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('moves +X down-right and +Y down-left (diamond projection)', () => {
    expect(tileToScreen({ x: 1, y: 0 })).toEqual({ x: 32, y: 16 });
    expect(tileToScreen({ x: 0, y: 1 })).toEqual({ x: -32, y: 16 });
    expect(tileToScreen({ x: 2, y: 2 })).toEqual({ x: 0, y: 64 });
  });
});

describe('screenToTile', () => {
  it('is the exact inverse of tileToScreen at tile corners', () => {
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        expect(screenToTile(tileToScreen({ x, y }))).toEqual({ x, y });
      }
    }
  });

  it('floors to the containing tile for points inside a diamond', () => {
    // Slightly off the (2,3) corner still resolves to (2,3)
    const corner = tileToScreen({ x: 2, y: 3 });
    expect(screenToTile({ x: corner.x + 4, y: corner.y + 2 })).toEqual({
      x: 2,
      y: 3,
    });
  });
});

describe('tileCenterToScreen', () => {
  it('offsets the corner down by half a tile height', () => {
    expect(tileCenterToScreen({ x: 0, y: 0 })).toEqual({
      x: 0,
      y: ISO_CONFIG.TILE_HEIGHT / 2,
    });
    expect(tileCenterToScreen({ x: 1, y: 0 })).toEqual({ x: 32, y: 32 });
  });
});

describe('tileToScreenWithHeight', () => {
  it('height=0 produces identical output to tileToScreen', () => {
    for (const tile of [{ x: 0, y: 0 }, { x: 3, y: 5 }, { x: 7, y: 2 }]) {
      expect(tileToScreenWithHeight(tile, 0)).toEqual(tileToScreen(tile));
    }
  });

  it('height=2 shifts y down by -2 * ELEVATION_HEIGHT exactly', () => {
    const tile = { x: 4, y: 4 };
    const flat = tileToScreen(tile);
    const lifted = tileToScreenWithHeight(tile, 2);
    expect(lifted.x).toBe(flat.x);
    expect(lifted.y).toBe(flat.y - 2 * ELEVATION_HEIGHT);
  });
});

describe('screenToTileRaw', () => {
  it('returns unfloored fractional tile coords', () => {
    // Pick a point slightly inside tile (2,3)
    const corner = tileToScreen({ x: 2, y: 3 });
    const raw = screenToTileRaw(corner.x + 4, corner.y + 2);
    // Should be close to (2,3) but not exactly
    expect(raw.x).toBeGreaterThanOrEqual(2);
    expect(raw.y).toBeGreaterThanOrEqual(3);
    // Floor must match screenToTile
    expect(Math.floor(raw.x)).toBe(screenToTile({ x: corner.x + 4, y: corner.y + 2 }).x);
    expect(Math.floor(raw.y)).toBe(screenToTile({ x: corner.x + 4, y: corner.y + 2 }).y);
  });

  it('matches canonical formula: tx=(sx/32+sy/16)/2, ty=(sy/16-sx/32)/2', () => {
    const sx = 128, sy = 64;
    const raw = screenToTileRaw(sx, sy);
    expect(raw.x).toBeCloseTo((sx / 32 + sy / 16) / 2, 10);
    expect(raw.y).toBeCloseTo((sy / 16 - sx / 32) / 2, 10);
  });

  it('adding 12*h to sy shifts both axes by 0.375*h (h=1 and h=2)', () => {
    const sx = 64, sy = 32;
    const base = screenToTileRaw(sx, sy);

    const h1 = screenToTileRaw(sx, sy + 12 * 1);
    expect(h1.x - base.x).toBeCloseTo(0.375 * 1, 10);
    expect(h1.y - base.y).toBeCloseTo(0.375 * 1, 10);

    const h2 = screenToTileRaw(sx, sy + 12 * 2);
    expect(h2.x - base.x).toBeCloseTo(0.375 * 2, 10);
    expect(h2.y - base.y).toBeCloseTo(0.375 * 2, 10);
  });

  it('Math.floor(screenToTileRaw) equals screenToTile at tile corners', () => {
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const corner = tileToScreen({ x, y });
        const raw = screenToTileRaw(corner.x, corner.y);
        const floored = screenToTile(corner);
        expect(Math.floor(raw.x)).toBe(floored.x);
        expect(Math.floor(raw.y)).toBe(floored.y);
      }
    }
  });
});

describe('screenToTileWithTerrain — picking suite', () => {
  it('flat all-zero map: cursor at center of tile (5,5) returns (5,5)', () => {
    const terrain = new Terrain(10, 10);
    const top = tileToScreenWithHeight({ x: 5, y: 5 }, 0);
    const cursor = { x: top.x, y: top.y + ISO_CONFIG.TILE_HEIGHT / 2 };
    const result = screenToTileWithTerrain(cursor, terrain, 10, 10);
    expect(result).toEqual({ x: 5, y: 5 });
  });

  it('lifted center on raised tile (h=2): returns (5,5); flat inverse returns a different tile', () => {
    const terrain = new Terrain(10, 10);
    terrain.unsafeSetElevation(5, 5, 2);

    const liftedTop = tileToScreenWithHeight({ x: 5, y: 5 }, 2);
    const cursor = { x: liftedTop.x, y: liftedTop.y + ISO_CONFIG.TILE_HEIGHT / 2 };

    const result = screenToTileWithTerrain(cursor, terrain, 10, 10);
    expect(result.x).toBe(5);
    expect(result.y).toBe(5);

    // Flat inverse should land on a different tile (proving elevation correction matters)
    const flatResult = screenToTile(cursor);
    expect(flatResult.x === 5 && flatResult.y === 5).toBe(false);
  });

  it('cursor over flat tile with no elevated neighbor: returns same as screenToTile', () => {
    const terrain = new Terrain(10, 10);
    const corner = tileToScreen({ x: 3, y: 3 });
    const cursor = { x: corner.x, y: corner.y + ISO_CONFIG.TILE_HEIGHT / 2 };
    const result = screenToTileWithTerrain(cursor, terrain, 10, 10);
    expect(result).toEqual(screenToTile(cursor));
  });

  it('overlap tie-break: higher elevation tile wins over flat tile at same screen position', () => {
    const terrain = new Terrain(10, 10);
    // A highly lifted tile (5,5) at h=3 — its lifted diamond covers the flat-inverse
    // landing zone of the cursor, so it should win.
    terrain.unsafeSetElevation(5, 5, 3);

    // Cursor at the lifted center of (5,5)
    const liftedTop = tileToScreenWithHeight({ x: 5, y: 5 }, 3);
    const cursor = { x: liftedTop.x, y: liftedTop.y + ISO_CONFIG.TILE_HEIGHT / 2 };

    // Flat inverse would land elsewhere
    const flatResult = screenToTile(cursor);
    expect(flatResult.x === 5 && flatResult.y === 5).toBe(false);

    // Elevation-aware picking must return (5,5)
    const result = screenToTileWithTerrain(cursor, terrain, 10, 10);
    expect(result.x).toBe(5);
    expect(result.y).toBe(5);
  });

  it('diamond-edge inclusive: cursor at exact rhombus boundary of a lifted tile is accepted', () => {
    const terrain = new Terrain(10, 10);
    terrain.unsafeSetElevation(5, 5, 2);

    // Cursor at the top vertex of the lifted diamond — exactly on the boundary (sum = 1 in
    // the point-in-diamond formula: |0|/hw + |−hh|/hh = 0 + 1 = 1 ≤ 1).
    // The top vertex is shared by fewer adjacent tiles than the side vertices, making it
    // a clean edge case to assert inclusivity without iso neighbour ambiguity.
    const top = tileToScreenWithHeight({ x: 5, y: 5 }, 2);
    const cursorEdge = { x: top.x, y: top.y }; // top vertex of the diamond

    const result = screenToTileWithTerrain(cursorEdge, terrain, 10, 10);
    expect(result.x).toBe(5);
    expect(result.y).toBe(5);
  });

  it('max elevation cap: cursor at lifted center of MAX_ELEVATION tile returns that tile', () => {
    const terrain = new Terrain(10, 10);
    terrain.unsafeSetElevation(5, 5, MAX_ELEVATION);

    const top = tileToScreenWithHeight({ x: 5, y: 5 }, MAX_ELEVATION);
    const cursor = { x: top.x, y: top.y + ISO_CONFIG.TILE_HEIGHT / 2 };

    const result = screenToTileWithTerrain(cursor, terrain, 10, 10);
    expect(result.x).toBe(5);
    expect(result.y).toBe(5);
  });

  it('out-of-bounds cursor: result matches screenToTile fallback (may be OOB)', () => {
    const terrain = new Terrain(10, 10);
    const cursor = { x: 100000, y: 100000 };
    const result = screenToTileWithTerrain(cursor, terrain, 10, 10);
    expect(result).toEqual(screenToTile(cursor));
  });
});

describe('projectTileCornerScreen', () => {
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;

  it('cornerHeight=0: all four corners match tileToScreenWithHeight + per-corner offset for tile (0,0)', () => {
    const tile = { x: 0, y: 0 };
    const s0 = tileToScreenWithHeight(tile, 0);

    expect(projectTileCornerScreen(tile, 'top',    0)).toEqual({ x: s0.x,      y: s0.y });
    expect(projectTileCornerScreen(tile, 'right',  0)).toEqual({ x: s0.x + hw, y: s0.y + hh });
    expect(projectTileCornerScreen(tile, 'bottom', 0)).toEqual({ x: s0.x,      y: s0.y + ISO_CONFIG.TILE_HEIGHT });
    expect(projectTileCornerScreen(tile, 'left',   0)).toEqual({ x: s0.x - hw, y: s0.y + hh });
  });

  it('cornerHeight=0: all four corners match for tile (5,5)', () => {
    const tile = { x: 5, y: 5 };
    const s0 = tileToScreenWithHeight(tile, 0);

    expect(projectTileCornerScreen(tile, 'top',    0)).toEqual({ x: s0.x,      y: s0.y });
    expect(projectTileCornerScreen(tile, 'right',  0)).toEqual({ x: s0.x + hw, y: s0.y + hh });
    expect(projectTileCornerScreen(tile, 'bottom', 0)).toEqual({ x: s0.x,      y: s0.y + ISO_CONFIG.TILE_HEIGHT });
    expect(projectTileCornerScreen(tile, 'left',   0)).toEqual({ x: s0.x - hw, y: s0.y + hh });
  });

  it('nonzero cornerHeight shifts Y by -cornerHeight * ELEVATION_HEIGHT; X is unchanged', () => {
    const tile = { x: 3, y: 2 };
    const h = 4;

    for (const corner of ['top', 'right', 'bottom', 'left'] as const) {
      const flat    = projectTileCornerScreen(tile, corner, 0);
      const lifted  = projectTileCornerScreen(tile, corner, h);
      expect(lifted.x).toBe(flat.x);
      expect(lifted.y).toBe(flat.y - h * ELEVATION_HEIGHT);
    }
  });
});

describe('polygonContains', () => {
  // Build a flat-diamond polygon for tile (0,0) at cornerHeight=0 via projectTileCornerScreen.
  const tile = { x: 0, y: 0 };
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;
  const flatPoly = [
    projectTileCornerScreen(tile, 'top',    0),
    projectTileCornerScreen(tile, 'right',  0),
    projectTileCornerScreen(tile, 'bottom', 0),
    projectTileCornerScreen(tile, 'left',   0),
  ];

  it('interior point (diamond center) is inside', () => {
    const center = tileToScreenWithHeight(tile, 0);
    // Diamond center = top corner + (0, hh)
    const p = { x: center.x, y: center.y + hh };
    expect(polygonContains(flatPoly, p)).toBe(true);
  });

  it('far-outside point is not inside', () => {
    expect(polygonContains(flatPoly, { x: 1000, y: 1000 })).toBe(false);
  });

  it('inclusive boundary pin — all 4 vertices are inside', () => {
    for (const corner of ['top', 'right', 'bottom', 'left'] as const) {
      const vertex = projectTileCornerScreen(tile, corner, 0);
      expect(polygonContains(flatPoly, vertex)).toBe(true);
    }
  });

  it('inclusive boundary pin — edge midpoint (top→right) is inside', () => {
    const top   = projectTileCornerScreen(tile, 'top',   0);
    const right = projectTileCornerScreen(tile, 'right', 0);
    const mid = { x: (top.x + right.x) / 2, y: (top.y + right.y) / 2 };
    expect(polygonContains(flatPoly, mid)).toBe(true);
  });

  // Concave deformed-quad pin: MIN-of-4 corner rule permits concave quads
  // (here: top vertex dropped below left/right via nw=0 with everything else=8).
  // The convex cross-product test misclassifies interior points near the concave
  // vertex; the general winding-number algorithm in polygonContains accepts them.
  // This pin fails loudly if anyone "simplifies" polygonContains back to convex.
  it('concave deformed-quad: winding-number accepts interior point that convex test rejects', () => {
    const concaveTile = { x: 5, y: 5 };
    // topH=0 (nw=0, everything else=8) — top corner sits far below left/right/bottom
    // producing a polygon concave at the top vertex in screen space.
    const c = { topH: 0, rightH: 8, bottomH: 8, leftH: 8 };
    const poly = [
      projectTileCornerScreen(concaveTile, 'top',    c.topH),
      projectTileCornerScreen(concaveTile, 'right',  c.rightH),
      projectTileCornerScreen(concaveTile, 'bottom', c.bottomH),
      projectTileCornerScreen(concaveTile, 'left',   c.leftH),
    ];

    // For tile (5,5): screen0 = (0,160).
    // top=(0,160), right=(32,80), bottom=(0,96), left=(-32,80).
    // The interior at the center (lower region, x=0) is e.g. (0,150).
    // Convex test: top→right edge gives cross=(32)(150-160)-(80-160)(0-0)=-320 < 0 → false.
    // Winding-number: wn=-1 ≠ 0 → true (inside the downward-arrowhead interior).
    const top = poly[0]; // (0,160)
    const sample = { x: top.x, y: top.y - 10 }; // (0,150)

    expect(polygonContains(poly, sample)).toBe(true);

    // Companion: convex half-plane test returns false for the same point — proves general algorithm is required.
    function convexContains(
      cvxPoly: Array<{ x: number; y: number }>,
      p: { x: number; y: number },
    ): boolean {
      for (let i = 0; i < cvxPoly.length; i++) {
        const v0 = cvxPoly[i];
        const v1 = cvxPoly[(i + 1) % cvxPoly.length];
        const cross =
          (v1.x - v0.x) * (p.y - v0.y) - (v1.y - v0.y) * (p.x - v0.x);
        if (cross < 0) return false;
      }
      return true;
    }
    expect(convexContains(poly as Array<{ x: number; y: number }>, sample)).toBe(false);
  });
});
