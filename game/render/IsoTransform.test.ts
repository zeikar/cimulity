import { describe, it, expect } from 'vitest';
import {
  ISO_CONFIG,
  tileToScreen,
  tileToScreenWithHeight,
  screenToTile,
  screenToTileRaw,
  screenToTileWithTerrain,
  tileCenterToScreen,
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
