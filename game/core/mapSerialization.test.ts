import { describe, it, expect } from 'vitest';
import { World } from './World';
import { TileType, createTile } from './Tile';
import { serializeWorld, deserializeWorldInto, WORLD_SAVE_VERSION } from './mapSerialization';
import { ZONE_GROWTH_INTERVAL } from './World';

describe('v9 serialization', () => {
  it('WORLD_SAVE_VERSION is 9 and serializeWorld emits vertex-smooth terrain', () => {
    const world = new World(4, 4, { regenerate: false });
    const parsed = JSON.parse(serializeWorld(world));
    expect(WORLD_SAVE_VERSION).toBe(9);
    expect(parsed.v).toBe(9);
    expect(parsed.terrain.mode).toBe('vertex-smooth');
    expect(parsed.terrain.vertexHeights).toHaveLength(5);
    expect('tileElevations' in parsed.terrain).toBe(false);
  });

  it('round-trips vertex heights and tiles', () => {
    const src = new World(4, 4, { regenerate: false });
    src.getTerrain().unsafeSetVertexHeight(1, 1, 2);
    src.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));

    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);
    expect(dst.getTerrain().getVertexHeight(1, 1)).toBe(2);
    expect(dst.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
  });

  it('rejects native v8 terrain with tileElevations present', () => {
    const obj = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    obj.terrain.tileElevations = [[1]];
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(obj))).toBe(false);
  });
  it('rejects v8 and older saves without mutating the target world', () => {
    const obj = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    obj.v = 8;

    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);

    obj.v = 7;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
    obj.v = 6;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
  });

  it('round-trips a ROAD placed on a coplanar non-flat tile', () => {
    // N-S ramp at tile (2,2): corners (2,2)=1,(3,2)=1 on the top edge,
    // (2,3)=2,(3,3)=2 on the bottom edge — coplanar but not flat.
    const src = new World(4, 4, { regenerate: false });
    src.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    src.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    src.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));

    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);
    expect(dst.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
    expect(dst.getTerrain().getVertexHeight(2, 3)).toBe(2);
    expect(dst.getTerrain().getVertexHeight(3, 3)).toBe(2);
  });

  it('round-trips a ZONE_RESIDENTIAL placed on a coplanar non-flat tile', () => {
    // Same N-S ramp shape at tile (2,2), zone with no building.
    const src = new World(4, 4, { regenerate: false });
    src.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    src.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    src.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));

    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);
    expect(dst.getMap().getTile(2, 2)?.type).toBe(TileType.ZONE_RESIDENTIAL);
  });

  it('rejects a save where a disconnected 2-cell footprint has cells at different renderHeights', () => {
    // Disconnected footprint: cells (0,0) and (5,5) on a 10x10 world.
    // Both cells are individually flat but at different heights (2 vs 3).
    // The same-height cross-cell check must reject this.
    const base = JSON.parse(serializeWorld(new World(10, 10, { regenerate: false })));
    const w = 10;

    // Set cell (0,0) flat at height 2: vertices (0,0),(1,0),(0,1),(1,1) = 2.
    base.terrain.vertexHeights[0][0] = 2;
    base.terrain.vertexHeights[0][1] = 2;
    base.terrain.vertexHeights[1][0] = 2;
    base.terrain.vertexHeights[1][1] = 2;

    // Set cell (5,5) flat at height 3: vertices (5,5),(6,5),(5,6),(6,6) = 3.
    base.terrain.vertexHeights[5][5] = 3;
    base.terrain.vertexHeights[5][6] = 3;
    base.terrain.vertexHeights[6][5] = 3;
    base.terrain.vertexHeights[6][6] = 3;

    // Set tile types to ZONE_RESIDENTIAL for both footprint cells.
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.t[5 * w + 5] = TileType.ZONE_RESIDENTIAL;

    // Add a residential building with a disconnected 2-cell footprint.
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0], [5, 5]],
      anc: [0, 0],
      lvl: 1,
      den: 0,
      age: 0,
    }];

    expect(deserializeWorldInto(new World(10, 10, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a disconnected 2-cell footprint even when both cells share the same renderHeight (Task-4 shape check)', () => {
    // Pre-Task-4 this passed the same-height check and was accepted.
    // Task 4 adds isCanonicalFootprintRect which rejects non-rectangular footprints
    // regardless of height equality. Documenting the layering: same-height guards one
    // class; canonical-rect closes off the rest.
    const base = JSON.parse(serializeWorld(new World(10, 10, { regenerate: false })));
    const w = 10;

    // Set cell (0,0) flat at height 2.
    base.terrain.vertexHeights[0][0] = 2;
    base.terrain.vertexHeights[0][1] = 2;
    base.terrain.vertexHeights[1][0] = 2;
    base.terrain.vertexHeights[1][1] = 2;

    // Set cell (5,5) flat at height 2.
    base.terrain.vertexHeights[5][5] = 2;
    base.terrain.vertexHeights[5][6] = 2;
    base.terrain.vertexHeights[6][5] = 2;
    base.terrain.vertexHeights[6][6] = 2;

    // Set tile types to ZONE_RESIDENTIAL for both footprint cells.
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.t[5 * w + 5] = TileType.ZONE_RESIDENTIAL;

    // Disconnected footprint: not a canonical rectangle → rejected by isCanonicalFootprintRect.
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0], [5, 5]],
      anc: [0, 0],
      lvl: 1,
      den: 0,
      age: 0,
    }];

    expect(deserializeWorldInto(new World(10, 10, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a save containing an L-shape footprint', () => {
    const base = JSON.parse(serializeWorld(new World(10, 10, { regenerate: false })));
    const w = 10;
    // L-shape: (0,0),(1,0),(0,1) — 3 cells, 2×2 bounding box, missing (1,1).
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.t[0 * w + 1] = TileType.ZONE_RESIDENTIAL;
    base.t[1 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0], [1, 0], [0, 1]],
      anc: [0, 0],
      lvl: 1,
      den: 0,
      age: 0,
    }];
    expect(deserializeWorldInto(new World(10, 10, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a save with a 5×1 footprint (W > 4)', () => {
    const base = JSON.parse(serializeWorld(new World(10, 10, { regenerate: false })));
    const w = 10;
    // 5 cells in a row starting at (0,0).
    for (let x = 0; x < 5; x++) base.t[0 * w + x] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
      anc: [0, 0],
      lvl: 1,
      den: 0,
      age: 0,
    }];
    expect(deserializeWorldInto(new World(10, 10, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a save where anchor is the SE corner (not NW)', () => {
    const base = JSON.parse(serializeWorld(new World(10, 10, { regenerate: false })));
    const w = 10;
    // 2×2 rectangle with anchor at SE corner (1,1) instead of NW (0,0).
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.t[0 * w + 1] = TileType.ZONE_RESIDENTIAL;
    base.t[1 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.t[1 * w + 1] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0], [1, 0], [0, 1], [1, 1]],
      anc: [1, 1],
      lvl: 1,
      den: 0,
      age: 0,
    }];
    expect(deserializeWorldInto(new World(10, 10, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a save where a building footprint lands on a coplanar non-flat tile', () => {
    // Construct a save object directly with a coplanar non-flat tile at (2,2)
    // that has a building footprint on it. The strict-flat predicate must reject this.
    const base = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    const w = 4;

    // Set N-S ramp vertices: (2,3)=2 and (3,3)=2 while (2,2) and (3,2) stay at 1.
    base.terrain.vertexHeights[3][2] = 2;
    base.terrain.vertexHeights[3][3] = 2;

    // Place ZONE_RESIDENTIAL at (2,2) (required tile type for 'residential' buildings).
    base.t[2 * w + 2] = TileType.ZONE_RESIDENTIAL;

    // Add a building with footprint [[2,2]].
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[2, 2]],
      anc: [2, 2],
      lvl: 1,
      den: 0,
      age: 0,
    }];

    const target = new World(4, 4, { regenerate: false });
    // Pre-mark target so we can verify no mutation occurred.
    target.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));

    expect(deserializeWorldInto(target, JSON.stringify(base))).toBe(false);
    // Target must be unchanged.
    expect(target.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(target.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });
});

describe('v9 frontage round-trip', () => {
  it('round-trip preserves frontage: N for a 1×1 building', () => {
    const src = new World(4, 4, { regenerate: false });
    const map = src.getMap();
    // Zone at (1,1), road at (1,0) (north) so frontage will be N via pickFrontage.
    // We seed it directly with addBuilding since tick is not used here.
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    const ok = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'N',
    });
    expect(ok).not.toBeNull();

    const dst = new World(4, 4, { regenerate: false });
    dst.getMap().setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);
    const b = dst.getMap().getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('N');
  });

  it('round-trip preserves frontage: E and full footprint for a 1×2 building', () => {
    const src = new World(6, 6, { regenerate: false });
    const map = src.getMap();
    // 1×2 (w=1, h=2) footprint at (1,1) and (1,2).
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 2, createTile(1, 2, TileType.ZONE_RESIDENTIAL));
    const ok = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 1, y: 1 }, { x: 1, y: 2 }],
      anchor: { x: 1, y: 1 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'E',
    });
    expect(ok).not.toBeNull();

    const dst = new World(6, 6, { regenerate: false });
    dst.getMap().setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    dst.getMap().setTile(1, 2, createTile(1, 2, TileType.ZONE_RESIDENTIAL));
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);
    const b = dst.getMap().getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('E');
    expect(b!.footprint).toHaveLength(2);
    expect(b!.footprint).toContainEqual({ x: 1, y: 1 });
    expect(b!.footprint).toContainEqual({ x: 1, y: 2 });
  });

  it('rejects a v: 8 save', () => {
    const obj = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    obj.v = 8;
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(obj))).toBe(false);
  });

  it('rejects a v: 9 save with f missing from a building entry', () => {
    const base = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    const w = 4;
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0]],
      anc: [0, 0],
      lvl: 0,
      den: 0,
      age: 0,
      // f intentionally omitted
    }];
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v: 9 save with f: "X" (invalid frontage value)', () => {
    const base = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    const w = 4;
    base.t[0 * w + 0] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[0, 0]],
      anc: [0, 0],
      lvl: 0,
      den: 0,
      age: 0,
      f: 'X',
    }];
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(base))).toBe(false);
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
