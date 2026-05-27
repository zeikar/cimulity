import { describe, it, expect } from 'vitest';
import { World } from './World';
import { TileType, createTile } from './Tile';
import { serializeWorld, deserializeWorldInto } from './mapSerialization';
import { ZONE_GROWTH_INTERVAL } from './World';

describe('demand freshness on hydrate', () => {
  it('getDemand() reflects hydrated buildings immediately after deserializeWorldInto', () => {
    const src = new World(8, 8, { regenerate: false });
    const map = src.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(2, 1, createTile(2, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(4, 1, createTile(4, 1, TileType.ZONE_INDUSTRIAL));
    src.getMap().getBuildings().addExistingBuilding({ id: 0, type: 'industrial', footprint: [{ x: 1, y: 1 }], anchor: { x: 1, y: 1 }, level: 3, density: 0, age: 0, frontage: 'S', structureRect: { x: 1, y: 1, w: 1, h: 1 } });
    src.getMap().getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 2, y: 1 }], anchor: { x: 2, y: 1 }, level: 3, density: 0, age: 0, frontage: 'S', structureRect: { x: 2, y: 1, w: 1, h: 1 } });
    src.getMap().getBuildings().addExistingBuilding({ id: 2, type: 'industrial', footprint: [{ x: 3, y: 1 }], anchor: { x: 3, y: 1 }, level: 3, density: 0, age: 0, frontage: 'S', structureRect: { x: 3, y: 1, w: 1, h: 1 } });
    src.getMap().getBuildings().addExistingBuilding({ id: 3, type: 'industrial', footprint: [{ x: 4, y: 1 }], anchor: { x: 4, y: 1 }, level: 3, density: 0, age: 0, frontage: 'S', structureRect: { x: 4, y: 1, w: 1, h: 1 } });
    src.markDemandDirty();
    expect(src.getDemand().residential).toBeGreaterThanOrEqual(0.6);

    const savedJSON = serializeWorld(src);

    const dst = new World(8, 8, { regenerate: false });
    expect(deserializeWorldInto(dst, savedJSON)).toBe(true);

    expect(dst.getDemand().residential).toBeGreaterThanOrEqual(0.6);
  });
});

describe('end-to-end integration: spawn → save → load', () => {
  it('organic spawn round-trip: 1×1 building gets frontage W and survives serialize/deserialize', () => {
    // World: ROAD at (1,2), ZONE_RESIDENTIAL at (2,2). Road is west of zone → frontage W.
    const original = new World(6, 6, { regenerate: false });
    original.getMap().setTile(1, 2, createTile(1, 2, TileType.ROAD));
    original.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));

    // Tick ZONE_GROWTH_INTERVAL times so growth fires exactly once.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) {
      original.tick();
    }

    const buildings = original.getMap().getBuildings();
    const allBuildings = [...buildings.getAllBuildings()];
    expect(allBuildings).toHaveLength(1);

    const b = allBuildings[0];
    expect(b.footprint).toHaveLength(1);
    expect(b.footprint[0]).toEqual({ x: 2, y: 2 });
    expect(b.frontage).toBe('W');

    // Serialize and deserialize into a fresh blank world (no pre-seeding needed —
    // deserializeWorldInto writes all tiles itself).
    const serialized = serializeWorld(original);
    const loaded = new World(6, 6, { regenerate: false });
    expect(deserializeWorldInto(loaded, serialized)).toBe(true);

    // Byte-equal round-trip.
    expect(serializeWorld(loaded)).toBe(serialized);
  });

  it('multi-tile round-trip: 1×2 building footprint + frontage N survive serialize/deserialize', () => {
    // World: ROAD at (2,1) (north of zone), ZONE_RESIDENTIAL at (2,2) and (3,2).
    // addBuilding directly with a 1×2 footprint and frontage N.
    const original = new World(8, 8, { regenerate: false });
    const map = original.getMap();
    map.setTile(2, 1, createTile(2, 1, TileType.ROAD));
    map.setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(3, 2, createTile(3, 2, TileType.ZONE_RESIDENTIAL));

    const ok = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'N',
      structureRect: { x: 2, y: 2, w: 2, h: 1 },
    });
    expect(ok).not.toBeNull();

    // Serialize and deserialize into a fresh blank world.
    const serialized = serializeWorld(original);
    const loaded = new World(8, 8, { regenerate: false });
    expect(deserializeWorldInto(loaded, serialized)).toBe(true);

    const lb = loaded.getMap().getBuildings().getBuildingAt(2, 2);
    expect(lb).not.toBeNull();
    expect(lb!.footprint).toHaveLength(2);
    // footprint sorted by y then x (row-major from footprintCells)
    expect(lb!.footprint).toContainEqual({ x: 2, y: 2 });
    expect(lb!.footprint).toContainEqual({ x: 3, y: 2 });
    expect(lb!.anchor).toEqual({ x: 2, y: 2 });
    expect(lb!.frontage).toBe('N');

    // Byte-equal round-trip.
    expect(serializeWorld(loaded)).toBe(serialized);
  });
});

describe('structureRect round-trip', () => {
  it('preserves structureRect for multiple buildings with varying depths', () => {
    // Build a world with three buildings:
    //   - 1×1 building at (1,1) frontage N, structureRect = full lot (1×1)
    //   - 1×2 (w=1,h=2) building at (3,1)+(3,2), frontage N, structureRect 1×1 (shallow)
    //   - 1×4 (w=1,h=4) building at (5,1)+(5,2)+(5,3)+(5,4), frontage N, structureRect 1×4 (full lot)
    const src = new World(8, 8, { regenerate: false });
    const map = src.getMap();

    // Building A: 1×1, structureRect = lot
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    const bA = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 0, density: 0, age: 0,
      frontage: 'N',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    expect(bA).not.toBeNull();

    // Building B: 1×2, structureRect = 1×1 pinned to N edge
    map.setTile(3, 1, createTile(3, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(3, 2, createTile(3, 2, TileType.ZONE_RESIDENTIAL));
    const bB = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 3, y: 1 }, { x: 3, y: 2 }],
      anchor: { x: 3, y: 1 },
      level: 0, density: 0, age: 0,
      frontage: 'N',
      structureRect: { x: 3, y: 1, w: 1, h: 1 },
    });
    expect(bB).not.toBeNull();

    // Building C: 1×4, structureRect = full lot
    map.setTile(5, 1, createTile(5, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(5, 2, createTile(5, 2, TileType.ZONE_RESIDENTIAL));
    map.setTile(5, 3, createTile(5, 3, TileType.ZONE_RESIDENTIAL));
    map.setTile(5, 4, createTile(5, 4, TileType.ZONE_RESIDENTIAL));
    const bC = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 4 }],
      anchor: { x: 5, y: 1 },
      level: 0, density: 0, age: 0,
      frontage: 'N',
      structureRect: { x: 5, y: 1, w: 1, h: 4 },
    });
    expect(bC).not.toBeNull();

    const serialized = serializeWorld(src);
    const dst = new World(8, 8, { regenerate: false });
    expect(deserializeWorldInto(dst, serialized)).toBe(true);

    const dstBuildings = dst.getMap().getBuildings();
    const rA = dstBuildings.getBuildingAt(1, 1);
    expect(rA).not.toBeNull();
    expect(rA!.structureRect).toEqual({ x: 1, y: 1, w: 1, h: 1 });

    const rB = dstBuildings.getBuildingAt(3, 1);
    expect(rB).not.toBeNull();
    expect(rB!.structureRect).toEqual({ x: 3, y: 1, w: 1, h: 1 });

    const rC = dstBuildings.getBuildingAt(5, 1);
    expect(rC).not.toBeNull();
    expect(rC!.structureRect).toEqual({ x: 5, y: 1, w: 1, h: 4 });
  });
});

describe('structureRect rejection', () => {
  it('rejects sr: [0,0,0,0] (w=0, fails isCanonicalRect)', () => {
    const base = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    const w = 4;
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0]],
      anc: [0, 0],
      lvl: 0, den: 0, age: 0,
      f: 'S',
      sr: [0, 0, 0, 0],
    }];
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects sr extending past the footprint bbox', () => {
    // Lot is 1×1 at (0,0) but sr claims 2×2
    const base = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    const w = 4;
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0]],
      anc: [0, 0],
      lvl: 0, den: 0, age: 0,
      f: 'S',
      sr: [0, 0, 2, 2],
    }];
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects sr not pinned to frontage edge (1×1 structure in middle of 1×4 lot, frontage S)', () => {
    // Lot is 1×4 at (0,0)–(0,3), frontage S requires sr.y+sr.h === 4.
    // sr at (0,1,1,1) is valid canonical but not pinned to S edge.
    const base = JSON.parse(serializeWorld(new World(8, 8, { regenerate: false })));
    const w = 8;
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.t[1 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.t[2 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.t[3 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0], [0, 1], [0, 2], [0, 3]],
      anc: [0, 0],
      lvl: 0, den: 0, age: 0,
      f: 'S',
      sr: [0, 1, 1, 1], // middle of lot, not pinned to S edge (y+h=2 ≠ 4)
    }];
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });
});
