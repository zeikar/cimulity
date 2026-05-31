import { describe, it, expect } from 'vitest';
import { World } from './World';
import { TileType, createTile } from './Tile';
import { serializeWorld, deserializeWorldInto, WORLD_SAVE_VERSION } from './mapSerialization';

describe('WORLD_SAVE_VERSION', () => {
  it('is 16', () => {
    expect(WORLD_SAVE_VERSION).toBe(16);
  });
});

describe('v16 serialization', () => {
  it('WORLD_SAVE_VERSION is 16 and serializeWorld emits vertex-smooth terrain', () => {
    const world = new World(4, 4, { regenerate: false });
    const parsed = JSON.parse(serializeWorld(world));
    expect(WORLD_SAVE_VERSION).toBe(16);
    expect(parsed.v).toBe(16);
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
  it('rejects v15 and older saves without mutating the target world', () => {
    const obj = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    obj.v = 15;

    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);

    obj.v = 14;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
    obj.v = 13;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
    obj.v = 11;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
    obj.v = 10;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
    obj.v = 8;
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
      f: 'S',
      sr: [0, 0, 1, 1],
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
      f: 'S',
      sr: [0, 0, 1, 1],
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
      f: 'S',
      sr: [0, 0, 1, 1],
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
      f: 'S',
      sr: [0, 0, 1, 1],
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
      f: 'S',
      sr: [0, 0, 2, 2],
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
      f: 'S',
      sr: [2, 2, 1, 1],
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

describe('v12 frontage round-trip', () => {
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
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
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
      structureRect: { x: 1, y: 1, w: 1, h: 2 },
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

  it('rejects a v: 15 save', () => {
    const obj = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    obj.v = 15;
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(obj))).toBe(false);
  });

  it('rejects a save with f missing from a building entry', () => {
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
      sr: [0, 0, 1, 1],
    }];
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a save with f: "X" (invalid frontage value)', () => {
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
      sr: [0, 0, 1, 1],
    }];
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });
});

// Helper: build a minimal valid v12 save object for an 8x8 world with a 2x2 power plant
// at anchor (2,2). The terrain is fully flat at height 2 (above sea level).
function makeV12BaseWithPlant() {
  const W = 8;
  const H = 8;
  // Use a real World + serializeWorld to produce a valid terrain DTO, then override tiles + s[].
  const srcWorld = new World(W, H, { regenerate: false });
  for (let vy = 0; vy <= H; vy++) {
    for (let vx = 0; vx <= W; vx++) {
      srcWorld.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
    }
  }
  const base = JSON.parse(serializeWorld(srcWorld));
  // Add POWER_PLANT tiles at (2,2),(3,2),(2,3),(3,3)
  base.t[2 * W + 2] = TileType.POWER_PLANT;
  base.t[2 * W + 3] = TileType.POWER_PLANT;
  base.t[3 * W + 2] = TileType.POWER_PLANT;
  base.t[3 * W + 3] = TileType.POWER_PLANT;
  // Add a structure entry.
  base.s = [{
    id: 0,
    type: 'power_plant',
    foot: [[2, 2], [3, 2], [2, 3], [3, 3]],
    anc: [2, 2],
  }];
  return base;
}

describe('v12 structure persistence', () => {
  it('round-trip: world with 1 power plant serializes and deserializes byte-equal', () => {
    const src = new World(8, 8, { regenerate: false });
    // Set all vertex heights to 2 so isFlatArea passes.
    for (let vy = 0; vy <= 8; vy++) {
      for (let vx = 0; vx <= 8; vx++) {
        src.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
      }
    }
    // Write POWER_PLANT tiles and register the structure.
    const map = src.getMap();
    map.setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    map.setTile(3, 2, createTile(3, 2, TileType.POWER_PLANT));
    map.setTile(2, 3, createTile(2, 3, TileType.POWER_PLANT));
    map.setTile(3, 3, createTile(3, 3, TileType.POWER_PLANT));
    src.getStructureMap().addExistingStructure({
      id: 0,
      type: 'power_plant',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });

    const json1 = serializeWorld(src);
    const dst = new World(8, 8, { regenerate: false });
    expect(deserializeWorldInto(dst, json1)).toBe(true);

    const json2 = serializeWorld(dst);
    expect(json2).toBe(json1);
  });

  it('rejects a v11 envelope (legacy)', () => {
    const base = makeV12BaseWithPlant();
    (base as Record<string, unknown>).v = 11;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope where a structure footprint cell t[] entry is not POWER_PLANT', () => {
    const base = makeV12BaseWithPlant();
    // Change one footprint cell to GRASS — tile/structure mismatch.
    base.t[2 * 8 + 2] = TileType.GRASS;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope with an orphan POWER_PLANT tile not covered by any structure', () => {
    const base = makeV12BaseWithPlant();
    // Add an orphan POWER_PLANT tile at (5,5) with no corresponding structure entry.
    base.t[5 * 8 + 5] = TileType.POWER_PLANT;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope where two structures overlap', () => {
    const base = makeV12BaseWithPlant();
    // Add POWER_PLANT tiles for a second overlapping structure (reuses cells from first).
    base.s.push({
      id: 1,
      type: 'power_plant',
      foot: [[2, 2], [3, 2], [2, 3], [3, 3]],
      anc: [2, 2],
    });
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope where a structure footprint cell has a non-POWER_PLANT tile type (zone tile under structure)', () => {
    const W = 8;
    const base = makeV12BaseWithPlant();
    // Overwrite the plant anchor cell (2,2) with a residential zone tile.
    // validateStructuresArray rejects because every cell in a power_plant footprint
    // must be TileType.POWER_PLANT; finding ZONE_RESIDENTIAL there fails that check.
    base.t[2 * W + 2] = TileType.ZONE_RESIDENTIAL;
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[2, 2]],
      anc: [2, 2],
      lvl: 1,
      den: 0,
      age: 0,
      f: 'S',
      sr: [2, 2, 1, 1],
    }];
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope where a structure anchor fails isFlatArea (sloped corner)', () => {
    const base = makeV12BaseWithPlant();
    // isFlatArea checks that all vertices spanning the 2x2 rectangle share one height.
    // The plant's 2x2 spans from vertex (2,2) to vertex (4,4) [inclusive, 3x3 vertex grid].
    // Mutate vertex (4,4) (SE outer corner) to height 3 — this breaks the flat-slab invariant.
    base.terrain.vertexHeights[4][4] = 3;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope with a 1x1 structure footprint', () => {
    const base = makeV12BaseWithPlant();
    base.s = [{
      id: 0,
      type: 'power_plant',
      foot: [[2, 2]],
      anc: [2, 2],
    }];
    // Only one cell is POWER_PLANT now — fix the other three.
    base.t[2 * 8 + 3] = TileType.GRASS;
    base.t[3 * 8 + 2] = TileType.GRASS;
    base.t[3 * 8 + 3] = TileType.GRASS;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope with a 1x2 structure footprint', () => {
    const base = makeV12BaseWithPlant();
    base.s = [{
      id: 0,
      type: 'power_plant',
      foot: [[2, 2], [2, 3]],
      anc: [2, 2],
    }];
    base.t[2 * 8 + 3] = TileType.GRASS;
    base.t[3 * 8 + 3] = TileType.GRASS;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope with a 3x3 structure footprint', () => {
    const W = 8;
    const base = makeV12BaseWithPlant();
    // Replace the 2x2 plant with a 3x3.
    // First clear old POWER_PLANT tiles.
    base.t[2 * W + 2] = TileType.GRASS;
    base.t[2 * W + 3] = TileType.GRASS;
    base.t[3 * W + 2] = TileType.GRASS;
    base.t[3 * W + 3] = TileType.GRASS;
    // Set 9 cells to POWER_PLANT.
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) base.t[y * W + x] = TileType.POWER_PLANT;
    const foot: [number, number][] = [];
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) foot.push([x, y]);
    base.s = [{ id: 0, type: 'power_plant', foot, anc: [2, 2] }];
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 envelope with a 4x4 structure footprint', () => {
    const W = 8;
    const base = makeV12BaseWithPlant();
    base.t[2 * W + 2] = TileType.GRASS;
    base.t[2 * W + 3] = TileType.GRASS;
    base.t[3 * W + 2] = TileType.GRASS;
    base.t[3 * W + 3] = TileType.GRASS;
    for (let y = 0; y <= 3; y++) for (let x = 0; x <= 3; x++) base.t[y * W + x] = TileType.POWER_PLANT;
    const foot: [number, number][] = [];
    for (let y = 0; y <= 3; y++) for (let x = 0; x <= 3; x++) foot.push([x, y]);
    base.s = [{ id: 0, type: 'power_plant', foot, anc: [0, 0] }];
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('hydrate: isPowered reflects plant+roads immediately after deserializeWorldInto (no tick/recompute needed)', () => {
    // Setup: plant at (2,2)-(3,3), roads at (2,4),(1,4),(0,4) — road chain adjacent to plant's south edge.
    // After load, all three road cells should be powered. No tick or manual recompute.
    const W = 8;
    const base = makeV12BaseWithPlant();
    // Add roads south of the plant (y=4): (0,4),(1,4),(2,4) — (2,4) is adjacent to plant cell (2,3).
    base.t[4 * W + 0] = TileType.ROAD;
    base.t[4 * W + 1] = TileType.ROAD;
    base.t[4 * W + 2] = TileType.ROAD;

    const dst = new World(W, W, { regenerate: false });
    expect(deserializeWorldInto(dst, JSON.stringify(base))).toBe(true);

    // The road at (2,4) is adjacent to plant's south cell (2,3) — it must be powered.
    // No tick or manual recompute — the hydrate path drained the dirty flag itself.
    expect(dst.getPowerMap().isPowered(2, 4)).toBe(true);
    // Connected road cells are also powered.
    expect(dst.getPowerMap().isPowered(1, 4)).toBe(true);
    expect(dst.getPowerMap().isPowered(0, 4)).toBe(true);
  });

  it('World.reset regenerate:true then isPowered(0,0) returns false without manual recompute', () => {
    const world = new World(8, 8, { regenerate: true });
    // reset clears structures and drains the power flag.
    world.reset({ regenerate: true });
    // No structures or roads → nothing powered.
    expect(world.getPowerMap().isPowered(0, 0)).toBe(false);
  });

  it('rejects a v12 envelope with an orphan WATER_TOWER tile not covered by any structure', () => {
    const W = 8;
    const base = makeV12BaseWithPlant();
    // Add a bare WATER_TOWER tile at (5,5) with no matching structure entry.
    base.t[5 * W + 5] = TileType.WATER_TOWER;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 where a water_tower structure footprint cell t[] is not WATER_TOWER', () => {
    const W = 8;
    // Use the plant base but inject a 1×1 water_tower structure whose footprint cell is GRASS.
    const base = makeV12BaseWithPlant();
    // Place water_tower structure at (5,5) but leave that tile as GRASS (mismatch).
    base.s.push({
      id: 1,
      type: 'water_tower',
      foot: [[5, 5]],
      anc: [5, 5],
    });
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 where a water_tower overlaps a power_plant', () => {
    const W = 8;
    const base = makeV12BaseWithPlant();
    // Attempt to place a 1×1 water_tower structure overlapping the plant at (2,2).
    base.s.push({
      id: 1,
      type: 'water_tower',
      foot: [[2, 2]],
      anc: [2, 2],
    });
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 where a water_tower anchor fails isFlatArea (sloped corner)', () => {
    const W = 8;
    const base = makeV12BaseWithPlant();
    // Set WATER_TOWER tile at a non-overlapping site (5,5).
    base.t[5 * W + 5] = TileType.WATER_TOWER;
    base.s.push({
      id: 1,
      type: 'water_tower',
      foot: [[5, 5]],
      anc: [5, 5],
    });
    // Break flatness: vertex (6,6) — SE outer corner of the 1×1 slab — to height 3.
    base.terrain.vertexHeights[6][6] = 3;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 with a 2×2 water_tower footprint (wrong size, should be 1×1)', () => {
    const W = 8;
    const base = makeV12BaseWithPlant();
    // 2×2 water_tower footprint is now invalid (1×1 is the correct size).
    base.t[5 * W + 5] = TileType.WATER_TOWER;
    base.t[5 * W + 6] = TileType.WATER_TOWER;
    base.t[6 * W + 5] = TileType.WATER_TOWER;
    base.t[6 * W + 6] = TileType.WATER_TOWER;
    base.s.push({
      id: 1,
      type: 'water_tower',
      foot: [[5, 5], [6, 5], [5, 6], [6, 6]],
      anc: [5, 5],
    });
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('rejects a v12 with a 3×3 water_tower footprint', () => {
    const W = 8;
    const base = makeV12BaseWithPlant();
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) base.t[y * W + x] = TileType.WATER_TOWER;
    const foot: [number, number][] = [];
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) foot.push([x, y]);
    base.s.push({ id: 1, type: 'water_tower', foot, anc: [5, 5] });
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('round-trip: world with 1 water tower + roads + zones byte-equal on re-serialize', () => {
    const W = 8;
    const src = new World(W, W, { regenerate: false });
    // Set all vertex heights to 2 (flat above sea level).
    for (let vy = 0; vy <= W; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        src.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
      }
    }
    const map = src.getMap();
    // Write a single WATER_TOWER tile and register the 1×1 structure at (4,4).
    map.setTile(4, 4, createTile(4, 4, TileType.WATER_TOWER));
    src.getStructureMap().addExistingStructure({
      id: 0,
      type: 'water_tower',
      footprint: [{ x: 4, y: 4 }],
      anchor: { x: 4, y: 4 },
    });
    // Add a road adjacent to the tower (waters it) and a zone tile.
    map.setTile(4, 3, createTile(4, 3, TileType.ROAD));
    map.setTile(5, 3, createTile(5, 3, TileType.ZONE_RESIDENTIAL));

    const json1 = serializeWorld(src);
    const dst = new World(W, W, { regenerate: false });
    expect(deserializeWorldInto(dst, json1)).toBe(true);
    expect(serializeWorld(dst)).toBe(json1);
  });

  it('round-trip: world with BOTH a power plant and a water tower', () => {
    const W = 8;
    const src = new World(W, W, { regenerate: false });
    for (let vy = 0; vy <= W; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        src.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
      }
    }
    const map = src.getMap();
    // Power plant at (0,0).
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        map.setTile(dx, dy, createTile(dx, dy, TileType.POWER_PLANT));
      }
    }
    src.getStructureMap().addExistingStructure({
      id: 0,
      type: 'power_plant',
      footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
      anchor: { x: 0, y: 0 },
    });
    // Water tower at (4,4) — 1×1 single cell.
    map.setTile(4, 4, createTile(4, 4, TileType.WATER_TOWER));
    src.getStructureMap().addExistingStructure({
      id: 1,
      type: 'water_tower',
      footprint: [{ x: 4, y: 4 }],
      anchor: { x: 4, y: 4 },
    });

    const json1 = serializeWorld(src);
    const dst = new World(W, W, { regenerate: false });
    expect(deserializeWorldInto(dst, json1)).toBe(true);
    expect(serializeWorld(dst)).toBe(json1);
    // Both structures present in the destination.
    expect(dst.getStructureMap().getAllStructures()).toHaveLength(2);
  });

  it('hydrate: isWatered reflects tower+roads immediately after deserializeWorldInto (no tick/recompute needed)', () => {
    // Tower at (2,3) — 1×1, adjacent to road (2,4). Road chain (0,4),(1,4),(2,4).
    // After load, all three road cells should be watered. No tick or manual recompute.
    const W = 8;
    const src = new World(W, W, { regenerate: false });
    for (let vy = 0; vy <= W; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        src.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
      }
    }
    const map = src.getMap();
    // Water tower at (2,3) — single cell adjacent to road (2,4).
    map.setTile(2, 3, createTile(2, 3, TileType.WATER_TOWER));
    src.getStructureMap().addExistingStructure({
      id: 0,
      type: 'water_tower',
      footprint: [{ x: 2, y: 3 }],
      anchor: { x: 2, y: 3 },
    });
    // Road chain (0,4),(1,4),(2,4). Tower at (2,3) adj to road (2,4) → seeds BFS.
    map.setTile(0, 4, createTile(0, 4, TileType.ROAD));
    map.setTile(1, 4, createTile(1, 4, TileType.ROAD));
    map.setTile(2, 4, createTile(2, 4, TileType.ROAD));

    const dst = new World(W, W, { regenerate: false });
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);

    // Roads watered immediately — no tick or manual recompute needed.
    expect(dst.getWaterMap().isWatered(2, 4)).toBe(true);
    expect(dst.getWaterMap().isWatered(1, 4)).toBe(true);
    expect(dst.getWaterMap().isWatered(0, 4)).toBe(true);
  });

  it('World.reset({ regenerate: true }) then isWatered(0,0) returns false without manual recompute', () => {
    const world = new World(8, 8, { regenerate: true });
    // reset clears structures and drains the water flag.
    world.reset({ regenerate: true });
    // No structures or roads → nothing watered.
    expect(world.getWaterMap().isWatered(0, 0)).toBe(false);
  });
});

// Helper: build a minimal valid v16 save object for an 8x8 world with a 2x2 police
// station at anchor (2,2). The terrain is fully flat at height 2 (above sea level).
function makeV16BaseWithPoliceStation() {
  const W = 8;
  const H = 8;
  const srcWorld = new World(W, H, { regenerate: false });
  for (let vy = 0; vy <= H; vy++) {
    for (let vx = 0; vx <= W; vx++) {
      srcWorld.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
    }
  }
  const base = JSON.parse(serializeWorld(srcWorld));
  // Add POLICE_STATION tiles at (2,2),(3,2),(2,3),(3,3).
  base.t[2 * W + 2] = TileType.POLICE_STATION;
  base.t[2 * W + 3] = TileType.POLICE_STATION;
  base.t[3 * W + 2] = TileType.POLICE_STATION;
  base.t[3 * W + 3] = TileType.POLICE_STATION;
  base.s = [{
    id: 0,
    type: 'police_station',
    foot: [[2, 2], [3, 2], [2, 3], [3, 3]],
    anc: [2, 2],
  }];
  return base;
}

describe('v16 police station persistence', () => {
  it('(a) round-trips a police station: structure present with same footprint/anchor', () => {
    const W = 8;
    const src = new World(W, W, { regenerate: false });
    for (let vy = 0; vy <= W; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        src.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
      }
    }
    const map = src.getMap();
    map.setTile(2, 2, createTile(2, 2, TileType.POLICE_STATION));
    map.setTile(3, 2, createTile(3, 2, TileType.POLICE_STATION));
    map.setTile(2, 3, createTile(2, 3, TileType.POLICE_STATION));
    map.setTile(3, 3, createTile(3, 3, TileType.POLICE_STATION));
    src.getStructureMap().addExistingStructure({
      id: 0,
      type: 'police_station',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });

    const json1 = serializeWorld(src);
    const parsed = JSON.parse(json1);
    expect(parsed.v).toBe(16);

    const dst = new World(W, W, { regenerate: false });
    expect(deserializeWorldInto(dst, json1)).toBe(true);
    // Byte-equal re-serialize proves the structure round-tripped intact.
    expect(serializeWorld(dst)).toBe(json1);

    const all = dst.getStructureMap().getAllStructures();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('police_station');
    expect(all[0].anchor).toEqual({ x: 2, y: 2 });
    expect(all[0].footprint).toHaveLength(4);
    expect(all[0].footprint).toContainEqual({ x: 2, y: 2 });
    expect(all[0].footprint).toContainEqual({ x: 3, y: 3 });
  });

  it('(b) rejects a POLICE_STATION tile not covered by any structure (orphan-tile)', () => {
    const W = 8;
    const base = makeV16BaseWithPoliceStation();
    // Add an orphan POLICE_STATION tile at (5,5) with no matching structure entry.
    base.t[5 * W + 5] = TileType.POLICE_STATION;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(c) rejects a police_station whose footprint tile t[] is not POLICE_STATION (tile/structure mismatch)', () => {
    const W = 8;
    const base = makeV16BaseWithPoliceStation();
    // Change one footprint cell to GRASS — tile/structure type mismatch.
    base.t[2 * W + 2] = TileType.GRASS;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(d) rejects a police_station on a non-flat 2×2 area (isFlatArea coherence)', () => {
    const base = makeV16BaseWithPoliceStation();
    // The station's 2×2 spans vertices (2,2)..(4,4). Mutate the SE outer corner
    // vertex (4,4) to height 3 — breaks the flat-slab invariant isFlatArea checks.
    base.terrain.vertexHeights[4][4] = 3;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(e) rejects an otherwise-valid envelope with v: 15 (stale-save guard after the v16 bump)', () => {
    const base = makeV16BaseWithPoliceStation();
    (base as Record<string, unknown>).v = 15;

    const target = new World(8, 8, { regenerate: false });
    // Pre-mark the target so we can verify it is not mutated on rejection.
    target.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    expect(deserializeWorldInto(target, JSON.stringify(base))).toBe(false);
    expect(target.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
  });
});

// Helper: build a minimal valid v16 save object for an 8x8 world with a 2x2 fire
// station at anchor (2,2). The terrain is fully flat at height 2 (above sea level).
function makeV16BaseWithFireStation() {
  const W = 8;
  const H = 8;
  const srcWorld = new World(W, H, { regenerate: false });
  for (let vy = 0; vy <= H; vy++) {
    for (let vx = 0; vx <= W; vx++) {
      srcWorld.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
    }
  }
  const base = JSON.parse(serializeWorld(srcWorld));
  // Add FIRE_STATION tiles at (2,2),(3,2),(2,3),(3,3).
  base.t[2 * W + 2] = TileType.FIRE_STATION;
  base.t[2 * W + 3] = TileType.FIRE_STATION;
  base.t[3 * W + 2] = TileType.FIRE_STATION;
  base.t[3 * W + 3] = TileType.FIRE_STATION;
  base.s = [{
    id: 0,
    type: 'fire_station',
    foot: [[2, 2], [3, 2], [2, 3], [3, 3]],
    anc: [2, 2],
  }];
  return base;
}

describe('v16 fire station persistence', () => {
  it('(a) round-trips a fire station: structure present with same footprint/anchor', () => {
    const W = 8;
    const src = new World(W, W, { regenerate: false });
    for (let vy = 0; vy <= W; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        src.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
      }
    }
    const map = src.getMap();
    map.setTile(2, 2, createTile(2, 2, TileType.FIRE_STATION));
    map.setTile(3, 2, createTile(3, 2, TileType.FIRE_STATION));
    map.setTile(2, 3, createTile(2, 3, TileType.FIRE_STATION));
    map.setTile(3, 3, createTile(3, 3, TileType.FIRE_STATION));
    src.getStructureMap().addExistingStructure({
      id: 0,
      type: 'fire_station',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });

    const json1 = serializeWorld(src);
    const parsed = JSON.parse(json1);
    expect(parsed.v).toBe(16);

    const dst = new World(W, W, { regenerate: false });
    expect(deserializeWorldInto(dst, json1)).toBe(true);
    // Byte-equal re-serialize proves the structure round-tripped intact.
    expect(serializeWorld(dst)).toBe(json1);

    const all = dst.getStructureMap().getAllStructures();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('fire_station');
    expect(all[0].anchor).toEqual({ x: 2, y: 2 });
    expect(all[0].footprint).toHaveLength(4);
    expect(all[0].footprint).toContainEqual({ x: 2, y: 2 });
    expect(all[0].footprint).toContainEqual({ x: 3, y: 3 });
  });

  it('(b) rejects a FIRE_STATION tile not covered by any structure (orphan-tile)', () => {
    const W = 8;
    const base = makeV16BaseWithFireStation();
    // Add an orphan FIRE_STATION tile at (5,5) with no matching structure entry.
    base.t[5 * W + 5] = TileType.FIRE_STATION;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(c) rejects a fire_station whose footprint tile t[] is not FIRE_STATION (tile/structure mismatch)', () => {
    const W = 8;
    const base = makeV16BaseWithFireStation();
    // Change one footprint cell to GRASS — tile/structure type mismatch.
    base.t[2 * W + 2] = TileType.GRASS;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(d) rejects a fire_station on a non-flat 2×2 area (isFlatArea coherence)', () => {
    const base = makeV16BaseWithFireStation();
    // The station's 2×2 spans vertices (2,2)..(4,4). Mutate the SE outer corner
    // vertex (4,4) to height 3 — breaks the flat-slab invariant isFlatArea checks.
    base.terrain.vertexHeights[4][4] = 3;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(e) rejects an otherwise-valid envelope with v: 15 (stale-save guard after the v16 bump)', () => {
    const base = makeV16BaseWithFireStation();
    (base as Record<string, unknown>).v = 15;

    const target = new World(8, 8, { regenerate: false });
    // Pre-mark the target so we can verify it is not mutated on rejection.
    target.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    expect(deserializeWorldInto(target, JSON.stringify(base))).toBe(false);
    expect(target.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
  });
});

// Helper: build a minimal valid v16 save object for an 8x8 world with a 2x2 hospital
// at anchor (2,2). The terrain is fully flat at height 2 (above sea level).
function makeV16BaseWithHospitalStation() {
  const W = 8;
  const H = 8;
  const srcWorld = new World(W, H, { regenerate: false });
  for (let vy = 0; vy <= H; vy++) {
    for (let vx = 0; vx <= W; vx++) {
      srcWorld.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
    }
  }
  const base = JSON.parse(serializeWorld(srcWorld));
  // Add HOSPITAL tiles at (2,2),(3,2),(2,3),(3,3).
  base.t[2 * W + 2] = TileType.HOSPITAL;
  base.t[2 * W + 3] = TileType.HOSPITAL;
  base.t[3 * W + 2] = TileType.HOSPITAL;
  base.t[3 * W + 3] = TileType.HOSPITAL;
  base.s = [{
    id: 0,
    type: 'hospital',
    foot: [[2, 2], [3, 2], [2, 3], [3, 3]],
    anc: [2, 2],
  }];
  return base;
}

describe('v16 hospital station persistence', () => {
  it('(a) round-trips a hospital: structure present with same footprint/anchor', () => {
    const W = 8;
    const src = new World(W, W, { regenerate: false });
    for (let vy = 0; vy <= W; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        src.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
      }
    }
    const map = src.getMap();
    map.setTile(2, 2, createTile(2, 2, TileType.HOSPITAL));
    map.setTile(3, 2, createTile(3, 2, TileType.HOSPITAL));
    map.setTile(2, 3, createTile(2, 3, TileType.HOSPITAL));
    map.setTile(3, 3, createTile(3, 3, TileType.HOSPITAL));
    src.getStructureMap().addExistingStructure({
      id: 0,
      type: 'hospital',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });

    const json1 = serializeWorld(src);
    const parsed = JSON.parse(json1);
    expect(parsed.v).toBe(16);

    const dst = new World(W, W, { regenerate: false });
    expect(deserializeWorldInto(dst, json1)).toBe(true);
    // Byte-equal re-serialize proves the structure round-tripped intact.
    expect(serializeWorld(dst)).toBe(json1);

    const all = dst.getStructureMap().getAllStructures();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('hospital');
    expect(all[0].anchor).toEqual({ x: 2, y: 2 });
    expect(all[0].footprint).toHaveLength(4);
    expect(all[0].footprint).toContainEqual({ x: 2, y: 2 });
    expect(all[0].footprint).toContainEqual({ x: 3, y: 3 });
  });

  it('(b) rejects a HOSPITAL tile not covered by any structure (orphan-tile)', () => {
    const W = 8;
    const base = makeV16BaseWithHospitalStation();
    // Add an orphan HOSPITAL tile at (5,5) with no matching structure entry.
    base.t[5 * W + 5] = TileType.HOSPITAL;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(c) rejects a hospital whose footprint tile t[] is not HOSPITAL (tile/structure mismatch)', () => {
    const W = 8;
    const base = makeV16BaseWithHospitalStation();
    // Change one footprint cell to GRASS — tile/structure type mismatch.
    base.t[2 * W + 2] = TileType.GRASS;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(d) rejects a hospital on a non-flat 2×2 area (isFlatArea coherence)', () => {
    const base = makeV16BaseWithHospitalStation();
    // The hospital's 2×2 spans vertices (2,2)..(4,4). Mutate the SE outer corner
    // vertex (4,4) to height 3 — breaks the flat-slab invariant isFlatArea checks.
    base.terrain.vertexHeights[4][4] = 3;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(e) rejects an otherwise-valid envelope with v: 15 (stale-save guard after the v16 bump)', () => {
    const base = makeV16BaseWithHospitalStation();
    (base as Record<string, unknown>).v = 15;

    const target = new World(8, 8, { regenerate: false });
    // Pre-mark the target so we can verify it is not mutated on rejection.
    target.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    expect(deserializeWorldInto(target, JSON.stringify(base))).toBe(false);
    expect(target.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
  });
});

// Helper: build a minimal valid v16 save object for an 8x8 world with a 2x2 school
// at anchor (2,2). The terrain is fully flat at height 2 (above sea level).
function makeV16BaseWithSchool() {
  const W = 8;
  const H = 8;
  const srcWorld = new World(W, H, { regenerate: false });
  for (let vy = 0; vy <= H; vy++) {
    for (let vx = 0; vx <= W; vx++) {
      srcWorld.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
    }
  }
  const base = JSON.parse(serializeWorld(srcWorld));
  // Add SCHOOL tiles at (2,2),(3,2),(2,3),(3,3).
  base.t[2 * W + 2] = TileType.SCHOOL;
  base.t[2 * W + 3] = TileType.SCHOOL;
  base.t[3 * W + 2] = TileType.SCHOOL;
  base.t[3 * W + 3] = TileType.SCHOOL;
  base.s = [{
    id: 0,
    type: 'school',
    foot: [[2, 2], [3, 2], [2, 3], [3, 3]],
    anc: [2, 2],
  }];
  return base;
}

describe('v16 school station persistence', () => {
  it('(a) round-trips a school: structure present with same footprint/anchor', () => {
    const W = 8;
    const src = new World(W, W, { regenerate: false });
    for (let vy = 0; vy <= W; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        src.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
      }
    }
    const map = src.getMap();
    map.setTile(2, 2, createTile(2, 2, TileType.SCHOOL));
    map.setTile(3, 2, createTile(3, 2, TileType.SCHOOL));
    map.setTile(2, 3, createTile(2, 3, TileType.SCHOOL));
    map.setTile(3, 3, createTile(3, 3, TileType.SCHOOL));
    src.getStructureMap().addExistingStructure({
      id: 0,
      type: 'school',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });

    const json1 = serializeWorld(src);
    const parsed = JSON.parse(json1);
    expect(parsed.v).toBe(16);

    const dst = new World(W, W, { regenerate: false });
    expect(deserializeWorldInto(dst, json1)).toBe(true);
    // Byte-equal re-serialize proves the structure round-tripped intact.
    expect(serializeWorld(dst)).toBe(json1);

    const all = dst.getStructureMap().getAllStructures();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('school');
    expect(all[0].anchor).toEqual({ x: 2, y: 2 });
    expect(all[0].footprint).toHaveLength(4);
    expect(all[0].footprint).toContainEqual({ x: 2, y: 2 });
    expect(all[0].footprint).toContainEqual({ x: 3, y: 3 });
  });

  it('(b) rejects a SCHOOL tile not covered by any structure (orphan-tile)', () => {
    const W = 8;
    const base = makeV16BaseWithSchool();
    // Add an orphan SCHOOL tile at (5,5) with no matching structure entry.
    base.t[5 * W + 5] = TileType.SCHOOL;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(c) rejects a school whose footprint tile t[] is not SCHOOL (tile/structure mismatch)', () => {
    const W = 8;
    const base = makeV16BaseWithSchool();
    // Change one footprint cell to GRASS — tile/structure type mismatch.
    base.t[2 * W + 2] = TileType.GRASS;
    expect(deserializeWorldInto(new World(W, W, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(d) rejects a school on a non-flat 2×2 area (isFlatArea coherence)', () => {
    const base = makeV16BaseWithSchool();
    // The school's 2×2 spans vertices (2,2)..(4,4). Mutate the SE outer corner
    // vertex (4,4) to height 3 — breaks the flat-slab invariant isFlatArea checks.
    base.terrain.vertexHeights[4][4] = 3;
    expect(deserializeWorldInto(new World(8, 8, { regenerate: false }), JSON.stringify(base))).toBe(false);
  });

  it('(e) rejects an otherwise-valid envelope with v: 15 (stale-save guard after the v16 bump)', () => {
    const base = makeV16BaseWithSchool();
    (base as Record<string, unknown>).v = 15;

    const target = new World(8, 8, { regenerate: false });
    // Pre-mark the target so we can verify it is not mutated on rejection.
    target.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    expect(deserializeWorldInto(target, JSON.stringify(base))).toBe(false);
    expect(target.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
  });
});
