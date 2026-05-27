import { describe, it, expect } from 'vitest';
import {
  FACADE_ATLAS_SIZE,
  FACADE_ATLAS_SLOTS,
  FACADE_ATLAS_VERSION,
  FACADE_MODULE_IDS,
  layoutSlots,
  type AtlasSlot,
} from './facadeAtlasLayout';

function overlaps(a: AtlasSlot, b: AtlasSlot): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('facadeAtlasLayout', () => {
  it('exposes FACADE_ATLAS_VERSION === 1', () => {
    expect(FACADE_ATLAS_VERSION).toBe(1);
  });

  it('declares exactly 24 modules (9 walls + 9 windows + 3 doors + 3 roofs)', () => {
    expect(FACADE_MODULE_IDS.length).toBe(24);
    const walls = FACADE_MODULE_IDS.filter((id) => id.startsWith('wall.'));
    const windows = FACADE_MODULE_IDS.filter((id) => id.startsWith('window.'));
    const doors = FACADE_MODULE_IDS.filter((id) => id.startsWith('door.'));
    const roofs = FACADE_MODULE_IDS.filter((id) => id.startsWith('roof.flat.'));
    expect(walls.length).toBe(9);
    expect(windows.length).toBe(9);
    expect(doors.length).toBe(3);
    expect(roofs.length).toBe(3);
  });

  it('keeps module ids unique', () => {
    expect(new Set(FACADE_MODULE_IDS).size).toBe(FACADE_MODULE_IDS.length);
  });

  it('FACADE_ATLAS_SLOTS has a slot for every module id', () => {
    for (const id of FACADE_MODULE_IDS) {
      expect(FACADE_ATLAS_SLOTS[id]).toBeDefined();
    }
    expect(Object.keys(FACADE_ATLAS_SLOTS).length).toBe(FACADE_MODULE_IDS.length);
  });

  it('every slot is fully inside the atlas bounds', () => {
    for (const id of FACADE_MODULE_IDS) {
      const s = FACADE_ATLAS_SLOTS[id];
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(FACADE_ATLAS_SIZE.width);
      expect(s.y + s.h).toBeLessThanOrEqual(FACADE_ATLAS_SIZE.height);
    }
  });

  it('uses the documented per-kind sizes (walls/windows/doors 64x24, roofs 64x16)', () => {
    for (const id of FACADE_MODULE_IDS) {
      const s = FACADE_ATLAS_SLOTS[id];
      if (id.startsWith('roof.')) {
        expect(s.w).toBe(64);
        expect(s.h).toBe(16);
      } else {
        expect(s.w).toBe(64);
        expect(s.h).toBe(24);
      }
    }
  });

  it('no two slots overlap (pairwise AABB)', () => {
    const ids = FACADE_MODULE_IDS;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = FACADE_ATLAS_SLOTS[ids[i]];
        const b = FACADE_ATLAS_SLOTS[ids[j]];
        if (overlaps(a, b)) {
          throw new Error(`slots overlap: ${ids[i]} vs ${ids[j]}`);
        }
      }
    }
  });

  describe('layoutSlots', () => {
    it('places modules left-to-right within a row', () => {
      const slots = layoutSlots(
        [
          { id: 'a', w: 10, h: 5 },
          { id: 'b', w: 20, h: 5 },
        ],
        100,
        100,
      );
      expect(slots.a).toEqual({ x: 0, y: 0, w: 10, h: 5 });
      expect(slots.b).toEqual({ x: 10, y: 0, w: 20, h: 5 });
    });

    it('wraps to a new row when the current row overflows in width', () => {
      const slots = layoutSlots(
        [
          { id: 'a', w: 60, h: 10 },
          { id: 'b', w: 60, h: 10 },
          { id: 'c', w: 60, h: 10 },
        ],
        100,
        100,
      );
      expect(slots.a.y).toBe(0);
      expect(slots.b.y).toBe(10);
      expect(slots.b.x).toBe(0);
      expect(slots.c.y).toBe(20);
    });

    it('tracks the row height as the max of placed modules in the row', () => {
      const slots = layoutSlots(
        [
          { id: 'a', w: 10, h: 8 },
          { id: 'b', w: 10, h: 16 },
          // Next row should start at y = max(8, 16) = 16.
          { id: 'c', w: 100, h: 5 },
        ],
        20,
        100,
      );
      expect(slots.c.y).toBe(16);
    });

    it('throws when a module does not fit in the atlas', () => {
      expect(() =>
        layoutSlots(
          [
            { id: 'a', w: 60, h: 60 },
            { id: 'b', w: 60, h: 60 },
          ],
          100,
          100,
        ),
      ).toThrow(/does not fit/);
    });
  });
});
