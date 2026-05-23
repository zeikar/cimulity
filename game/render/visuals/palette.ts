/**
 * Shared tile color palette and level-lerp helper.
 * Pure arithmetic — no Pixi imports.
 */

import type { TileType } from '@/game/core/Tile';
import { isZoneType } from '@/game/core/Tile';
import { ZONE_MAX_LEVEL } from '@/game/core/World';
import { SEA_LEVEL } from '@/game/core/Terrain';

/** Canonical water color — single source of truth for elevation-derived water rendering. */
export const WATER_COLOR = 0x2e6ba3;

/** Base fill color per tile type. */
export const TILE_COLORS: Record<TileType, number> = {
  grass: 0x4a9e3d,
  dirt: 0x8b6f47,
  road: 0x4a4a4a,
  zone_residential: 0x3cc44b,
  zone_commercial: 0x2f8fd6,
  zone_industrial: 0xe8c531,
};

/**
 * Are these corner heights renderable as water for the given tile type?
 *
 * Mirrors `tileFillColor`'s water branch (grass + elevation ≤ SEA_LEVEL) but
 * applied to an arbitrary set of corner heights — used by the per-triangle
 * "all corners submerged" check in `DiamondTileVisual`. The grass gate
 * matches the palette contract: only grass tiles ever render as water.
 * Roads, zones, and dirt above sea level keep their own color even if
 * MIN-of-4 corner heights drop them to sea level.
 */
export function cornersRenderAsWater(type: TileType, cornerHeights: readonly number[]): boolean {
  if (type !== 'grass') return false;
  for (const h of cornerHeights) if (h > SEA_LEVEL) return false;
  return cornerHeights.length > 0;
}

/**
 * Compute fill color for a tile.
 * Elevation-derived water: GRASS tiles at or below SEA_LEVEL render as water.
 * Non-zone tiles return the exact base color.
 * Zone tiles interpolate toward white as level grows — brighter = more developed.
 * K=0.6 caps lightening so max level is clearly lighter but not pure white.
 */
export function tileFillColor(type: TileType, level: number, tileElevation: number): number {
  // Elevation-derived water: GRASS at or below sea level is visually water.
  if (type === 'grass' && tileElevation <= SEA_LEVEL) return WATER_COLOR;
  const base = TILE_COLORS[type];
  if (!isZoneType(type)) return base;

  const K = 0.6;
  const t = Math.min(Math.max(level / ZONE_MAX_LEVEL, 0), 1);
  const r = (base >> 16) & 0xff;
  const g = (base >> 8) & 0xff;
  const b = base & 0xff;
  const r2 = Math.round(r + (255 - r) * t * K);
  const g2 = Math.round(g + (255 - g) * t * K);
  const b2 = Math.round(b + (255 - b) * t * K);
  return (r2 << 16) | (g2 << 8) | b2;
}
