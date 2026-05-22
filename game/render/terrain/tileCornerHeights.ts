import type { Terrain } from "@/game/core/Terrain";

export type CornerHeights = {
  topH: number;
  rightH: number;
  bottomH: number;
  leftH: number;
};

/**
 * Computes the four diamond-corner heights for a tile at (x, y).
 *
 * Each corner is the MIN of the elevations of the 4 tiles meeting at that corner.
 * OOB neighbors substitute the center tile's own elevation H (NOT 0).
 *
 *   topH    = min(H, n, w, nw)   — top diamond corner
 *   rightH  = min(H, n, e, ne)   — right diamond corner
 *   bottomH = min(H, e, s, se)   — bottom diamond corner
 *   leftH   = min(H, s, w, sw)   — left diamond corner
 */
export function tileCornerHeights(terrain: Terrain, x: number, y: number): CornerHeights {
  const H = terrain.getTileElevation(x, y);

  // Read neighbor elevation; substitute H if OOB (getTileElevation returns 0 for OOB,
  // so we check bounds via the terrain dimensions instead).
  const w = terrain.getWidth();
  const h = terrain.getHeight();

  function elev(nx: number, ny: number): number {
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) return H;
    return terrain.getTileElevation(nx, ny);
  }

  const n  = elev(x,     y - 1);
  const e  = elev(x + 1, y    );
  const s  = elev(x,     y + 1);
  const ww = elev(x - 1, y    );
  const nw = elev(x - 1, y - 1);
  const ne = elev(x + 1, y - 1);
  const se = elev(x + 1, y + 1);
  const sw = elev(x - 1, y + 1);

  return {
    topH:    Math.min(H, n, ww, nw),
    rightH:  Math.min(H, n, e,  ne),
    bottomH: Math.min(H, e, s,  se),
    leftH:   Math.min(H, s, ww, sw),
  };
}
