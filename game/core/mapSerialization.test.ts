import { describe, it, expect } from 'vitest';
import { TileType, createTile } from './Tile';
import { World } from './World';
import { serializeWorld, deserializeWorldInto, WORLD_SAVE_VERSION } from './mapSerialization';
import { MAX_ELEVATION, SEA_LEVEL } from './Terrain';

// ---------------------------------------------------------------------------
// v7 envelope: serializeWorld / deserializeWorldInto
// ---------------------------------------------------------------------------

describe('v7 envelope — WORLD_SAVE_VERSION', () => {
  it('WORLD_SAVE_VERSION is 7', () => {
    expect(WORLD_SAVE_VERSION).toBe(7);
  });

  it('serializeWorld emits v: 7', () => {
    const world = new World(4, 4, { regenerate: false });
    const parsed = JSON.parse(serializeWorld(world));
    expect(parsed.v).toBe(7);
  });
});

describe('v7 envelope — round-trip', () => {
  it('round-trips a known world: land + water + road + 2x2 building', () => {
    const src = new World(8, 8, { regenerate: false });
    const terrain = src.getTerrain();

    // Set up a deliberate elevation map:
    //   most tiles at elev 1 (default), water tiles at elev 0, road at elev 2,
    //   2x2 building footprint at elev 3.
    terrain.unsafeSetElevation(0, 0, 0); // water cell
    terrain.unsafeSetElevation(1, 0, 0); // water cell
    terrain.unsafeSetElevation(4, 4, 2); // road elev
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        terrain.unsafeSetElevation(6 + dx, 6 + dy, 3);
      }
    }

    // Tiles: road at (4,4), and a 2x2 residential zone at (6..7, 6..7).
    const map = src.getMap();
    map.setTile(4, 4, createTile(4, 4, TileType.ROAD));
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        map.setTile(6 + dx, 6 + dy, createTile(6 + dx, 6 + dy, TileType.ZONE_RESIDENTIAL));
      }
    }

    // 2x2 building straddling the residential cells.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [
        { x: 6, y: 6 },
        { x: 7, y: 6 },
        { x: 6, y: 7 },
        { x: 7, y: 7 },
      ],
      anchor: { x: 6, y: 6 },
      level: 3,
      density: 1,
      age: 4,
    });

    src.setMoney(1234);
    src.setElapsedDays(7);

    const json = serializeWorld(src);

    const dst = new World(8, 8, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);

    // Tile types preserved.
    expect(dst.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
    expect(dst.getMap().getTile(4, 4)?.type).toBe(TileType.ROAD);
    expect(dst.getMap().getTile(6, 6)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(dst.getMap().getTile(7, 7)?.type).toBe(TileType.ZONE_RESIDENTIAL);

    // Elevations preserved.
    expect(dst.getTerrain().getTileElevation(0, 0)).toBe(0);
    expect(dst.getTerrain().getTileElevation(4, 4)).toBe(2);
    expect(dst.getTerrain().getTileElevation(6, 6)).toBe(3);
    expect(dst.getTerrain().getTileElevation(7, 7)).toBe(3);

    // Building preserved.
    const buildings = dst.getMap().getBuildings().getAllBuildings();
    expect(buildings.length).toBe(1);
    expect(buildings[0].type).toBe('residential');
    expect(buildings[0].level).toBe(3);
    expect(buildings[0].density).toBe(1);
    expect(buildings[0].age).toBe(4);
    expect(buildings[0].footprint).toHaveLength(4);

    // Scalars preserved.
    expect(dst.getMoney()).toBe(1234);
    expect(dst.getElapsedDays()).toBe(7);
  });

  it('byte-equal save → load → save round-trip (deterministic)', () => {
    const src = new World(4, 4, { regenerate: false });
    src.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_COMMERCIAL));
    src.getMap().getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
    });
    const json1 = serializeWorld(src);
    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, json1)).toBe(true);
    const json2 = serializeWorld(dst);
    expect(json2).toBe(json1);
  });
});

describe('v7 envelope — version rejection', () => {
  function makeOtherVersionJson(v: unknown): string {
    return JSON.stringify({
      v,
      w: 4,
      h: 4,
      t: Array(16).fill(TileType.GRASS),
      l: Array(16).fill(0),
      m: 500,
      d: 0,
      b: [],
      terrain: {
        width: 4,
        height: 4,
        mode: 'tile-step',
        tileElevations: Array.from({ length: 4 }, () => new Array<number>(4).fill(1)),
        baseTiles: Array.from({ length: 4 }, () => new Array<string>(4).fill('grass')),
      },
    });
  }

  for (const badVersion of [6, 5, 4, 3, 2, 1, 0, -1, 99, 'foo']) {
    it(`rejects v: ${JSON.stringify(badVersion)}`, () => {
      const world = new World(4, 4, { regenerate: false });
      const beforeMoney = world.getMoney();
      expect(deserializeWorldInto(world, makeOtherVersionJson(badVersion))).toBe(false);
      expect(world.getMoney()).toBe(beforeMoney);
    });
  }

  it('rejects malformed JSON', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(world, 'not json{')).toBe(false);
  });

  it('rejects null payload', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(world, 'null')).toBe(false);
  });

  it('rejects array payload', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(world, '[]')).toBe(false);
  });

  it('rejects empty object (no v)', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(world, '{}')).toBe(false);
  });
});

describe("v7 envelope — t[] containing 'water' (raw string)", () => {
  it("rejects a t[] entry of 'water'", () => {
    const world = new World(4, 4, { regenerate: false });
    // Construct the raw string so the 'water' literal survives even after the
    // TileType enum no longer has a WATER member.
    const tiles = Array(16).fill('grass');
    tiles[0] = 'water';
    const json = JSON.stringify({
      v: 7,
      w: 4,
      h: 4,
      t: tiles,
      l: Array(16).fill(0),
      m: 0,
      d: 0,
      b: [],
      terrain: {
        width: 4,
        height: 4,
        mode: 'tile-step',
        tileElevations: Array.from({ length: 4 }, () => new Array<number>(4).fill(1)),
        baseTiles: Array.from({ length: 4 }, () => new Array<string>(4).fill('grass')),
      },
    });
    expect(deserializeWorldInto(world, json)).toBe(false);
  });
});

describe('v7 envelope — coherence rejection', () => {
  function makeCoherencePayload(opts: {
    tileType: TileType;
    waterAt: [number, number];
    building?: {
      type: string;
      foot: [number, number][];
      anc: [number, number];
    };
  }): string {
    const W = 4;
    const H = 4;
    const tiles = Array(W * H).fill(TileType.GRASS) as TileType[];
    const [wx, wy] = opts.waterAt;
    tiles[wy * W + wx] = opts.tileType;
    const elevations = Array.from({ length: H }, () => new Array<number>(W).fill(1));
    elevations[wy][wx] = 0; // sea-level cell

    const b: unknown[] = [];
    if (opts.building) {
      b.push({
        id: 0,
        type: opts.building.type,
        foot: opts.building.foot,
        anc: opts.building.anc,
        lvl: 0,
        den: 0,
        age: 0,
      });
    }

    return JSON.stringify({
      v: 7,
      w: W,
      h: H,
      t: tiles,
      l: Array(W * H).fill(0),
      m: 0,
      d: 0,
      b,
      terrain: {
        width: W,
        height: H,
        mode: 'tile-step',
        tileElevations: elevations,
        baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
      },
    });
  }

  it('rejects: elev <= SEA_LEVEL with t[] = ROAD (type-coherence)', () => {
    const world = new World(4, 4, { regenerate: false });
    const beforeMoney = world.getMoney();
    const json = makeCoherencePayload({ tileType: TileType.ROAD, waterAt: [3, 3] });
    expect(deserializeWorldInto(world, json)).toBe(false);
    expect(world.getMoney()).toBe(beforeMoney);
    // World state unchanged.
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.GRASS);
  });

  it('rejects: elev <= SEA_LEVEL with t[] = ZONE_RESIDENTIAL + matching building footprint (building-coherence)', () => {
    const world = new World(4, 4, { regenerate: false });
    const beforeMoney = world.getMoney();
    // t[] is ZONE_RESIDENTIAL (matches the building type), so building-staging
    // and tile validation both pass. The coherence pass then rejects the
    // footprint cell because its elevation is <= SEA_LEVEL.
    const json = makeCoherencePayload({
      tileType: TileType.ZONE_RESIDENTIAL,
      waterAt: [3, 3],
      building: {
        type: 'residential',
        foot: [[3, 3]],
        anc: [3, 3],
      },
    });
    expect(deserializeWorldInto(world, json)).toBe(false);
    expect(world.getMoney()).toBe(beforeMoney);
    expect(world.getMap().getBuildings().getAllBuildings().length).toBe(0);
  });

  it('accepts boundary: elev = SEA_LEVEL with t[] = GRASS and no building covers it', () => {
    const W = 4;
    const H = 4;
    const elevations = Array.from({ length: H }, () => new Array<number>(W).fill(1));
    elevations[3][3] = SEA_LEVEL;
    const json = JSON.stringify({
      v: 7,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 0,
      d: 0,
      b: [],
      terrain: {
        width: W,
        height: H,
        mode: 'tile-step',
        tileElevations: elevations,
        baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
      },
    });
    const world = new World(W, H, { regenerate: false });
    expect(deserializeWorldInto(world, json)).toBe(true);
    expect(world.getTerrain().getTileElevation(3, 3)).toBe(SEA_LEVEL);
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.GRASS);
  });
});

describe('v7 envelope — dim mismatch', () => {
  it('rejects payload w=32 against a 64×64 world', () => {
    const world = new World(64, 64, { regenerate: false });
    const beforeMoney = world.getMoney();
    const json = JSON.stringify({
      v: 7,
      w: 32,
      h: 32,
      t: Array(32 * 32).fill(TileType.GRASS),
      l: Array(32 * 32).fill(0),
      m: 0,
      d: 0,
      b: [],
      terrain: {
        width: 32,
        height: 32,
        mode: 'tile-step',
        tileElevations: Array.from({ length: 32 }, () => new Array<number>(32).fill(1)),
        baseTiles: Array.from({ length: 32 }, () => new Array<string>(32).fill('grass')),
      },
    });
    expect(deserializeWorldInto(world, json)).toBe(false);
    expect(world.getMoney()).toBe(beforeMoney);
  });
});

// ---------------------------------------------------------------------------
// v7 envelope — m / d / t / l / b / terrain validation (per-field rejections)
// ---------------------------------------------------------------------------

describe('v7 envelope — m / d / l validation', () => {
  function makeV7(overrides: Record<string, unknown> = {}): string {
    const W = 4;
    const H = 4;
    return JSON.stringify({
      v: 7,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 500,
      d: 0,
      b: [],
      terrain: {
        width: W,
        height: H,
        mode: 'tile-step',
        tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(1)),
        baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
      },
      ...overrides,
    });
  }

  it('rejects: m missing', () => {
    const world = new World(4, 4, { regenerate: false });
    const json = makeV7();
    const obj = JSON.parse(json);
    delete obj.m;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
  });

  it('rejects: m fractional', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(world, makeV7({ m: 12.5 }))).toBe(false);
  });

  it('rejects: m negative', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(world, makeV7({ m: -1 }))).toBe(false);
  });

  it('rejects: d missing', () => {
    const world = new World(4, 4, { regenerate: false });
    const json = makeV7();
    const obj = JSON.parse(json);
    delete obj.d;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
  });

  it('rejects: d negative', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(world, makeV7({ d: -3 }))).toBe(false);
  });

  it('rejects: l with non-zero level on a non-zone tile', () => {
    const world = new World(4, 4, { regenerate: false });
    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ROAD;
    const l = Array(16).fill(0);
    l[0] = 1; // ROAD with level 1 — invalid
    expect(deserializeWorldInto(world, makeV7({ t: tiles, l }))).toBe(false);
  });

  it('rejects: l with negative level on a zone tile', () => {
    const world = new World(4, 4, { regenerate: false });
    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;
    const l = Array(16).fill(0);
    l[0] = -1;
    expect(deserializeWorldInto(world, makeV7({ t: tiles, l }))).toBe(false);
  });

  it('rejects: l fractional on a zone tile', () => {
    const world = new World(4, 4, { regenerate: false });
    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;
    const l = Array(16).fill(0);
    l[0] = 1.5;
    expect(deserializeWorldInto(world, makeV7({ t: tiles, l }))).toBe(false);
  });

  it('rejects: t[] containing an unknown type', () => {
    const world = new World(4, 4, { regenerate: false });
    const tiles = Array(16).fill('lava');
    expect(deserializeWorldInto(world, makeV7({ t: tiles }))).toBe(false);
  });
});

describe('v7 envelope — b[] validation', () => {
  function makeV7WithBuilding(b: unknown): string {
    const W = 4;
    const H = 4;
    const tiles = Array(W * H).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;
    return JSON.stringify({
      v: 7,
      w: W,
      h: H,
      t: tiles,
      l: Array(W * H).fill(0),
      m: 0,
      d: 0,
      b: [b],
      terrain: {
        width: W,
        height: H,
        mode: 'tile-step',
        tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(1)),
        baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
      },
    });
  }

  it('rejects: building type mismatch with tile zone type', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(
      deserializeWorldInto(
        world,
        makeV7WithBuilding({
          id: 0,
          type: 'commercial', // tile is ZONE_RESIDENTIAL
          foot: [[0, 0]],
          anc: [0, 0],
          lvl: 0,
          den: 0,
          age: 0,
        })
      )
    ).toBe(false);
  });

  it('rejects: anchor not in footprint', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(
      deserializeWorldInto(
        world,
        makeV7WithBuilding({
          id: 0,
          type: 'residential',
          foot: [[0, 0]],
          anc: [1, 1],
          lvl: 0,
          den: 0,
          age: 0,
        })
      )
    ).toBe(false);
  });

  it('rejects: empty footprint', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(
      deserializeWorldInto(
        world,
        makeV7WithBuilding({
          id: 0,
          type: 'residential',
          foot: [],
          anc: [0, 0],
          lvl: 0,
          den: 0,
          age: 0,
        })
      )
    ).toBe(false);
  });

  it('rejects: footprint cell out of bounds', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(
      deserializeWorldInto(
        world,
        makeV7WithBuilding({
          id: 0,
          type: 'residential',
          foot: [[10, 10]],
          anc: [10, 10],
          lvl: 0,
          den: 0,
          age: 0,
        })
      )
    ).toBe(false);
  });

  it('rejects: density not in {0, 1, 2}', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(
      deserializeWorldInto(
        world,
        makeV7WithBuilding({
          id: 0,
          type: 'residential',
          foot: [[0, 0]],
          anc: [0, 0],
          lvl: 0,
          den: 3,
          age: 0,
        })
      )
    ).toBe(false);
  });

  it('round-trip preserves non-zero building ids', () => {
    const src = new World(4, 4, { regenerate: false });
    const map = src.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));

    // Consume id=0 then remove it so the next ids skip 0.
    const tmp = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: 0,
    });
    expect(tmp?.id).toBe(0);
    map.getBuildings().removeBuilding(0);
    const b1 = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
    });
    const b2 = map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 1, y: 0 }],
      anchor: { x: 1, y: 0 },
      level: 2,
      density: 0,
      age: 0,
    });
    expect(b1?.id).toBe(1);
    expect(b2?.id).toBe(2);

    const json = serializeWorld(src);
    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);
    const loaded = [...dst.getMap().getBuildings().getAllBuildings()].sort((a, b) => a.id - b.id);
    expect(loaded.map((b) => b.id)).toEqual([1, 2]);

    // setNextIdFloor respected: next added building gets id=3.
    dst.getMap().setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL));
    const newB = dst.getMap().getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 2, y: 0 }],
      anchor: { x: 2, y: 0 },
      level: 0,
      density: 0,
      age: 0,
    });
    expect(newB?.id).toBe(3);
  });
});

describe('v7 envelope — terrain validation', () => {
  function makeV7WithTerrain(terrain: unknown): string {
    const W = 4;
    const H = 4;
    return JSON.stringify({
      v: 7,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 0,
      d: 0,
      b: [],
      terrain,
    });
  }

  it("rejects: terrain.mode 'vertex-smooth'", () => {
    const world = new World(4, 4, { regenerate: false });
    expect(
      deserializeWorldInto(
        world,
        makeV7WithTerrain({
          width: 4,
          height: 4,
          mode: 'vertex-smooth',
          tileElevations: Array.from({ length: 4 }, () => new Array<number>(4).fill(1)),
          baseTiles: Array.from({ length: 4 }, () => new Array<string>(4).fill('grass')),
        })
      )
    ).toBe(false);
  });

  it('rejects: tileElevations[0][0] fractional', () => {
    const world = new World(4, 4, { regenerate: false });
    const elev = Array.from({ length: 4 }, () => new Array<number>(4).fill(1));
    elev[0][0] = 1.5;
    expect(
      deserializeWorldInto(
        world,
        makeV7WithTerrain({
          width: 4,
          height: 4,
          mode: 'tile-step',
          tileElevations: elev,
          baseTiles: Array.from({ length: 4 }, () => new Array<string>(4).fill('grass')),
        })
      )
    ).toBe(false);
  });

  it('rejects: tileElevations entry > MAX_ELEVATION', () => {
    const world = new World(4, 4, { regenerate: false });
    const elev = Array.from({ length: 4 }, () => new Array<number>(4).fill(1));
    elev[0][0] = MAX_ELEVATION + 1;
    expect(
      deserializeWorldInto(
        world,
        makeV7WithTerrain({
          width: 4,
          height: 4,
          mode: 'tile-step',
          tileElevations: elev,
          baseTiles: Array.from({ length: 4 }, () => new Array<string>(4).fill('grass')),
        })
      )
    ).toBe(false);
  });

  it('rejects: terrain width mismatches world width', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(
      deserializeWorldInto(
        world,
        makeV7WithTerrain({
          width: 5,
          height: 4,
          mode: 'tile-step',
          tileElevations: Array.from({ length: 4 }, () => new Array<number>(5).fill(1)),
          baseTiles: Array.from({ length: 4 }, () => new Array<string>(5).fill('grass')),
        })
      )
    ).toBe(false);
  });

  it('rejects: vertexHeights reserved field present', () => {
    const world = new World(4, 4, { regenerate: false });
    expect(
      deserializeWorldInto(
        world,
        makeV7WithTerrain({
          width: 4,
          height: 4,
          mode: 'tile-step',
          tileElevations: Array.from({ length: 4 }, () => new Array<number>(4).fill(1)),
          baseTiles: Array.from({ length: 4 }, () => new Array<string>(4).fill('grass')),
          vertexHeights: [],
        })
      )
    ).toBe(false);
  });

  it('rejects: baseTiles[0][0] != grass', () => {
    const world = new World(4, 4, { regenerate: false });
    const base = Array.from({ length: 4 }, () => new Array<string>(4).fill('grass'));
    base[0][0] = 'sand';
    expect(
      deserializeWorldInto(
        world,
        makeV7WithTerrain({
          width: 4,
          height: 4,
          mode: 'tile-step',
          tileElevations: Array.from({ length: 4 }, () => new Array<number>(4).fill(1)),
          baseTiles: base,
        })
      )
    ).toBe(false);
  });

  it('round-trip: toJSON omits vertexHeights and waterLevel', () => {
    const src = new World(4, 4, { regenerate: false });
    const parsed = JSON.parse(serializeWorld(src)) as { terrain: Record<string, unknown> };
    expect('vertexHeights' in parsed.terrain).toBe(false);
    expect('waterLevel' in parsed.terrain).toBe(false);
  });
});

describe('v7 envelope — all-or-nothing on rejection', () => {
  it('rejected coherence does not mutate any world state', () => {
    const world = new World(4, 4, { regenerate: false });
    world.setMoney(9999);
    world.setElapsedDays(5);
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.ROAD));
    world.getTerrain().unsafeSetElevation(2, 2, 3);
    const beforeMoney = world.getMoney();
    const beforeDays = world.getElapsedDays();
    const beforeElev = world.getTerrain().getTileElevation(2, 2);
    const beforeRev = world.getTerrainRevision();

    // Payload with coherence violation: cell (3, 3) at elev 0 but t = ROAD.
    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[3 * 4 + 3] = TileType.ROAD;
    const elevations = Array.from({ length: 4 }, () => new Array<number>(4).fill(1));
    elevations[3][3] = 0;
    const json = JSON.stringify({
      v: 7,
      w: 4,
      h: 4,
      t: tiles,
      l: Array(16).fill(0),
      m: 0,
      d: 0,
      b: [],
      terrain: {
        width: 4,
        height: 4,
        mode: 'tile-step',
        tileElevations: elevations,
        baseTiles: Array.from({ length: 4 }, () => new Array<string>(4).fill('grass')),
      },
    });
    expect(deserializeWorldInto(world, json)).toBe(false);

    expect(world.getMoney()).toBe(beforeMoney);
    expect(world.getElapsedDays()).toBe(beforeDays);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.ROAD);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(beforeElev);
    expect(world.getTerrainRevision()).toBe(beforeRev);
  });
});
