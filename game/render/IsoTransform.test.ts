import { describe, it, expect } from 'vitest';
import {
  ISO_CONFIG,
  tileToScreen,
  screenToTile,
  tileCenterToScreen,
} from './IsoTransform';

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
