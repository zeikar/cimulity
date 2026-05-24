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
import { tileCornerHeights } from './terrain/tileCornerHeights';

function setTileCorners(terrain: Terrain, x: number, y: number, h: number): void {
  terrain.unsafeSetVertexHeight(x, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y + 1, h);
  terrain.unsafeSetVertexHeight(x, y + 1, h);
}

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
    // Raise (5,5) and all 8 neighbors to h=2 so that tileCornerHeights gives all corners at 2.
    // This ensures the deformed polygon is lifted to the h=2 screen position, matching
    // the cursor placed via tileToScreenWithHeight(tile, 2).
    for (let ny = 4; ny <= 6; ny++) {
      for (let nx = 4; nx <= 6; nx++) {
        setTileCorners(terrain, nx, ny, 2);
      }
    }

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
    // Raise (5,5) and all 8 neighbors to h=3 so that tileCornerHeights gives all corners at 3,
    // ensuring the deformed polygon is lifted to the h=3 screen position.
    for (let ny = 4; ny <= 6; ny++) {
      for (let nx = 4; nx <= 6; nx++) {
        setTileCorners(terrain, nx, ny, 3);
      }
    }

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
    // Raise (5,5) and its NW-quadrant neighbors (n, w, nw) to h=2 so that the top vertex
    // of (5,5)'s deformed polygon is lifted to h=2. The top vertex = projectTileCornerScreen
    // with topH=min(2,n,w,nw)=2, which places it at tileToScreenWithHeight({5,5},2).
    // Only n/w/nw need to be lifted; e/s/se default 0 (those affect other corners).
    setTileCorners(terrain, 5, 5, 2);
    setTileCorners(terrain, 5, 4, 2); // n
    setTileCorners(terrain, 4, 5, 2); // w
    setTileCorners(terrain, 4, 4, 2); // nw

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
    // Raise (5,5) and all 8 neighbors to MAX_ELEVATION so that tileCornerHeights gives all
    // corners at MAX_ELEVATION, ensuring the deformed polygon sits at the fully lifted position.
    for (let ny = 4; ny <= 6; ny++) {
      for (let nx = 4; nx <= 6; nx++) {
        setTileCorners(terrain, nx, ny, MAX_ELEVATION);
      }
    }

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

describe('screenToTileWithTerrain (deformed-polygon picker)', () => {
  // Helper: build deformed polygon for a tile from a Terrain object.
  function buildPoly(terrain: Terrain, tx: number, ty: number) {
    const c = tileCornerHeights(terrain, tx, ty);
    return [
      projectTileCornerScreen({ x: tx, y: ty }, 'top',    c.topH),
      projectTileCornerScreen({ x: tx, y: ty }, 'right',  c.rightH),
      projectTileCornerScreen({ x: tx, y: ty }, 'bottom', c.bottomH),
      projectTileCornerScreen({ x: tx, y: ty }, 'left',   c.leftH),
    ];
  }

  it('slope_s: cursor at polygon centroid of (5,5) returns (5,5)', () => {
    // (5,5)=2, all 8 neighbors=2 except s=(5,6)=1.
    // tileCornerHeights(5,5): topH=2, rightH=2, bottomH=min(2,e=2,s=1,se=2)=1, leftH=min(2,s=1,w=2,sw=2)=1
    const terrain = new Terrain(10, 10);
    setTileCorners(terrain, 5, 5, 2);
    // Set all 8 neighbors to 2 except (5,6)
    for (const [nx, ny] of [[4,4],[5,4],[6,4],[4,5],[6,5],[4,6],[6,6]] as [number,number][]) {
      setTileCorners(terrain, nx, ny, 2);
    }
    setTileCorners(terrain, 5, 6, 1);

    const poly = buildPoly(terrain, 5, 5);
    const centroid = {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    };

    const result = screenToTileWithTerrain(centroid, terrain, 10, 10);
    expect(result).toEqual({ x: 5, y: 5 });
  });

  it('diagonal NE deformation: cursor at polygon centroid of (5,5) returns (5,5)', () => {
    // (5,5)=2, ne=(6,4)=1, all other 7 neighbors=2.
    // tileCornerHeights(5,5): topH=2, rightH=min(2,n=2,e=2,ne=1)=1, bottomH=2, leftH=2
    const terrain = new Terrain(10, 10);
    setTileCorners(terrain, 5, 5, 2);
    for (const [nx, ny] of [[4,4],[5,4],[4,5],[6,5],[4,6],[5,6],[6,6]] as [number,number][]) {
      setTileCorners(terrain, nx, ny, 2);
    }
    setTileCorners(terrain, 6, 4, 1);

    const poly = buildPoly(terrain, 5, 5);
    const centroid = {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    };

    const result = screenToTileWithTerrain(centroid, terrain, 10, 10);
    expect(result).toEqual({ x: 5, y: 5 });
  });

  it('radius-validating wedge: cursor inside deformed body (outside flat diamond) returns (8,8)', () => {
    // (8,8)=8, n=(8,7)=8, w=(7,8)=8, nw=(7,7)=8, all other neighbors default 0.
    // tileCornerHeights(8,8): topH=8, rightH=0, bottomH=0, leftH=0 — tall wedge.
    // The deformed polygon's body extends far below the flat-diamond boundary.
    // Cursor at (0, 230): inside deformed polygon but outside flat diamond;
    // flat fallback gives (7,7), not (8,8). Old radius-0 algo fails here.
    const terrain = new Terrain(10, 10);
    terrain.unsafeSetVertexHeight(8, 8, MAX_ELEVATION);
    terrain.unsafeSetVertexHeight(9, 8, 0);
    terrain.unsafeSetVertexHeight(9, 9, 0);
    terrain.unsafeSetVertexHeight(8, 9, 0);

    // Verify deformed polygon contains (0, 230) and flat fallback does not give (8,8)
    const poly = buildPoly(terrain, 8, 8);
    expect(polygonContains(poly, { x: 0, y: 230 })).toBe(true);
    expect(screenToTile({ x: 0, y: 230 })).not.toEqual({ x: 8, y: 8 });

    const result = screenToTileWithTerrain({ x: 0, y: 230 }, terrain, 10, 10);
    expect(result).toEqual({ x: 8, y: 8 });
  });

  it('same-height non-adjacent area-overlap: max-z winner returned (B wins over A)', () => {
    // 12x12 terrain.
    // Tile A at (5,5) H=8: incident cells set so topH=8, rightH=8, bottomH=0, leftH=0.
    //   n=(5,4)=8, nw=(4,4)=8, ne=(6,4)=8, w=(4,5)=8, e=(6,5)=8 → topH=8, rightH=8
    //   s=(5,6)=0, se=(6,6)=0, sw=(4,6)=0                          → bottomH=0, leftH=0
    // Tile B at (8,8) H=8 flat: all 8 neighbors=8 → all corners at 8.
    // Cursor at (0, 180) is interior to BOTH deformed polygons.
    // computeTerrainZIndex(8,5,5)=8_010_005 < computeTerrainZIndex(8,8,8)=8_016_008.
    // Picker must return B=(8,8).
    const terrain = new Terrain(12, 12);

    // Tile A direct vertices: top/right high, bottom/left low.
    terrain.unsafeSetVertexHeight(5, 5, 8);
    terrain.unsafeSetVertexHeight(6, 5, 8);
    terrain.unsafeSetVertexHeight(6, 6, 0);
    terrain.unsafeSetVertexHeight(5, 6, 0);

    // Tile B direct vertices: flat at 8.
    terrain.unsafeSetVertexHeight(8, 8, 8);
    terrain.unsafeSetVertexHeight(9, 8, 8);
    terrain.unsafeSetVertexHeight(9, 9, 8);
    terrain.unsafeSetVertexHeight(8, 9, 8);

    const cursor = { x: 0, y: 180 };

    // Verify both polygons contain the cursor
    const polyA = buildPoly(terrain, 5, 5);
    const polyB = buildPoly(terrain, 8, 8);
    expect(polygonContains(polyA, cursor)).toBe(true);
    expect(polygonContains(polyB, cursor)).toBe(true);

    // Picker must return B (higher z-index)
    const result = screenToTileWithTerrain(cursor, terrain, 12, 12);
    expect(result).toEqual({ x: 8, y: 8 });
  });

  it('shared-edge disambiguation: one cursor inside A, one inside B, picks correctly', () => {
    // A=(5,5) H=2 with all default-0 neighbors → tileCornerHeights all 0 (flat diamond at h=0 positions).
    // B=(5,6) H=1 with default-0 neighbors → tileCornerHeights all 0.
    // Both tiles produce flat-diamond polygons at their respective h=0 tile positions.
    // Cursor at A's centroid = center of A's flat diamond → h=2 band hits A.
    // Cursor at B's centroid = center of B's flat diamond → h=2 band has no hit, h=1 band hits B.
    const terrain = new Terrain(10, 10);
    setTileCorners(terrain, 5, 5, 2);
    setTileCorners(terrain, 5, 6, 1);

    // A's deformed polygon corners (all at h=0 since neighbors are 0):
    // screen0(5,5) = (0, 160); poly = [(0,160),(32,176),(0,192),(-32,176)]
    // centroid = (0, 176)
    const cursorA = { x: 0, y: 176 };

    // B's deformed polygon corners (all at h=0):
    // screen0(5,6) = (-32, 176); poly = [(-32,176),(0,192),(-32,208),(-64,192)]
    // centroid = (-32, 192)
    const cursorB = { x: -32, y: 192 };

    // Verify cursor placement via buildPoly
    const polyA = buildPoly(terrain, 5, 5);
    const polyB = buildPoly(terrain, 5, 6);
    expect(polygonContains(polyA, cursorA)).toBe(true);
    expect(polygonContains(polyB, cursorA)).toBe(false);
    expect(polygonContains(polyA, cursorB)).toBe(false);
    expect(polygonContains(polyB, cursorB)).toBe(true);

    expect(screenToTileWithTerrain(cursorA, terrain, 10, 10)).toEqual({ x: 5, y: 5 });
    expect(screenToTileWithTerrain(cursorB, terrain, 10, 10)).toEqual({ x: 5, y: 6 });
  });
});
