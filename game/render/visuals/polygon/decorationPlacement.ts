/**
 * Deterministic decoration placement for park tiles and street objects.
 *
 * Pure module: no Pixi, no DOM. Safe to import in vitest headless tests.
 *
 * The hash function uses a salt distinct from windowLights' 0x9e3779b9 and
 * faceTexture's 0x45d9f3b so decoration distributions are independent of
 * building-facade or window-light hashing for any given id.
 *
 * Street-tree offset derivation (from IsoTransform.ts iso basis):
 *   screenX = (tileX - tileY) * 32,  screenY = (tileX + tileY) * 16
 * So one tile step in each data direction maps to these screen deltas:
 *   tile (+1, 0) → screen (+32, +16)
 *   tile (-1, 0) → screen (-32, -16)
 *   tile ( 0,+1) → screen (-32, +16)
 *   tile ( 0,-1) → screen (+32, -16)
 * The tree dx/dy are these unit vectors scaled by STREET_SHOULDER (a fraction
 * of a tile) so the trunk sits on the grass shoulder, not in the road.
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

// ── Street-tree placement ────────────────────────────────────────────────────

/**
 * Fraction of the tile used to bias the tree trunk toward the road edge.
 * TILE_WIDTH=64 → hw=32; TILE_HEIGHT=32 → hh=16.
 * STREET_SHOULDER=0.25 gives dx-max=8 px, dy-max=4 px — shoulder-width offset.
 */
const STREET_SHOULDER = 0.25;
const HW = 32; // TILE_WIDTH / 2
const HH = 16; // TILE_HEIGHT / 2

/**
 * Proportion of roadside grass cells that get a street tree (out of 100).
 * Lower = sparser. Tunable without touching any other logic.
 */
const STREET_DENSITY = 50;

export interface StreetTreeCandidate {
  /** Unique stable key for this tree. */
  key: string;
  /** Sprite variant index (0 or 1). */
  variant: 0 | 1;
  /** Screen-space X offset (px) toward the adjacent road edge, from tile center. */
  dx: number;
  /** Screen-space Y offset (px) toward the adjacent road edge, from tile center. */
  dy: number;
}

/**
 * Decide whether a street tree stands at grass cell (x, y).
 *
 * Returns a StreetTreeCandidate (with shoulder-biased screen offset) when:
 *   - isPlainGrass(x, y) is true
 *   - exactly 1 of the 4 orthogonal data neighbors is a road tile
 *   - decoHash(x, y, STREET_SALT) % 100 < STREET_DENSITY (~50 % density)
 *
 * Returns null for junctions (≥2 road neighbors), non-roadside cells (0 road
 * neighbors), non-grass cells, and cells that fail the hash gate.
 */
export function streetTreeForCell(
  x: number,
  y: number,
  isRoad: (x: number, y: number) => boolean,
  isPlainGrass: (x: number, y: number) => boolean,
): StreetTreeCandidate | null {
  if (!isPlainGrass(x, y)) return null;

  // Orthogonal data neighbors: tile-space delta → [neighbor, screen delta]
  // Screen delta derived from iso basis (see module comment).
  const neighbors: [nx: number, ny: number, sdx: number, sdy: number][] = [
    [x + 1, y,     HW * STREET_SHOULDER,  HH * STREET_SHOULDER],  // tile (+1,0)
    [x - 1, y,    -HW * STREET_SHOULDER, -HH * STREET_SHOULDER],  // tile (-1,0)
    [x,     y + 1, -HW * STREET_SHOULDER,  HH * STREET_SHOULDER], // tile (0,+1)
    [x,     y - 1,  HW * STREET_SHOULDER, -HH * STREET_SHOULDER], // tile (0,-1)
  ];

  const roadNeighbors = neighbors.filter(([nx, ny]) => isRoad(nx, ny));

  if (roadNeighbors.length === 0 || roadNeighbors.length >= 2) return null;

  const h = decoHash(x, y, STREET_SALT);
  if (h % 100 >= STREET_DENSITY) return null;

  const [, , sdx, sdy] = roadNeighbors[0];
  return {
    key: `street:${x}:${y}`,
    variant: (h % 2) as 0 | 1,
    dx: sdx,
    dy: sdy,
  };
}

// ── Empty-land (plain-grass) tree placement ──────────────────────────────────

/**
 * Fraction of plain-grass cells that host ≥1 tree (out of 100).
 * EMPTY_DENSITY=15 → ~15% cell-hosting rate, within the 10–20% design target.
 */
export const EMPTY_DENSITY = 15;

export interface LandTree {
  /** Unique stable key: "land:x:y:i" where i is the slot index on this cell. */
  key: string;
  /** Sprite variant (0 or 1). */
  variant: 0 | 1;
  /** Sub-tile screen-space X offset (px) from tile center. */
  dx: number;
  /** Sub-tile screen-space Y offset (px) from tile center. */
  dy: number;
  /** Slot index within this cell (0 or 1); use for intra-tile z ordering. */
  slotIndex: number;
}

/**
 * Returns 0–2 deterministic trees for a plain-grass cell (x, y).
 *
 * Eligibility (GRASS + no structure owner, DIRT excluded) is fully delegated to
 * the isPlainGrass predicate — this function never inspects tile state itself.
 *
 * Clustering is hash-driven on orthogonal neighbor coordinates (not isPlainGrass
 * on neighbors) so a cell's tree count stays stable regardless of what gets built
 * on adjacent tiles after placement.
 */
export function landTreesForCell(
  x: number,
  y: number,
  isPlainGrass: (x: number, y: number) => boolean,
): LandTree[] {
  if (!isPlainGrass(x, y)) return [];

  // Base gate: ~EMPTY_DENSITY% of cells host any trees.
  if (decoHash(x, y, EMPTY_SALT) % 100 >= EMPTY_DENSITY) return [];

  // Clustering: count orthogonal neighbors that also pass the base density gate.
  // Deliberately uses decoHash on neighbor coords (not isPlainGrass on neighbors)
  // so cluster size is map-mutation-independent and purely hash-driven.
  const neighborPasses = [
    decoHash(x + 1, y, EMPTY_SALT) % 100 < EMPTY_DENSITY,
    decoHash(x - 1, y, EMPTY_SALT) % 100 < EMPTY_DENSITY,
    decoHash(x, y + 1, EMPTY_SALT) % 100 < EMPTY_DENSITY,
    decoHash(x, y - 1, EMPTY_SALT) % 100 < EMPTY_DENSITY,
  ];
  const qualifyingNeighbors = neighborPasses.filter(Boolean).length;

  // Base count is always 1 (cell passed the gate above).
  // Add a second tree when ≥2 neighbors also pass, forming loose groves.
  const count = qualifyingNeighbors >= 2 ? 2 : 1;

  const trees: LandTree[] = [];
  for (let i = 0; i < count; i++) {
    // Use separate salted hashes for dx, dy, and variant to avoid correlation.
    // +10/+20 shifts keep the three channels collision-free while max count ≤ 9;
    // raise these shift constants if the tree count cap ever grows beyond that.
    const hx = decoHash(x, y, i, EMPTY_SALT);
    const hy = decoHash(x, y, i + 10, EMPTY_SALT); // shifted slot index decorrelates dy
    const hv = decoHash(x, y, i + 20, EMPTY_SALT); // shifted again for variant

    // Jitter: |dx| ≤ floor(HW*0.6) = 19px, |dy| ≤ floor(HH*0.6) = 9px (trees stay on-cell).
    // Map the low bits to a signed range: (bits % range) - half_range.
    const dxRange = Math.floor(HW * 0.6) * 2;
    const dyRange = Math.floor(HH * 0.6) * 2;
    const dx = (hx % dxRange) - Math.floor(dxRange / 2);
    const dy = (hy % dyRange) - Math.floor(dyRange / 2);

    trees.push({
      key: `land:${x}:${y}:${i}`,
      variant: (hv % 2) as 0 | 1,
      dx,
      dy,
      slotIndex: i,
    });
  }
  return trees;
}

// ── Park placement ───────────────────────────────────────────────────────────

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
