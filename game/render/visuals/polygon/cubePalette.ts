/**
 * Pure palette helpers used by CubeBuildingVisual.
 * No imports from game/core, game/engine, game/tools, or game/input.
 */

type CubeBuildingType = 'residential' | 'commercial' | 'industrial';

// Base palette color for the building type — independent of the underlying
// terrain zone color (which lerps toward white with level). Cubes need
// separation from the ground; the building palette below is intentionally
// distinct so the cube doesn't visually merge into the lighter zone tile.
export function baseColor(type: CubeBuildingType): number {
  switch (type) {
    case 'residential': return 0xc2e8a0;   // soft pastel green
    case 'commercial':  return 0xa8c6f0;   // soft sky blue
    case 'industrial':  return 0xf0c890;   // warm sand
  }
}

export const ROOF_ACCENT_BRIGHTEN = 0.12;

// Multiply an RGB color channel-wise by `k`, clamped to [0, 255].
export function shadeColor(rgb: number, k: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((rgb >> 16) & 0xff) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((rgb >> 8) & 0xff) * k)));
  const b = Math.max(0, Math.min(255, Math.round((rgb & 0xff) * k)));
  return (r << 16) | (g << 8) | b;
}

export function lerpToWhite(rgb: number, t: number): number {
  const r = ((rgb >> 16) & 0xff) + Math.round((255 - ((rgb >> 16) & 0xff)) * t);
  const g = ((rgb >> 8)  & 0xff) + Math.round((255 - ((rgb >> 8)  & 0xff)) * t);
  const b = (rgb & 0xff)         + Math.round((255 - (rgb & 0xff))         * t);
  return (r << 16) | (g << 8) | b;
}

// Density tier saturates the base color slightly (cubes at higher density
// look richer); levels 0..ZONE_MAX_LEVEL leave the base unchanged for now.
export function densityShade(density: 0 | 1 | 2): number {
  // 0 → 1.00 (base), 1 → 0.92 (slightly richer / less pastel), 2 → 0.82.
  return density === 0 ? 1.0 : density === 1 ? 0.92 : 0.82;
}
