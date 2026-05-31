import { describe, it, expect } from 'vitest';
import { isStructureType, structureFootprintSize, StructureMap } from './StructureMap';

function make2x2Footprint(ox: number, oy: number) {
  return [
    { x: ox,     y: oy     },
    { x: ox + 1, y: oy     },
    { x: ox,     y: oy + 1 },
    { x: ox + 1, y: oy + 1 },
  ];
}

describe('isStructureType', () => {
  it('accepts power_plant', () => {
    expect(isStructureType('power_plant')).toBe(true);
  });

  it('accepts water_tower', () => {
    expect(isStructureType('water_tower')).toBe(true);
  });

  it('accepts police_station', () => {
    expect(isStructureType('police_station')).toBe(true);
  });

  it('rejects residential', () => {
    expect(isStructureType('residential')).toBe(false);
  });

  it('rejects arbitrary string', () => {
    expect(isStructureType('foo')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isStructureType('')).toBe(false);
  });
});

describe('structureFootprintSize', () => {
  it('returns {w:2,h:2} for power_plant', () => {
    expect(structureFootprintSize('power_plant')).toEqual({ w: 2, h: 2 });
  });

  it('returns {w:1,h:1} for water_tower', () => {
    expect(structureFootprintSize('water_tower')).toEqual({ w: 1, h: 1 });
  });

  it('returns {w:2,h:2} for police_station', () => {
    expect(structureFootprintSize('police_station')).toEqual({ w: 2, h: 2 });
  });
});

describe('StructureMap — water_tower', () => {
  it('addStructure accepts a 1×1 water_tower', () => {
    const map = new StructureMap(10, 10);
    const s = map.addStructure({
      type: 'water_tower',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
    });
    expect(s).not.toBeNull();
    expect(s!.type).toBe('water_tower');
  });

  it('addStructure rejects 2×2 footprint for water_tower', () => {
    const map = new StructureMap(10, 10);
    expect(
      map.addStructure({
        type: 'water_tower',
        footprint: make2x2Footprint(0, 0),
        anchor: { x: 0, y: 0 },
      }),
    ).toBeNull();
  });

  it('addStructure rejects 3×3 footprint for water_tower', () => {
    const map = new StructureMap(10, 10);
    const fp = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) fp.push({ x, y });
    expect(
      map.addStructure({ type: 'water_tower', footprint: fp, anchor: { x: 0, y: 0 } }),
    ).toBeNull();
  });

  it('water_tower and power_plant coexist when non-overlapping', () => {
    const map = new StructureMap(10, 10);
    const s1 = map.addStructure({
      type: 'power_plant',
      footprint: make2x2Footprint(0, 0),
      anchor: { x: 0, y: 0 },
    });
    const s2 = map.addStructure({
      type: 'water_tower',
      footprint: [{ x: 4, y: 4 }],
      anchor: { x: 4, y: 4 },
    });
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
  });

  it('water_tower and power_plant reject on overlap', () => {
    const map = new StructureMap(10, 10);
    map.addStructure({
      type: 'power_plant',
      footprint: make2x2Footprint(0, 0),
      anchor: { x: 0, y: 0 },
    });
    // water_tower at (1,0) overlaps with the power_plant's (1,0) cell.
    expect(
      map.addStructure({
        type: 'water_tower',
        footprint: [{ x: 1, y: 0 }],
        anchor: { x: 1, y: 0 },
      }),
    ).toBeNull();
  });
});

describe('StructureMap — police_station', () => {
  it('addStructure accepts a valid 2×2 police_station', () => {
    const map = new StructureMap(10, 10);
    const s = map.addStructure({
      type: 'police_station',
      footprint: make2x2Footprint(0, 0),
      anchor: { x: 0, y: 0 },
    });
    expect(s).not.toBeNull();
    expect(s!.type).toBe('police_station');
  });

  it('addStructure rejects 2×1 footprint for police_station', () => {
    const map = new StructureMap(10, 10);
    expect(
      map.addStructure({
        type: 'police_station',
        footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        anchor: { x: 0, y: 0 },
      }),
    ).toBeNull();
  });
});

describe('StructureMap', () => {
  describe('addStructure', () => {
    it('succeeds for a canonical 2×2 at (0,0); id is 0', () => {
      const map = new StructureMap(10, 10);
      const s = map.addStructure({
        type: 'power_plant',
        footprint: make2x2Footprint(0, 0),
        anchor: { x: 0, y: 0 },
      });
      expect(s).not.toBeNull();
      expect(s!.id).toBe(0);
    });

    it('second add at non-overlapping (2,2) gets id 1', () => {
      const map = new StructureMap(10, 10);
      map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(0, 0), anchor: { x: 0, y: 0 } });
      const s = map.addStructure({
        type: 'power_plant',
        footprint: make2x2Footprint(2, 2),
        anchor: { x: 2, y: 2 },
      });
      expect(s).not.toBeNull();
      expect(s!.id).toBe(1);
    });

    it('rejects 1×1 footprint', () => {
      const map = new StructureMap(10, 10);
      expect(
        map.addStructure({
          type: 'power_plant',
          footprint: [{ x: 0, y: 0 }],
          anchor: { x: 0, y: 0 },
        }),
      ).toBeNull();
    });

    it('rejects 1×2 footprint', () => {
      const map = new StructureMap(10, 10);
      expect(
        map.addStructure({
          type: 'power_plant',
          footprint: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
          anchor: { x: 0, y: 0 },
        }),
      ).toBeNull();
    });

    it('rejects 3×3 footprint', () => {
      const map = new StructureMap(10, 10);
      const fp = [];
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) fp.push({ x, y });
      expect(
        map.addStructure({ type: 'power_plant', footprint: fp, anchor: { x: 0, y: 0 } }),
      ).toBeNull();
    });

    it('rejects 4×4 footprint', () => {
      const map = new StructureMap(10, 10);
      const fp = [];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) fp.push({ x, y });
      expect(
        map.addStructure({ type: 'power_plant', footprint: fp, anchor: { x: 0, y: 0 } }),
      ).toBeNull();
    });

    it('rejects non-canonical footprint (missing cell)', () => {
      const map = new StructureMap(10, 10);
      // L-shape: 3 cells of a 2×2 — not canonical
      expect(
        map.addStructure({
          type: 'power_plant',
          footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
          anchor: { x: 0, y: 0 },
        }),
      ).toBeNull();
    });

    it('rejects footprint with anchor outside footprint', () => {
      const map = new StructureMap(10, 10);
      expect(
        map.addStructure({
          type: 'power_plant',
          footprint: make2x2Footprint(0, 0),
          anchor: { x: 5, y: 5 },
        }),
      ).toBeNull();
    });

    it('rejects overlap with existing structure', () => {
      const map = new StructureMap(10, 10);
      map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(0, 0), anchor: { x: 0, y: 0 } });
      expect(
        map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(0, 0), anchor: { x: 0, y: 0 } }),
      ).toBeNull();
    });

    it('rejects empty footprint', () => {
      const map = new StructureMap(10, 10);
      expect(
        map.addStructure({ type: 'power_plant', footprint: [], anchor: { x: 0, y: 0 } }),
      ).toBeNull();
    });
  });

  describe('getStructureAt', () => {
    it('returns the structure for each of the 4 footprint cells', () => {
      const map = new StructureMap(10, 10);
      const fp = make2x2Footprint(3, 3);
      const s = map.addStructure({ type: 'power_plant', footprint: fp, anchor: { x: 3, y: 3 } });
      for (const c of fp) {
        expect(map.getStructureAt(c.x, c.y)).toBe(s);
      }
    });

    it('returns null for cells outside the footprint', () => {
      const map = new StructureMap(10, 10);
      map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(0, 0), anchor: { x: 0, y: 0 } });
      expect(map.getStructureAt(2, 0)).toBeNull();
      expect(map.getStructureAt(0, 2)).toBeNull();
      expect(map.getStructureAt(5, 5)).toBeNull();
    });

    it('returns null for out-of-bounds coordinates', () => {
      const map = new StructureMap(5, 5);
      expect(map.getStructureAt(-1, 0)).toBeNull();
      expect(map.getStructureAt(5, 0)).toBeNull();
      expect(map.getStructureAt(0, -1)).toBeNull();
      expect(map.getStructureAt(0, 5)).toBeNull();
    });
  });

  describe('removeStructure', () => {
    it('clears ownership; getStructureAt returns null on every footprint cell', () => {
      const map = new StructureMap(10, 10);
      const fp = make2x2Footprint(1, 1);
      const s = map.addStructure({ type: 'power_plant', footprint: fp, anchor: { x: 1, y: 1 } });
      expect(map.removeStructure(s!.id)).toBe(true);
      for (const c of fp) {
        expect(map.getStructureAt(c.x, c.y)).toBeNull();
      }
    });

    it('returns false when structure does not exist', () => {
      const map = new StructureMap(10, 10);
      expect(map.removeStructure(99)).toBe(false);
    });

    it('getStructure returns null after removal', () => {
      const map = new StructureMap(10, 10);
      const s = map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(0, 0), anchor: { x: 0, y: 0 } });
      map.removeStructure(s!.id);
      expect(map.getStructure(s!.id)).toBeNull();
    });
  });

  describe('clear', () => {
    it('iterStructures yields nothing after clear', () => {
      const map = new StructureMap(10, 10);
      map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(0, 0), anchor: { x: 0, y: 0 } });
      map.clear();
      expect([...map.iterStructures()]).toHaveLength(0);
    });

    it('getStructureAt returns null everywhere after clear', () => {
      const map = new StructureMap(10, 10);
      const fp = make2x2Footprint(0, 0);
      map.addStructure({ type: 'power_plant', footprint: fp, anchor: { x: 0, y: 0 } });
      map.clear();
      for (const c of fp) {
        expect(map.getStructureAt(c.x, c.y)).toBeNull();
      }
    });

    it('addStructure after clear returns id 0 (nextId reset)', () => {
      const map = new StructureMap(10, 10);
      map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(0, 0), anchor: { x: 0, y: 0 } });
      map.clear();
      const s = map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(4, 4), anchor: { x: 4, y: 4 } });
      expect(s).not.toBeNull();
      expect(s!.id).toBe(0);
    });
  });

  describe('addExistingStructure', () => {
    it('accepts id 0 (non-negative integer convention)', () => {
      const map = new StructureMap(10, 10);
      const ok = map.addExistingStructure({
        id: 0,
        type: 'power_plant',
        footprint: make2x2Footprint(0, 0),
        anchor: { x: 0, y: 0 },
      });
      expect(ok).toBe(true);
      expect(map.getStructureAt(0, 0)?.id).toBe(0);
    });

    it('rejects duplicate id', () => {
      const map = new StructureMap(10, 10);
      const s = {
        id: 5,
        type: 'power_plant' as const,
        footprint: make2x2Footprint(0, 0),
        anchor: { x: 0, y: 0 },
      };
      expect(map.addExistingStructure(s)).toBe(true);
      expect(
        map.addExistingStructure({ ...s, footprint: make2x2Footprint(4, 4), anchor: { x: 4, y: 4 } }),
      ).toBe(false);
    });

    it('rejects negative id', () => {
      const map = new StructureMap(10, 10);
      expect(
        map.addExistingStructure({
          id: -1,
          type: 'power_plant',
          footprint: make2x2Footprint(0, 0),
          anchor: { x: 0, y: 0 },
        }),
      ).toBe(false);
    });

    it('rejects non-integer id', () => {
      const map = new StructureMap(10, 10);
      expect(
        map.addExistingStructure({
          id: 1.5,
          type: 'power_plant',
          footprint: make2x2Footprint(0, 0),
          anchor: { x: 0, y: 0 },
        }),
      ).toBe(false);
    });

    it('rejects unknown type', () => {
      const map = new StructureMap(10, 10);
      expect(
        map.addExistingStructure({
          id: 1,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: 'wind_turbine' as any,
          footprint: make2x2Footprint(0, 0),
          anchor: { x: 0, y: 0 },
        }),
      ).toBe(false);
    });

    it('bumps nextId so subsequent addStructure gets a higher id', () => {
      const map = new StructureMap(10, 10);
      map.addExistingStructure({
        id: 7,
        type: 'power_plant',
        footprint: make2x2Footprint(0, 0),
        anchor: { x: 0, y: 0 },
      });
      const s = map.addStructure({
        type: 'power_plant',
        footprint: make2x2Footprint(4, 4),
        anchor: { x: 4, y: 4 },
      });
      expect(s).not.toBeNull();
      expect(s!.id).toBe(8);
    });
  });

  describe('setNextIdFloor', () => {
    it('causes addStructure to return id 8 after setNextIdFloor(7)', () => {
      const map = new StructureMap(10, 10);
      map.setNextIdFloor(7);
      const s = map.addStructure({
        type: 'power_plant',
        footprint: make2x2Footprint(0, 0),
        anchor: { x: 0, y: 0 },
      });
      expect(s).not.toBeNull();
      expect(s!.id).toBe(8);
    });
  });

  describe('getAllStructures', () => {
    it('returns all stored structures as a snapshot', () => {
      const map = new StructureMap(10, 10);
      map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(0, 0), anchor: { x: 0, y: 0 } });
      map.addStructure({ type: 'power_plant', footprint: make2x2Footprint(4, 4), anchor: { x: 4, y: 4 } });
      expect(map.getAllStructures()).toHaveLength(2);
    });
  });
});
