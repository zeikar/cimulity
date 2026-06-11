import { describe, it, expect } from 'vitest';
import {
  decoHash,
  parkObjectsForCell,
  streetTreeForCell,
  PARK_SALT,
  STREET_SALT,
  EMPTY_SALT,
} from './decorationPlacement';

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
