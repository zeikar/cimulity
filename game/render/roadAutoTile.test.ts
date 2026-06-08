import { describe, it, expect } from 'vitest';
import { roadAutoTile, N, E, S, W } from './roadAutoTile';

// ── Fixture builder ──────────────────────────────────────────────────────────

/** Returns an isRoad closure that is true only for tiles in the set. */
function makeIsRoad(coords: Array<[number, number]>) {
  const keys = new Set(coords.map(([dx, dy]) => `${dx},${dy}`));
  return (dx: number, dy: number) => keys.has(`${dx},${dy}`);
}

// ── Orthogonal base classification ───────────────────────────────────────────

describe('isolated', () => {
  it('returns isolated when no neighbours', () => {
    const r = roadAutoTile(makeIsRoad([]));
    expect(r.kind).toBe('isolated');
    expect(r.mask).toBe(0);
    expect(r.arms).toEqual([]);
  });
});

describe('end', () => {
  const cases: Array<[string, [number, number], string[]]> = [
    ['N-end', [0, -1], ['N']],
    ['E-end', [1,  0], ['E']],
    ['S-end', [0,  1], ['S']],
    ['W-end', [-1, 0], ['W']],
  ];
  for (const [label, coord, arms] of cases) {
    it(label, () => {
      const r = roadAutoTile(makeIsRoad([coord]));
      expect(r.kind).toBe('end');
      expect(r.arms).toEqual(arms);
    });
  }
});

describe('straight', () => {
  it('N+S straight', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [0, 1]]));
    expect(r.kind).toBe('straight');
    expect(r.mask).toBe(N | S);
    expect(r.arms).toEqual(['N', 'S']);
  });
  it('E+W straight', () => {
    const r = roadAutoTile(makeIsRoad([[1, 0], [-1, 0]]));
    expect(r.kind).toBe('straight');
    expect(r.mask).toBe(E | W);
    expect(r.arms).toEqual(['E', 'W']);
  });
});

describe('corner (no diagonal reclassification)', () => {
  // Each corner: no diagonal roads present so they stay 'corner'.
  const cases: Array<[string, Array<[number, number]>, string[]]> = [
    ['N+E', [[0, -1], [1, 0]],  ['N', 'E']],
    ['E+S', [[1, 0],  [0, 1]],  ['E', 'S']],
    ['S+W', [[0, 1],  [-1, 0]], ['S', 'W']],
    ['N+W', [[0, -1], [-1, 0]], ['N', 'W']],
  ];
  for (const [label, coords, arms] of cases) {
    it(`${label} with no diagonal neighbours => corner`, () => {
      const r = roadAutoTile(makeIsRoad(coords));
      expect(r.kind).toBe('corner');
      expect(r.arms).toEqual(arms);
    });
  }
});

describe('tee', () => {
  it('N+E+S tee (mask = N|E|S)', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [0, 1]]));
    expect(r.kind).toBe('tee');
    expect(r.mask).toBe(N | E | S);
    expect(r.arms).toEqual(['N', 'E', 'S']);
  });
  it('E+S+W tee', () => {
    const r = roadAutoTile(makeIsRoad([[1, 0], [0, 1], [-1, 0]]));
    expect(r.kind).toBe('tee');
    expect(r.mask).toBe(E | S | W);
  });
  it('S+W+N tee', () => {
    const r = roadAutoTile(makeIsRoad([[0, 1], [-1, 0], [0, -1]]));
    expect(r.kind).toBe('tee');
  });
  it('W+N+E tee', () => {
    const r = roadAutoTile(makeIsRoad([[-1, 0], [0, -1], [1, 0]]));
    expect(r.kind).toBe('tee');
  });
});

describe('cross', () => {
  it('all four arms => cross', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [0, 1], [-1, 0]]));
    expect(r.kind).toBe('cross');
    expect(r.mask).toBe(N | E | S | W);
    expect(r.arms).toEqual(['N', 'E', 'S', 'W']);
  });
});

// ── Diagonal-staircase reclassification ──────────────────────────────────────

describe('diagonal staircase detection', () => {
  // N+E corner: perpendicular-axis diagonals are NW=(-1,-1) and SE=(+1,+1).
  it('N+E corner WITH SE diagonal => diagonal', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [1, 1]]));
    expect(r.kind).toBe('diagonal');
    expect(r.arms).toEqual(['N', 'E']);
  });
  it('N+E corner WITH NW diagonal => diagonal', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [-1, -1]]));
    expect(r.kind).toBe('diagonal');
  });
  it('N+E corner WITHOUT any perpendicular-axis diagonal => corner', () => {
    // Only orthogonal N+E, no NW/SE neighbours.
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0]]));
    expect(r.kind).toBe('corner');
  });

  // E+S corner: perpendicular-axis diagonals are NE=(+1,-1) and SW=(-1,+1).
  it('E+S corner WITH NE diagonal => diagonal', () => {
    const r = roadAutoTile(makeIsRoad([[1, 0], [0, 1], [1, -1]]));
    expect(r.kind).toBe('diagonal');
    expect(r.arms).toEqual(['E', 'S']);
  });
  it('E+S corner WITH SW diagonal => diagonal', () => {
    const r = roadAutoTile(makeIsRoad([[1, 0], [0, 1], [-1, 1]]));
    expect(r.kind).toBe('diagonal');
  });
  it('E+S corner WITHOUT any perpendicular-axis diagonal => corner', () => {
    const r = roadAutoTile(makeIsRoad([[1, 0], [0, 1]]));
    expect(r.kind).toBe('corner');
  });

  // S+W corner: perpendicular-axis diagonals are NW=(-1,-1) and SE=(+1,+1).
  it('S+W corner WITH SE diagonal => diagonal', () => {
    const r = roadAutoTile(makeIsRoad([[0, 1], [-1, 0], [1, 1]]));
    expect(r.kind).toBe('diagonal');
  });
  it('S+W corner WITHOUT perpendicular-axis diagonal => corner', () => {
    const r = roadAutoTile(makeIsRoad([[0, 1], [-1, 0]]));
    expect(r.kind).toBe('corner');
  });

  // N+W corner: perpendicular-axis diagonals are NE=(+1,-1) and SW=(-1,+1).
  it('N+W corner WITH NE diagonal => diagonal', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [-1, 0], [1, -1]]));
    expect(r.kind).toBe('diagonal');
  });
  it('N+W corner WITHOUT perpendicular-axis diagonal => corner', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [-1, 0]]));
    expect(r.kind).toBe('corner');
  });
});

describe('ignored-axis diagonal stays corner', () => {
  // N+E corner with ONLY NE/SW diagonals (same axis as the arms) — NOT the
  // perpendicular axis (NW/SE), so it should stay 'corner'.
  it('N+E corner with only NE diagonal (same axis as arms) => corner', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [1, -1]]));
    // NE=(+1,-1) is on the same arm-diagonal axis as N+E, not the perp axis.
    expect(r.kind).toBe('corner');
  });
  it('N+E corner with only SW diagonal (same axis as arms) => corner', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [-1, 1]]));
    expect(r.kind).toBe('corner');
  });
});

describe('non-corner kinds ignore diagonal neighbours', () => {
  it('straight N+S with all diagonal neighbours stays straight', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [0, 1], [1, -1], [1, 1], [-1, -1], [-1, 1]]));
    expect(r.kind).toBe('straight');
  });
  it('tee with diagonal neighbours stays tee', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [0, 1], [1, 1]]));
    expect(r.kind).toBe('tee');
  });
  it('cross with diagonal neighbours stays cross', () => {
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1]]));
    expect(r.kind).toBe('cross');
  });
});

// ── Canonical staircase proof ─────────────────────────────────────────────────

describe('canonical staircase (1,1),(1,2),(2,2),(2,3),(3,3) interior elbows', () => {
  // We test each interior elbow tile in isolation by providing isRoad for its
  // actual neighbours in the staircase.

  // Tile (1,2): arms N=(1,1) and E=(2,2) => N+E corner.
  // SE of (1,2) is (2,3) which is road => diagonal.
  it('tile (1,2): N+E corner, SE=(2,3) is road => diagonal', () => {
    // Offsets from (1,2): N=(0,-1)=(1,1)✓, E=(1,0)=(2,2)✓, SE=(1,1)=(2,3)✓.
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [1, 1]]));
    expect(r.kind).toBe('diagonal');
  });

  // Tile (2,2): arms S=(2,3) and W=(1,2) => S+W corner.
  // NW of (2,2) is (1,1) which is road => diagonal.
  // SE of (2,2) is (3,3) which is road => diagonal.
  it('tile (2,2): S+W corner, NW=(1,1) road => diagonal', () => {
    // Offsets from (2,2): S=(0,1)=(2,3)✓, W=(-1,0)=(1,2)✓, NW=(-1,-1)=(1,1)✓.
    const r = roadAutoTile(makeIsRoad([[0, 1], [-1, 0], [-1, -1]]));
    expect(r.kind).toBe('diagonal');
  });

  // Tile (2,3): arms N=(2,2) and E=(3,3) => N+E corner.
  // NW of (2,3) is (1,2) which is road => diagonal.
  it('tile (2,3): N+E corner, NW=(1,2) road => diagonal', () => {
    // Offsets from (2,3): N=(0,-1)=(2,2)✓, E=(1,0)=(3,3)✓, NW=(-1,-1)=(1,2)✓.
    const r = roadAutoTile(makeIsRoad([[0, -1], [1, 0], [-1, -1]]));
    expect(r.kind).toBe('diagonal');
  });
});
