import { describe, it, expect } from 'vitest';
import { isBuildingType, tileTypeFromBuildingType, BuildingMap } from './Building';
import { TileType } from './Tile';

describe('isBuildingType', () => {
  it('accepts the three valid building types', () => {
    expect(isBuildingType('residential')).toBe(true);
    expect(isBuildingType('commercial')).toBe(true);
    expect(isBuildingType('industrial')).toBe(true);
  });

  it('rejects non-building-type strings', () => {
    expect(isBuildingType('grass')).toBe(false);
    expect(isBuildingType('')).toBe(false);
    expect(isBuildingType('RESIDENTIAL')).toBe(false);
    expect(isBuildingType('zone_residential')).toBe(false);
  });
});

describe('tileTypeFromBuildingType', () => {
  it('maps residential to ZONE_RESIDENTIAL', () => {
    expect(tileTypeFromBuildingType('residential')).toBe(TileType.ZONE_RESIDENTIAL);
  });

  it('maps commercial to ZONE_COMMERCIAL', () => {
    expect(tileTypeFromBuildingType('commercial')).toBe(TileType.ZONE_COMMERCIAL);
  });

  it('maps industrial to ZONE_INDUSTRIAL', () => {
    expect(tileTypeFromBuildingType('industrial')).toBe(TileType.ZONE_INDUSTRIAL);
  });
});

function makeBase() {
  return {
    type: 'residential' as const,
    level: 1,
    density: 0 as const,
    age: 0,
    frontage: 'S' as const,
  };
}

describe('BuildingMap', () => {
  describe('addBuilding', () => {
    it('adds a 1×1 building and retrieves it by position and id', () => {
      const map = new BuildingMap(10, 10);
      const b = map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 2, y: 3 }],
        anchor: { x: 2, y: 3 },
      });

      expect(b).not.toBeNull();
      expect(typeof b!.id).toBe('number');
      expect(map.getBuildingAt(2, 3)).toBe(b);
      expect(map.getBuilding(b!.id)).toBe(b);
    });

    it('adds a 2×2 building and every footprint cell resolves to it', () => {
      const map = new BuildingMap(10, 10);
      const footprint = [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ];
      const b = map.addBuilding({
        ...makeBase(),
        footprint,
        anchor: { x: 1, y: 1 },
      });

      expect(b).not.toBeNull();
      for (const c of footprint) {
        expect(map.getBuildingAt(c.x, c.y)).toBe(b);
      }
    });

    it('removes a building and cells become empty', () => {
      const map = new BuildingMap(10, 10);
      const b = map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 0, y: 0 }],
        anchor: { x: 0, y: 0 },
      });

      expect(map.removeBuilding(b!.id)).toBe(true);
      expect(map.getBuildingAt(0, 0)).toBeNull();
      expect(map.getBuilding(b!.id)).toBeNull();
    });

    it('rejects an out-of-bounds cell (x equals width)', () => {
      const map = new BuildingMap(5, 5);
      const result = map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 5, y: 0 }],
        anchor: { x: 5, y: 0 },
      });
      expect(result).toBeNull();
    });

    it('rejects an empty footprint', () => {
      const map = new BuildingMap(5, 5);
      const result = map.addBuilding({
        ...makeBase(),
        footprint: [],
        anchor: { x: 0, y: 0 },
      });
      expect(result).toBeNull();
    });

    it('rejects overlapping placements and leaves first building intact', () => {
      const map = new BuildingMap(10, 10);
      const first = map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 3, y: 3 }],
        anchor: { x: 3, y: 3 },
      });
      expect(first).not.toBeNull();

      const second = map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 3, y: 3 }],
        anchor: { x: 3, y: 3 },
      });
      expect(second).toBeNull();
      expect(map.getBuildingAt(3, 3)).toBe(first);
    });

    it('rejects duplicate cells within the footprint', () => {
      const map = new BuildingMap(10, 10);
      const result = map.addBuilding({
        ...makeBase(),
        footprint: [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        anchor: { x: 1, y: 1 },
      });
      expect(result).toBeNull();
    });

    it('rejects fractional coordinates', () => {
      const map = new BuildingMap(10, 10);
      expect(
        map.addBuilding({
          ...makeBase(),
          footprint: [{ x: 1.5, y: 0 }],
          anchor: { x: 1.5, y: 0 },
        }),
      ).toBeNull();
    });

    it('rejects NaN coordinates', () => {
      const map = new BuildingMap(10, 10);
      expect(
        map.addBuilding({
          ...makeBase(),
          footprint: [{ x: NaN, y: 0 }],
          anchor: { x: NaN, y: 0 },
        }),
      ).toBeNull();
    });

    it('rejects Infinity coordinates', () => {
      const map = new BuildingMap(10, 10);
      expect(
        map.addBuilding({
          ...makeBase(),
          footprint: [{ x: Infinity, y: 0 }],
          anchor: { x: Infinity, y: 0 },
        }),
      ).toBeNull();
    });

    it('rejects an anchor not in the footprint', () => {
      const map = new BuildingMap(10, 10);
      const result = map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 0, y: 0 }],
        anchor: { x: 1, y: 1 },
      });
      expect(result).toBeNull();
    });

    it('rejects an L-shape footprint', () => {
      const map = new BuildingMap(10, 10);
      // 3-cell L: (0,0),(1,0),(0,1) — 2×2 bounding box but missing (1,1).
      expect(
        map.addBuilding({
          ...makeBase(),
          footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
          anchor: { x: 0, y: 0 },
        }),
      ).toBeNull();
    });

    it('rejects a 5×1 footprint (W out of range)', () => {
      const map = new BuildingMap(10, 10);
      expect(
        map.addBuilding({
          ...makeBase(),
          footprint: [
            { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
            { x: 3, y: 0 }, { x: 4, y: 0 },
          ],
          anchor: { x: 0, y: 0 },
        }),
      ).toBeNull();
    });

    it('rejects a footprint whose anchor is the SE corner', () => {
      const map = new BuildingMap(10, 10);
      // Full 2×2 rectangle but anchor at (1,1) instead of NW (0,0).
      expect(
        map.addBuilding({
          ...makeBase(),
          footprint: [
            { x: 0, y: 0 }, { x: 1, y: 0 },
            { x: 0, y: 1 }, { x: 1, y: 1 },
          ],
          anchor: { x: 1, y: 1 },
        }),
      ).toBeNull();
    });

    it('accepts a 2×2 full rectangle with NW anchor', () => {
      const map = new BuildingMap(10, 10);
      const result = map.addBuilding({
        ...makeBase(),
        footprint: [
          { x: 2, y: 2 }, { x: 3, y: 2 },
          { x: 2, y: 3 }, { x: 3, y: 3 },
        ],
        anchor: { x: 2, y: 2 },
      });
      expect(result).not.toBeNull();
      expect(map.getBuildingAt(2, 2)).toBe(result);
      expect(map.getBuildingAt(3, 3)).toBe(result);
    });
  });

  describe('addExistingBuilding', () => {
    it('hydrates a building with id 42', () => {
      const map = new BuildingMap(10, 10);
      const ok = map.addExistingBuilding({
        ...makeBase(),
        id: 42,
        footprint: [{ x: 4, y: 4 }],
        anchor: { x: 4, y: 4 },
      });
      expect(ok).toBe(true);
      expect(map.getBuildingAt(4, 4)?.id).toBe(42);
    });

    it('rejects duplicate id', () => {
      const map = new BuildingMap(10, 10);
      const b = {
        ...makeBase(),
        id: 42,
        footprint: [{ x: 4, y: 4 }],
        anchor: { x: 4, y: 4 },
      };
      expect(map.addExistingBuilding(b)).toBe(true);
      expect(map.addExistingBuilding({ ...b, footprint: [{ x: 5, y: 5 }], anchor: { x: 5, y: 5 } })).toBe(false);
    });

    it('rejects fractional id', () => {
      const map = new BuildingMap(10, 10);
      const ok = map.addExistingBuilding({
        ...makeBase(),
        id: 1.5,
        footprint: [{ x: 0, y: 0 }],
        anchor: { x: 0, y: 0 },
      });
      expect(ok).toBe(false);
    });

    it('rejects negative id', () => {
      const map = new BuildingMap(10, 10);
      expect(
        map.addExistingBuilding({
          ...makeBase(),
          id: -1,
          footprint: [{ x: 0, y: 0 }],
          anchor: { x: 0, y: 0 },
        }),
      ).toBe(false);
    });
  });

  describe('setNextIdFloor', () => {
    it('causes addBuilding to return id 8 after setNextIdFloor(7)', () => {
      const map = new BuildingMap(10, 10);
      map.setNextIdFloor(7);
      const b = map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 0, y: 0 }],
        anchor: { x: 0, y: 0 },
      });
      expect(b).not.toBeNull();
      expect(b!.id).toBe(8);
    });
  });

  describe('clear', () => {
    it('iterBuildings is empty after clear', () => {
      const map = new BuildingMap(10, 10);
      map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 1, y: 1 }],
        anchor: { x: 1, y: 1 },
      });
      map.clear();
      expect([...map.iterBuildings()]).toHaveLength(0);
    });

    it('getBuildingAt returns null everywhere after clear', () => {
      const map = new BuildingMap(5, 5);
      map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 2, y: 2 }],
        anchor: { x: 2, y: 2 },
      });
      map.clear();
      expect(map.getBuildingAt(2, 2)).toBeNull();
    });

    it('addBuilding after clear returns id 0 (nextId reset)', () => {
      const map = new BuildingMap(10, 10);
      map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 0, y: 0 }],
        anchor: { x: 0, y: 0 },
      });
      map.clear();
      const b = map.addBuilding({
        ...makeBase(),
        footprint: [{ x: 1, y: 1 }],
        anchor: { x: 1, y: 1 },
      });
      expect(b).not.toBeNull();
      expect(b!.id).toBe(0);
    });
  });

  describe('getBuildingAt', () => {
    it('returns null for out-of-bounds coordinates', () => {
      const map = new BuildingMap(5, 5);
      expect(map.getBuildingAt(-1, 0)).toBeNull();
      expect(map.getBuildingAt(5, 0)).toBeNull();
      expect(map.getBuildingAt(0, 5)).toBeNull();
      expect(map.getBuildingAt(0, -1)).toBeNull();
    });
  });

  describe('getAllBuildings', () => {
    it('returns all stored buildings as a snapshot', () => {
      const map = new BuildingMap(10, 10);
      map.addBuilding({ ...makeBase(), footprint: [{ x: 0, y: 0 }], anchor: { x: 0, y: 0 } });
      map.addBuilding({ ...makeBase(), footprint: [{ x: 1, y: 1 }], anchor: { x: 1, y: 1 } });
      expect(map.getAllBuildings()).toHaveLength(2);
    });
  });

  describe('removeBuilding', () => {
    it('returns false when building does not exist', () => {
      const map = new BuildingMap(5, 5);
      expect(map.removeBuilding(99)).toBe(false);
    });
  });
});
