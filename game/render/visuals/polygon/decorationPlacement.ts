/**
 * Deterministic decoration placement for park tiles and street objects.
 *
 * Pure module: no Pixi, no DOM. Safe to import in vitest headless tests.
 *
 * The hash function uses a salt distinct from windowLights' 0x9e3779b9 and
 * faceTexture's 0x45d9f3b so decoration distributions are independent of
 * building-facade or window-light hashing for any given id.
 */

// Salt distinct from windowLights' 0x9e3779b9 / 0x45d9f3b so distributions
// are independent.
const DECO_SALT = 0x27d4eb2f;

/** Per-category salts passed as extra arguments to decoHash. */
export const PARK_SALT = 1;
export const STREET_SALT = 2;
export const EMPTY_SALT = 3;

/** Deterministic unsigned 32-bit hash of an integer tuple.
 *  View-independent: seed only from (x,y)/id + a category salt, never
 *  Math.random / iteration order / frame count. */
export function decoHash(...nums: number[]): number {
  let h = DECO_SALT | 0;
  for (const n of nums) {
    h = Math.imul(h ^ (n | 0), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 15), 0x45d9f3b);
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

export type ParkObjectKind = 'tree0' | 'tree1' | 'bench' | 'flowerbed';

export interface ParkSlot {
  /** Unique stable key for this decoration. */
  key: string;
  kind: ParkObjectKind;
  /** Sub-tile screen-space X offset (px) added to the tile-center position. */
  dx: number;
  /** Sub-tile screen-space Y offset (px) added to the tile-center position. */
  dy: number;
}

// Tile is 64×32 px in screen space (ISO_CONFIG). Place objects ≈ 1/4 tile from
// center so they sit near opposite corners without clipping the tile diamond.
const OFFSET_X = 10; // ~1/3 of half-tile-width (32 px)
const OFFSET_Y = 6;  // ~1/3 of half-tile-height (16 px)

/**
 * Returns exactly two decoration slots for a 1×1 park tile.
 *
 * Slot 0 is always a tree (variant chosen by hash), placed toward the
 * upper-left corner. Slot 1 is a secondary prop (bench or flowerbed), placed
 * toward the lower-right corner. The center of the tile is left unobstructed.
 *
 * `ax`/`ay` are the cell-anchor grid coordinates; in a 1×1 park they are not
 * needed for offsets but are accepted for API consistency with future multi-cell
 * parks.
 */
export function parkObjectsForCell(id: number, ax: number, ay: number): ParkSlot[] {
  // ax/ay kept for future multi-cell use; suppress unused-variable lint.
  void ax;
  void ay;

  const h = decoHash(id, PARK_SALT);

  // Bit 0 → tree variant (tree0 vs tree1).
  const treeKind: ParkObjectKind = (h & 1) === 0 ? 'tree0' : 'tree1';

  // Bit 1 → secondary prop.
  const propKind: ParkObjectKind = (h & 2) === 0 ? 'bench' : 'flowerbed';

  return [
    {
      key: `park:${id}:0`,
      kind: treeKind,
      // Tree toward upper-left of the iso diamond.
      dx: -OFFSET_X,
      dy: -OFFSET_Y,
    },
    {
      key: `park:${id}:1`,
      kind: propKind,
      // Prop toward lower-right of the iso diamond.
      dx: OFFSET_X,
      dy: OFFSET_Y,
    },
  ];
}
