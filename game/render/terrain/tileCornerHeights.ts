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
 * Vertex-smooth mode stores shared corner heights directly:
 *   topH    = vertex (x, y)
 *   rightH  = vertex (x + 1, y)
 *   bottomH = vertex (x + 1, y + 1)
 *   leftH   = vertex (x, y + 1)
 */
export function tileCornerHeights(terrain: Terrain, x: number, y: number): CornerHeights {
  return terrain.getTileCornerHeights(x, y);
}
