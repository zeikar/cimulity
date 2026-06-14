/**
 * roadAutoTile — pure render-only mask classifier for road auto-tiling.
 *
 * Accepts a closure `isRoad(dx, dy)` that returns true iff the tile at offset
 * (dx, dy) from the center tile is a road (out-of-bounds tiles report false).
 * Returns a RoadDescriptor with:
 *   - `mask`  — 4-bit orthogonal neighbour mask (N=1, E=2, S=4, W=8)
 *   - `kind`  — sprite classification
 *   - `arms`  — ordered list of set orthogonal bits as OrthoDirName (compass direction names)
 *
 * Accepted limitations (render-cosmetic only; zero simulation impact):
 *   (a) A single-step diagonal (1,1)->(2,2) emits intermediate tile (1,2) with
 *       arms N+E but no perpendicular-axis diagonal road present, so it renders
 *       as a 90° corner — ACCEPTED.
 *   (b) A stray perpendicular-axis diagonal road next to a STANDALONE 90° turn
 *       can cosmetically false-positive that corner as `diagonal` — ACCEPTED.
 */

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

type OrthoDirName = 'N' | 'E' | 'S' | 'W';

/** Single source of truth for the ordered orthogonal direction table. */
const ORTHO_DIRS = [
  { name: 'N' as OrthoDirName, dx: 0,  dy: -1, bit: N },
  { name: 'E' as OrthoDirName, dx: 1,  dy:  0, bit: E },
  { name: 'S' as OrthoDirName, dx: 0,  dy:  1, bit: S },
  { name: 'W' as OrthoDirName, dx: -1, dy:  0, bit: W },
] as const;

export type RoadSpriteKind =
  | 'isolated'
  | 'end'
  | 'straight'
  | 'corner'
  | 'tee'
  | 'cross'
  | 'diagonal';

export interface RoadDescriptor {
  kind: RoadSpriteKind;
  mask: number;
  arms: ReadonlyArray<OrthoDirName>;
}

export function roadAutoTile(isRoad: (dx: number, dy: number) => boolean): RoadDescriptor {
  // Build the 4-bit orthogonal mask.
  let mask = 0;
  for (const { bit, dx, dy } of ORTHO_DIRS) {
    if (isRoad(dx, dy)) mask |= bit;
  }

  // Collect arms in N,E,S,W order.
  const arms = ORTHO_DIRS
    .filter(a => (mask & a.bit) !== 0)
    .map(a => a.name);

  const popcount = arms.length;

  // Base classification from orthogonal mask.
  let kind: RoadSpriteKind;

  if (popcount === 0) {
    kind = 'isolated';
  } else if (popcount === 1) {
    kind = 'end';
  } else if (popcount === 2) {
    // Two bits: straight (opposite) or corner (adjacent).
    if (mask === (N | S) || mask === (E | W)) {
      kind = 'straight';
    } else {
      kind = 'corner';
    }
  } else if (popcount === 3) {
    kind = 'tee';
  } else {
    kind = 'cross';
  }

  // Diagonal-staircase reclassification — only applies to 'corner'.
  if (kind === 'corner') {
    kind = classifyCornerDiagonal(mask, isRoad);
  }

  return { kind, mask, arms };
}

/**
 * Reclassifies a corner as 'diagonal' when the road continues along the
 * diagonal axis PERPENDICULAR to the corner's own arm-diagonal axis.
 *
 * Corner arm-diagonal axis:
 *   N+E or S+W => arm-diagonal is NE–SW; perpendicular-axis diagonals are NW and SE.
 *   E+S or N+W => arm-diagonal is NW–SE; perpendicular-axis diagonals are NE and SW.
 *
 * Diagonal neighbour offsets: NE=(+1,-1), SE=(+1,+1), SW=(-1,+1), NW=(-1,-1).
 */
function classifyCornerDiagonal(
  mask: number,
  isRoad: (dx: number, dy: number) => boolean,
): RoadSpriteKind {
  const nw = isRoad(-1, -1);
  const ne = isRoad( 1, -1);
  const se = isRoad( 1,  1);
  const sw = isRoad(-1,  1);

  if (mask === (N | E) || mask === (S | W)) {
    // Arm-diagonal axis: NE–SW; perpendicular-axis diagonals: NW, SE.
    return (nw || se) ? 'diagonal' : 'corner';
  }
  // mask === (E | S) || mask === (N | W)
  // Arm-diagonal axis: NW–SE; perpendicular-axis diagonals: NE, SW.
  return (ne || sw) ? 'diagonal' : 'corner';
}
