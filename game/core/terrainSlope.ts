export const LOWER_N = 1;
export const LOWER_E = 2;
export const LOWER_S = 4;
export const LOWER_W = 8;

export type TerrainShape =
  | "flat"
  | "slope_n"
  | "slope_e"
  | "slope_s"
  | "slope_w"
  | "slope_ne"
  | "slope_se"
  | "slope_sw"
  | "slope_nw"
  | "rough";

/**
 * Returns a bitmask indicating which orthogonal neighbors are LOWER than center.
 * Pass `center` as a neighbor's value to indicate OOB (treats as equal — bit unset).
 * Cliffs (diff > 1) still set the bit; no special handling.
 */
export function slopeMaskFor(
  center: number,
  n: number,
  e: number,
  s: number,
  w: number
): number {
  let mask = 0;
  if (n < center) mask |= LOWER_N;
  if (e < center) mask |= LOWER_E;
  if (s < center) mask |= LOWER_S;
  if (w < center) mask |= LOWER_W;
  return mask;
}

/**
 * Maps a slope bitmask to a named terrain shape.
 * The 9 documented cardinal/diagonal slopes return their named shape;
 * all other non-zero masks return "rough".
 */
export function terrainShapeFor(mask: number): TerrainShape {
  switch (mask) {
    case 0:  return "flat";
    case 1:  return "slope_n";
    case 2:  return "slope_e";
    case 4:  return "slope_s";
    case 8:  return "slope_w";
    case 3:  return "slope_ne";
    case 6:  return "slope_se";
    case 12: return "slope_sw";
    case 9:  return "slope_nw";
    default: return "rough";
  }
}
