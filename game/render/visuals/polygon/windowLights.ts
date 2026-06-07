/**
 * Per-window light backing helpers for cube building walls.
 *
 * These functions compute window cells in the wall's fractional texture-tile
 * space so they align with the windows the wall texture actually shows. The
 * cell grid is defined in terms of (repeatX, repeatY) from `wallFaceRepeats`,
 * so a partial-repeat face (repeatX < 1) only shows the visible subset of the
 * window grid — no cells bleed past the face edge.
 *
 * Pure module: no side effects, no DOM, no Pixi. Only imports the `Point` type.
 */

import type { Point } from './cubeGeometry';

/** Window cells per wall tile along each axis. Must match the fixed art grid. */
export const WINDOWS_X = 3;
/** Window cells per wall tile along each axis. Must match the fixed art grid. */
export const WINDOWS_Y = 4;

// Salt constant distinct from wallVariant's hash (which uses 0x45d9f3b) so the
// two hashes produce independent distributions for the same buildingId.
const WINDOW_SEED_SALT = 0x9e3779b9;

/**
 * Deterministic per-building seed for window lighting, in [0, 64).
 * Uses a different salt than `wallVariant` so light patterns are independent of
 * which facade variant a building draws.
 */
export function windowSeed(buildingId: number): number {
  let h = buildingId | 0;
  h = Math.imul(h ^ (h >>> 16), WINDOW_SEED_SALT);
  h = Math.imul(h ^ (h >>> 16), WINDOW_SEED_SALT);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % 64;
}

/**
 * Returns true if the window cell at (col, row) is lit for the given seed.
 * Roughly 3/5 of cells are lit. Deterministic — same seed+col+row always yields
 * the same result.
 */
export function windowCellLit(seed: number, col: number, row: number): boolean {
  let h = (seed * 1000003 + col * 31337 + row * 6271) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % 5 < 3;
}

/**
 * Bilinear interpolation across the face quad at (u, v) in [0,1]x[0,1].
 * Face order: [topStart, topEnd, bottomEnd, bottomStart].
 */
function bilerp(face: ReadonlyArray<Point>, u: number, v: number): Point {
  const [tl, tr, br, bl] = face;
  const x =
    tl.x * (1 - u) * (1 - v) +
    tr.x * u * (1 - v) +
    br.x * u * v +
    bl.x * (1 - u) * v;
  const y =
    tl.y * (1 - u) * (1 - v) +
    tr.y * u * (1 - v) +
    br.y * u * v +
    bl.y * (1 - u) * v;
  return { x, y };
}

/**
 * Returns quads for every visible window cell on a face.
 *
 * `face` is [topStart, topEnd, bottomEnd, bottomStart] in anchor-local coords.
 * `repeatX` / `repeatY` come from `wallFaceRepeats(face)` — pass the same
 * values used for the texture fill matrix so cells align with texture windows.
 *
 * Each quad's `points` are face-LOCAL (no ox/oy offset) — add the draw offset
 * in the caller. Partial cells at the face boundary are clipped so u/v ≤ 1 and
 * cells entirely outside the face (u0 ≥ 1 or v0 ≥ 1) are omitted.
 */
export function windowCellQuads(
  face: ReadonlyArray<Point>,
  repeatX: number,
  repeatY: number,
): { points: Point[]; col: number; row: number }[] {
  const result: { points: Point[]; col: number; row: number }[] = [];

  const colCount = Math.ceil(repeatX * WINDOWS_X);
  const rowCount = Math.ceil(repeatY * WINDOWS_Y);

  for (let col = 0; col < colCount; col++) {
    // Texture-space U boundaries for this column.
    const texU0 = col / WINDOWS_X;
    const texU1 = (col + 1) / WINDOWS_X;
    // Face-space U boundaries (u ∈ [0,1] spans the full face).
    const u0 = texU0 / repeatX;
    const u1 = Math.min(texU1 / repeatX, 1);
    if (u0 >= 1) continue; // cell entirely past the shown texture

    for (let row = 0; row < rowCount; row++) {
      const texV0 = row / WINDOWS_Y;
      const texV1 = (row + 1) / WINDOWS_Y;
      const v0 = texV0 / repeatY;
      const v1 = Math.min(texV1 / repeatY, 1);
      if (v0 >= 1) continue;

      result.push({
        points: [
          bilerp(face, u0, v0),
          bilerp(face, u1, v0),
          bilerp(face, u1, v1),
          bilerp(face, u0, v1),
        ],
        col,
        row,
      });
    }
  }

  return result;
}
