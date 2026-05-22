import { describe, it, expect } from 'vitest';
import { tileToScreenWithHeight, ISO_CONFIG } from '@/game/render/IsoTransform';
import { MAX_ELEVATION, ELEVATION_HEIGHT } from '@/game/core';
import { oobFloorY, southSkirtVertices, eastSkirtVertices } from './DiamondOOBSkirt';

describe('oobFloorY', () => {
  it('floor Y = screen0.y + TILE_HEIGHT + MAX_ELEVATION * ELEVATION_HEIGHT', () => {
    const tile = { x: 5, y: 5 };
    const screen0 = tileToScreenWithHeight(tile, 0);
    expect(oobFloorY(tile)).toBe(screen0.y + ISO_CONFIG.TILE_HEIGHT + MAX_ELEVATION * ELEVATION_HEIGHT);
  });
});

describe('southSkirtVertices', () => {
  it('returns [bottom, left, leftFloor, bottomFloor]', () => {
    const tile = { x: 5, y: 5 };
    const bottom = { x: 0, y: 100 };
    const left   = { x: -32, y: 80 };
    const floorY = oobFloorY(tile);
    expect(southSkirtVertices(tile, bottom, left)).toEqual([
      bottom,
      left,
      { x: left.x,   y: floorY },
      { x: bottom.x, y: floorY },
    ]);
  });
});

describe('eastSkirtVertices', () => {
  it('returns [right, bottom, bottomFloor, rightFloor]', () => {
    const tile = { x: 5, y: 5 };
    const right  = { x: 32, y: 80 };
    const bottom = { x: 0, y: 100 };
    const floorY = oobFloorY(tile);
    expect(eastSkirtVertices(tile, right, bottom)).toEqual([
      right,
      bottom,
      { x: bottom.x, y: floorY },
      { x: right.x,  y: floorY },
    ]);
  });
});
