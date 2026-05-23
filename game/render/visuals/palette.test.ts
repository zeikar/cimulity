/**
 * Tests for tileFillColor: elevation-derived water branch + zone lerp.
 */

import { describe, it, expect } from 'vitest';
import { tileFillColor, TILE_COLORS, WATER_COLOR } from './palette';
import { TileType } from '@/game/core/Tile';
import { SEA_LEVEL, MIN_LAND_ELEVATION } from '@/game/core/Terrain';

describe('tileFillColor', () => {
  it('(a) GRASS above sea level returns grass base color', () => {
    expect(tileFillColor(TileType.GRASS, 0, 5)).toBe(TILE_COLORS.grass);
  });

  it('(b) GRASS at SEA_LEVEL returns WATER_COLOR', () => {
    expect(tileFillColor(TileType.GRASS, 0, SEA_LEVEL)).toBe(WATER_COLOR);
  });

  it('(c) GRASS at MIN_LAND_ELEVATION returns grass base color', () => {
    expect(tileFillColor(TileType.GRASS, 0, MIN_LAND_ELEVATION)).toBe(TILE_COLORS.grass);
  });

  it('(d) ROAD at elevation 0 returns road color (water branch fires only for GRASS)', () => {
    expect(tileFillColor(TileType.ROAD, 0, 0)).toBe(TILE_COLORS.road);
  });

  it('(e) ZONE_RESIDENTIAL at level 3, elev 5 returns zone-lerp result', () => {
    // Verify the zone-lerp path is still reached when type is not GRASS.
    const result = tileFillColor(TileType.ZONE_RESIDENTIAL, 3, 5);
    // level 3 out of ZONE_MAX_LEVEL=5, K=0.6: t=0.6, should lighten from base
    const base = TILE_COLORS.zone_residential;
    expect(result).not.toBe(base); // should be lighter
    expect(result).toBeGreaterThan(0);
    // Verify same result as direct calculation
    const K = 0.6;
    const ZONE_MAX_LEVEL = 5;
    const t = Math.min(Math.max(3 / ZONE_MAX_LEVEL, 0), 1);
    const r = (base >> 16) & 0xff;
    const g = (base >> 8) & 0xff;
    const b = base & 0xff;
    const r2 = Math.round(r + (255 - r) * t * K);
    const g2 = Math.round(g + (255 - g) * t * K);
    const b2 = Math.round(b + (255 - b) * t * K);
    expect(result).toBe((r2 << 16) | (g2 << 8) | b2);
  });
});
