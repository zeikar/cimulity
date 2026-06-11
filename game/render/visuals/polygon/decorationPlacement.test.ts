import { describe, it, expect } from 'vitest';
import {
  decoHash,
  parkObjectsForCell,
  PARK_SALT,
  STREET_SALT,
  EMPTY_SALT,
} from './decorationPlacement';

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
