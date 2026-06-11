import { describe, it, expect } from 'vitest';
import {
  decoHash,
  parkObjectsForCell,
  streetTreeForCell,
  landTreesForCell,
  PARK_SALT,
  STREET_SALT,
  EMPTY_SALT,
  EMPTY_DENSITY,
} from './decorationPlacement';

// ── landTreesForCell ─────────────────────────────────────────────────────────

describe('landTreesForCell', () => {
  const alwaysGrass = () => true;
  const neverGrass  = () => false;

  it('returns [] when isPlainGrass is false (DIRT / owned cell)', () => {
    // Sweep to find a cell that would pass the hash gate, then confirm it
    // returns [] when isPlainGrass says no.
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (landTreesForCell(x, y, alwaysGrass).length > 0) {
          expect(landTreesForCell(x, y, neverGrass)).toEqual([]);
          return;
        }
      }
    }
    throw new Error('No cell passed hash gate in 50×50 sweep — EMPTY_DENSITY may be 0');
  });

  it('is deterministic — same (x,y) always returns identical LandTree[]', () => {
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) {
        const a = landTreesForCell(x, y, alwaysGrass);
        const b = landTreesForCell(x, y, alwaysGrass);
        expect(a).toEqual(b);
      }
    }
  });

  it('count is always 0, 1, or 2', () => {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const trees = landTreesForCell(x, y, alwaysGrass);
        expect(trees.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('key format is "land:x:y:slotIndex"', () => {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const trees = landTreesForCell(x, y, alwaysGrass);
        trees.forEach((t, i) => {
          expect(t.key).toBe(`land:${x}:${y}:${i}`);
          expect(t.slotIndex).toBe(i);
        });
      }
    }
  });

  it('variant is 0 or 1', () => {
    let foundPlaced = false;
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const trees = landTreesForCell(x, y, alwaysGrass);
        for (const t of trees) {
          expect([0, 1]).toContain(t.variant);
          foundPlaced = true;
        }
      }
    }
    expect(foundPlaced).toBe(true);
  });

  it('jitter stays within tile diamond half-extents (HW*0.6=~19, HH*0.6=~9)', () => {
    // HW=32, HH=16
    const DX_BOUND = Math.floor(32 * 0.6); // 19
    const DY_BOUND = Math.floor(16 * 0.6); // 9
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const trees = landTreesForCell(x, y, alwaysGrass);
        for (const t of trees) {
          expect(Math.abs(t.dx)).toBeLessThanOrEqual(DX_BOUND);
          expect(Math.abs(t.dy)).toBeLessThanOrEqual(DY_BOUND);
        }
      }
    }
  });

  it('overall cell-hosting density lands ~10–22% across a coordinate sweep', () => {
    let hosting = 0;
    const total = 100 * 100;
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        if (landTreesForCell(x, y, alwaysGrass).length > 0) hosting++;
      }
    }
    const rate = hosting / total;
    expect(rate).toBeGreaterThan(0.10);
    expect(rate).toBeLessThan(0.22);
  });

  it('clustering raises average tree count when neighbors also qualify vs isolated cells', () => {
    // A cell with many qualifying neighbors should on average have more trees
    // than one whose neighbors do not pass the gate.
    // We approximate by finding cells whose all-4 neighbors pass vs cells whose
    // no neighbors pass (using the same decoHash gate the implementation uses).
    const qualifies = (x: number, y: number) =>
      decoHash(x, y, EMPTY_SALT) % 100 < EMPTY_DENSITY;

    let sumClustered = 0, cntClustered = 0;
    let sumIsolated  = 0, cntIsolated  = 0;

    for (let x = 1; x < 200; x++) {
      for (let y = 1; y < 200; y++) {
        if (!qualifies(x, y)) continue; // only look at base-gate-passing cells
        const nCount = [
          qualifies(x + 1, y), qualifies(x - 1, y),
          qualifies(x, y + 1), qualifies(x, y - 1),
        ].filter(Boolean).length;

        const trees = landTreesForCell(x, y, alwaysGrass).length;
        if (nCount >= 2) { sumClustered += trees; cntClustered++; }
        if (nCount === 0) { sumIsolated  += trees; cntIsolated++;  }
      }
    }

    // Both groups must be non-trivial for the assertion to be meaningful.
    expect(cntClustered).toBeGreaterThan(5);
    expect(cntIsolated).toBeGreaterThan(5);

    const avgClustered = sumClustered / cntClustered;
    const avgIsolated  = sumIsolated  / cntIsolated;
    // Clustered cells should have strictly more trees on average.
    expect(avgClustered).toBeGreaterThan(avgIsolated);
  });
});

// ── streetTreeForCell ────────────────────────────────────────────────────────

describe('streetTreeForCell', () => {
  // Helper: all orthogonal neighbors are grass, specific set are roads.
  const roadSet = (coords: [number, number][]): ((x: number, y: number) => boolean) => {
    return (x, y) => coords.some(([rx, ry]) => rx === x && ry === y);
  };

  const alwaysGrass = () => true;
  const neverGrass  = () => false;

  it('returns null when isPlainGrass is false (DIRT / owned cell)', () => {
    expect(streetTreeForCell(5, 5, roadSet([[6, 5]]), neverGrass)).toBeNull();
  });

  it('returns null when no road neighbors (not roadside)', () => {
    expect(streetTreeForCell(5, 5, roadSet([]), alwaysGrass)).toBeNull();
  });

  it('returns null when >=2 road neighbors (junction-adjacent / parallel clutter)', () => {
    // Two road neighbors
    expect(streetTreeForCell(5, 5, roadSet([[6, 5], [4, 5]]), alwaysGrass)).toBeNull();
    // Three road neighbors
    expect(streetTreeForCell(5, 5, roadSet([[6, 5], [4, 5], [5, 6]]), alwaysGrass)).toBeNull();
    // All four
    expect(streetTreeForCell(5, 5, roadSet([[6, 5], [4, 5], [5, 6], [5, 4]]), alwaysGrass)).toBeNull();
  });

  it('is deterministic — same (x,y) always returns the same NON-NULL result', () => {
    // Find a coordinate that actually passes the hash gate so we exercise the
    // placed path, not just null === null.
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        const roads = roadSet([[x + 1, y]]);
        const a = streetTreeForCell(x, y, roads, alwaysGrass);
        if (a !== null) {
          const b = streetTreeForCell(x, y, roads, alwaysGrass);
          expect(b).not.toBeNull();
          expect(a).toEqual(b);
          return;
        }
      }
    }
    throw new Error('No placed tree found in 20×20 sweep — density constant may be 0');
  });

  it('key is "street:x:y"', () => {
    // Find a coordinate that passes the hash gate with a single road neighbor.
    // We sweep until we find one (deterministic, so always the same cell).
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        const result = streetTreeForCell(x, y, roadSet([[x + 1, y]]), alwaysGrass);
        if (result !== null) {
          expect(result.key).toBe(`street:${x}:${y}`);
          return;
        }
      }
    }
    throw new Error('No placed tree found in 20×20 sweep — density constant may be 0');
  });

  it('variant is 0 or 1', () => {
    let foundPlaced = false;
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const result = streetTreeForCell(x, y, roadSet([[x + 1, y]]), alwaysGrass);
        if (result !== null) {
          expect([0, 1]).toContain(result.variant);
          foundPlaced = true;
        }
      }
    }
    // Guard: at least one cell must have been placed — if STREET_DENSITY were 0
    // the loop above would pass vacuously without testing anything.
    expect(foundPlaced).toBe(true);
  });

  it('~50% gate yields a mix of placed and null over a coordinate sweep', () => {
    let placed = 0;
    let skipped = 0;
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) {
        const result = streetTreeForCell(x, y, roadSet([[x + 1, y]]), alwaysGrass);
        if (result !== null) placed++; else skipped++;
      }
    }
    // With STREET_DENSITY=50 we expect roughly 50% placed; allow 20–80% range
    // to avoid flakiness while confirming the gate actually fires in both directions.
    const total = placed + skipped;
    expect(placed).toBeGreaterThan(total * 0.2);
    expect(placed).toBeLessThan(total * 0.8);
  });

  describe('dx/dy offset sign toward each of the four road directions', () => {
    // Iso basis: tileToScreen(tx,ty) = { x:(tx-ty)*32, y:(tx+ty)*16 }
    // Screen delta for each unit tile step:
    //   tile (+1,0) → screen (+32,+16)  → positive dx, positive dy
    //   tile (-1,0) → screen (-32,-16)  → negative dx, negative dy
    //   tile (0,+1) → screen (-32,+16)  → negative dx, positive dy
    //   tile (0,-1) → screen (+32,-16)  → positive dx, negative dy

    function findPlaced(
      cx: number,
      cy: number,
      road: [number, number],
    ) {
      // Sweep nearby coordinates until we find one that passes the hash gate.
      for (let ox = 0; ox < 40; ox++) {
        for (let oy = 0; oy < 40; oy++) {
          const x = cx + ox;
          const y = cy + oy;
          const rx = road[0] - cx + x;
          const ry = road[1] - cy + y;
          const result = streetTreeForCell(x, y, roadSet([[rx, ry]]), alwaysGrass);
          if (result !== null) return result;
        }
      }
      return null;
    }

    it('road to the +X side (x+1, y) → dx > 0, dy > 0', () => {
      const result = findPlaced(0, 0, [1, 0]);
      expect(result).not.toBeNull();
      expect(result!.dx).toBeGreaterThan(0);
      expect(result!.dy).toBeGreaterThan(0);
    });

    it('road to the -X side (x-1, y) → dx < 0, dy < 0', () => {
      const result = findPlaced(10, 10, [9, 10]);
      expect(result).not.toBeNull();
      expect(result!.dx).toBeLessThan(0);
      expect(result!.dy).toBeLessThan(0);
    });

    it('road to the +Y side (x, y+1) → dx < 0, dy > 0', () => {
      const result = findPlaced(0, 0, [0, 1]);
      expect(result).not.toBeNull();
      expect(result!.dx).toBeLessThan(0);
      expect(result!.dy).toBeGreaterThan(0);
    });

    it('road to the -Y side (x, y-1) → dx > 0, dy < 0', () => {
      const result = findPlaced(10, 10, [10, 9]);
      expect(result).not.toBeNull();
      expect(result!.dx).toBeGreaterThan(0);
      expect(result!.dy).toBeLessThan(0);
    });
  });
});

// ── decoHash ─────────────────────────────────────────────────────────────────

describe('decoHash', () => {
  it('is deterministic — same args always return the same value', () => {
    expect(decoHash(0, PARK_SALT)).toBe(decoHash(0, PARK_SALT));
    expect(decoHash(42, PARK_SALT)).toBe(decoHash(42, PARK_SALT));
    expect(decoHash(1, 2, 3)).toBe(decoHash(1, 2, 3));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const args of [[0], [1], [99999], [0, PARK_SALT], [7, STREET_SALT]]) {
      const v = decoHash(...args);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('produces distinct outputs for distinct salts on the same coords', () => {
    const vPark = decoHash(10, PARK_SALT);
    const vStreet = decoHash(10, STREET_SALT);
    const vEmpty = decoHash(10, EMPTY_SALT);
    expect(vPark).not.toBe(vStreet);
    expect(vPark).not.toBe(vEmpty);
    expect(vStreet).not.toBe(vEmpty);
  });

  it('produces distinct outputs for distinct first args', () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) values.add(decoHash(i, PARK_SALT));
    // Out of 50 inputs expect a good spread — at least 40 distinct values.
    expect(values.size).toBeGreaterThan(40);
  });
});

describe('parkObjectsForCell', () => {
  it('returns exactly 2 slots', () => {
    expect(parkObjectsForCell(1, 0, 0)).toHaveLength(2);
    expect(parkObjectsForCell(999, 3, 7)).toHaveLength(2);
  });

  it('slot keys are unique and prefixed park:${id}:', () => {
    for (const id of [0, 1, 42, 999]) {
      const slots = parkObjectsForCell(id, 0, 0);
      expect(slots[0].key).toBe(`park:${id}:0`);
      expect(slots[1].key).toBe(`park:${id}:1`);
      expect(slots[0].key).not.toBe(slots[1].key);
    }
  });

  it('is deterministic — same id always yields identical slots', () => {
    for (const id of [0, 7, 42, 256]) {
      const a = parkObjectsForCell(id, 0, 0);
      const b = parkObjectsForCell(id, 0, 0);
      expect(a[0]).toEqual(b[0]);
      expect(a[1]).toEqual(b[1]);
    }
  });

  it('slot 0 is always a tree variant (tree0 or tree1)', () => {
    for (let id = 0; id < 20; id++) {
      const [tree] = parkObjectsForCell(id, 0, 0);
      expect(['tree0', 'tree1']).toContain(tree.kind);
    }
  });

  it('slot 1 is always a bench or flowerbed', () => {
    for (let id = 0; id < 20; id++) {
      const [, prop] = parkObjectsForCell(id, 0, 0);
      expect(['bench', 'flowerbed']).toContain(prop.kind);
    }
  });

  it('the two slots never share the same (dx, dy) — center stays readable', () => {
    for (let id = 0; id < 50; id++) {
      const [a, b] = parkObjectsForCell(id, 0, 0);
      expect(a.dx === b.dx && a.dy === b.dy).toBe(false);
    }
  });

  it('tree variant and prop kind vary across different ids (not all-same)', () => {
    const treeKinds = new Set<string>();
    const propKinds = new Set<string>();
    for (let id = 0; id < 50; id++) {
      const [tree, prop] = parkObjectsForCell(id, 0, 0);
      treeKinds.add(tree.kind);
      propKinds.add(prop.kind);
    }
    // Both variants should appear across 50 ids.
    expect(treeKinds.size).toBeGreaterThan(1);
    expect(propKinds.size).toBeGreaterThan(1);
  });

  it('ax/ay do not affect the result for 1x1 park (MVP)', () => {
    // For the 1×1 MVP, cell anchor doesn't alter offsets.
    const base = parkObjectsForCell(5, 0, 0);
    const shifted = parkObjectsForCell(5, 3, 7);
    expect(base).toEqual(shifted);
  });
});
