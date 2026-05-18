import { describe, it, expect } from 'vitest';
import { GameMap } from './Map';
import { TileType, createTile } from './Tile';
import { World, ZONE_MAX_LEVEL, STARTING_FUNDS } from './World';
import {
  serializeMap,
  deserializeMapInto,
  serializeWorld,
  deserializeWorldInto,
  SAVE_VERSION,
  WORLD_SAVE_VERSION,
} from './mapSerialization';

describe('serializeMap / deserializeMapInto', () => {
  it('round-trips tile types onto a same-sized map', () => {
    const src = new GameMap(4, 3);
    src.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    src.setTile(3, 2, createTile(3, 2, TileType.WATER));

    const dst = new GameMap(4, 3);
    expect(deserializeMapInto(dst, serializeMap(src))).toBe(true);

    expect(dst.getTile(1, 0)?.type).toBe(TileType.ROAD);
    expect(dst.getTile(3, 2)?.type).toBe(TileType.WATER);
    expect(dst.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('rejects a payload whose dimensions do not match the map', () => {
    const map = new GameMap(2, 2);
    const src = new GameMap(3, 3);
    expect(deserializeMapInto(map, serializeMap(src))).toBe(false);
  });

  it('rejects a payload with an unknown tile type', () => {
    const map = new GameMap(2, 1);
    const bad = JSON.stringify({ v: SAVE_VERSION, w: 2, h: 1, t: ['lava', 'grass'], l: [0, 0] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('rejects malformed JSON', () => {
    const map = new GameMap(2, 2);
    expect(deserializeMapInto(map, 'not json{')).toBe(false);
  });

  it('round-trips ZONE_RESIDENTIAL, ZONE_COMMERCIAL, and ZONE_INDUSTRIAL', () => {
    const src = new GameMap(4, 4);
    src.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    src.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    src.setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL));

    const dst = new GameMap(4, 4);
    expect(deserializeMapInto(dst, serializeMap(src))).toBe(true);

    expect(dst.getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(dst.getTile(1, 0)?.type).toBe(TileType.ZONE_COMMERCIAL);
    expect(dst.getTile(2, 0)?.type).toBe(TileType.ZONE_INDUSTRIAL);
  });

  it('rejects a payload with an obsolete tile type string and leaves the map unmutated', () => {
    const w = 3;
    const h = 2;
    const map = new GameMap(w, h);
    const stalePayload = JSON.stringify({
      v: SAVE_VERSION,
      w,
      h,
      t: [TileType.GRASS, TileType.GRASS, 'building', TileType.GRASS, TileType.GRASS, TileType.GRASS],
      l: [0, 0, 0, 0, 0, 0],
    });

    expect(deserializeMapInto(map, stalePayload)).toBe(false);

    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        expect(map.getTile(x, y)?.type).toBe(TileType.GRASS);
      }
    }
  });

  // --- v2 level round-trip ---

  it('(v2, valid l) round-trip: zone tiles at non-zero levels survive serialize/deserialize', () => {
    const src = new GameMap(3, 2);
    src.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 3));
    src.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL, ZONE_MAX_LEVEL));
    src.setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL, 1));
    src.setTile(0, 1, createTile(0, 1, TileType.ROAD, 0));

    const json = serializeMap(src);
    const parsed = JSON.parse(json);
    expect(parsed.v).toBe(2);
    expect(Array.isArray(parsed.l)).toBe(true);
    expect(parsed.l.length).toBe(3 * 2);

    const dst = new GameMap(3, 2);
    expect(deserializeMapInto(dst, json)).toBe(true);

    expect(dst.getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(dst.getTile(0, 0)?.level).toBe(3);
    expect(dst.getTile(1, 0)?.type).toBe(TileType.ZONE_COMMERCIAL);
    expect(dst.getTile(1, 0)?.level).toBe(ZONE_MAX_LEVEL);
    expect(dst.getTile(2, 0)?.type).toBe(TileType.ZONE_INDUSTRIAL);
    expect(dst.getTile(2, 0)?.level).toBe(1);
    expect(dst.getTile(0, 1)?.level).toBe(0);
  });

  // --- v1 legacy ---

  it('(v1, no l) legacy accept: loads with all levels 0', () => {
    const w = 2;
    const h = 2;
    const map = new GameMap(w, h);
    const v1payload = JSON.stringify({
      v: 1,
      w,
      h,
      t: [TileType.ROAD, TileType.GRASS, TileType.ZONE_RESIDENTIAL, TileType.WATER],
    });

    expect(deserializeMapInto(map, v1payload)).toBe(true);

    expect(map.getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(map.getTile(0, 0)?.level).toBe(0);
    expect(map.getTile(0, 1)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(map.getTile(0, 1)?.level).toBe(0);
  });

  it('(v1, l present as array) rejects; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 1, w, h, t: [TileType.GRASS, TileType.GRASS], l: [0, 0] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
    expect(map.getTile(1, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v1, l present as null) rejects; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 1, w, h, t: [TileType.GRASS, TileType.GRASS], l: null });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  // --- v2 l-field rejection cases ---

  it('(v2, l missing) rejects; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 2, w, h, t: [TileType.GRASS, TileType.GRASS] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v2, l not array) rejects; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 2, w, h, t: [TileType.GRASS, TileType.GRASS], l: 'bad' });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v2, l.length !== w*h) rejects; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 2, w, h, t: [TileType.GRASS, TileType.GRASS], l: [0] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v2, non-zone tile l[i] > 0, e.g. ROAD) rejects; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 2, w, h, t: [TileType.ROAD, TileType.GRASS], l: [1, 0] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v2, non-zone WATER tile l[i] > 0) rejects; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 2, w, h, t: [TileType.WATER, TileType.GRASS], l: [2, 0] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v2, zone tile level > ZONE_MAX_LEVEL) rejects; map untouched', () => {
    const w = 1;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({
      v: 2,
      w,
      h,
      t: [TileType.ZONE_RESIDENTIAL],
      l: [ZONE_MAX_LEVEL + 1],
    });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v2, zone tile level negative) rejects; map untouched', () => {
    const w = 1;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 2, w, h, t: [TileType.ZONE_COMMERCIAL], l: [-1] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v2, zone tile level non-integer) rejects; map untouched', () => {
    const w = 1;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 2, w, h, t: [TileType.ZONE_INDUSTRIAL], l: [1.5] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  // --- Unsupported versions ---

  it('(v:3) rejects with otherwise-valid payload; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 3, w, h, t: [TileType.GRASS, TileType.GRASS], l: [0, 0] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v:999) rejects with otherwise-valid payload; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 999, w, h, t: [TileType.GRASS, TileType.GRASS], l: [0, 0] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v:0) rejects; map untouched', () => {
    const w = 2;
    const h = 1;
    const map = new GameMap(w, h);
    const bad = JSON.stringify({ v: 0, w, h, t: [TileType.GRASS, TileType.GRASS], l: [0, 0] });
    expect(deserializeMapInto(map, bad)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });
});

// ---------------------------------------------------------------------------
// World-envelope API: serializeWorld / deserializeWorldInto
// ---------------------------------------------------------------------------

describe('serializeWorld / deserializeWorldInto', () => {
  // Helper: build a minimal valid v3 JSON for a 2x1 map.
  function makeV3(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      v: 3,
      w: 2,
      h: 1,
      t: [TileType.GRASS, TileType.GRASS],
      l: [0, 0],
      m: 500,
      ...overrides,
    });
  }

  it('round-trips money: serialize then deserializeWorldInto restores map + money, v === WORLD_SAVE_VERSION', () => {
    const src = new World(3, 2);
    src.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    src.trySpend(3000);
    src.earn(250);
    const expectedMoney = src.getMoney();

    const json = serializeWorld(src);
    const parsed = JSON.parse(json);
    expect(parsed.v).toBe(WORLD_SAVE_VERSION);

    const dst = new World(3, 2);
    expect(deserializeWorldInto(dst, json)).toBe(true);
    expect(dst.getMoney()).toBe(expectedMoney);
    expect(dst.getMap().getTile(1, 0)?.type).toBe(TileType.ROAD);
    expect(dst.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('split-contract lock: serializeWorld (v3) JSON accepted by deserializeWorldInto, rejected by deserializeMapInto', () => {
    const world = new World(2, 2);
    const json = serializeWorld(world);

    const fresh = new World(2, 2);
    expect(deserializeWorldInto(fresh, json)).toBe(true);

    const map = new GameMap(2, 2);
    expect(deserializeMapInto(map, json)).toBe(false);
  });

  // --- Shape-guard ---

  it('shape-guard: "null" → false, world untouched', () => {
    const world = new World(2, 2);
    const before = world.getMoney();
    expect(deserializeWorldInto(world, 'null')).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('shape-guard: "[]" → false, world untouched', () => {
    const world = new World(2, 2);
    const before = world.getMoney();
    expect(deserializeWorldInto(world, '[]')).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('shape-guard: "{}" → false (no v field), world untouched', () => {
    const world = new World(2, 2);
    const before = world.getMoney();
    expect(deserializeWorldInto(world, '{}')).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  // --- v1 legacy ---

  it('(v1, no m, no l) legacy: map loads with all levels 0, money === STARTING_FUNDS', () => {
    const w = 2;
    const h = 2;
    const world = new World(w, h);
    const payload = JSON.stringify({
      v: 1,
      w,
      h,
      t: [TileType.ROAD, TileType.GRASS, TileType.ZONE_RESIDENTIAL, TileType.WATER],
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(world.getMap().getTile(0, 0)?.level).toBe(0);
  });

  it('(v1, stray m:{v:1,...,m:0}) → reject, world untouched', () => {
    const w = 2;
    const h = 1;
    const world = new World(w, h);
    const before = world.getMoney();
    const payload = JSON.stringify({
      v: 1,
      w,
      h,
      t: [TileType.GRASS, TileType.GRASS],
      m: 0,
    });
    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  // --- v2 backward-compat ---

  it('(v2, valid l, no m) → map loads, money === STARTING_FUNDS', () => {
    const w = 2;
    const h = 1;
    const world = new World(w, h);
    const payload = JSON.stringify({
      v: 2,
      w,
      h,
      t: [TileType.ROAD, TileType.GRASS],
      l: [0, 0],
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
  });

  it('(v2, valid l, stray m) → accepted, m ignored, money === STARTING_FUNDS', () => {
    const w = 2;
    const h = 1;
    const world = new World(w, h);
    const payload = JSON.stringify({
      v: 2,
      w,
      h,
      t: [TileType.ROAD, TileType.GRASS],
      l: [0, 0],
      m: 9999,
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(STARTING_FUNDS);
  });

  // --- v3 valid ---

  it('(v3, valid l + whole ≥0 m) → map + money loaded', () => {
    const w = 2;
    const h = 1;
    const world = new World(w, h);
    const payload = JSON.stringify({
      v: 3,
      w,
      h,
      t: [TileType.ZONE_RESIDENTIAL, TileType.ROAD],
      l: [2, 0],
      m: 750,
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(750);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(world.getMap().getTile(0, 0)?.level).toBe(2);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.ROAD);
  });

  // --- v3 m rejection cases ---

  it('(v3, m missing) → reject; money unchanged; map not written', () => {
    const world = new World(2, 1);
    const before = world.getMoney();
    const payload = JSON.stringify({ v: 3, w: 2, h: 1, t: [TileType.GRASS, TileType.GRASS], l: [0, 0] });
    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v3, m:null) → reject', () => {
    const world = new World(2, 1);
    const before = world.getMoney();
    expect(deserializeWorldInto(world, makeV3({ m: null }))).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('(v3, m non-number "x") → reject', () => {
    const world = new World(2, 1);
    const before = world.getMoney();
    expect(deserializeWorldInto(world, makeV3({ m: 'x' }))).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('(v3, m overflow literal 1e999 → Infinity) → reject', () => {
    const world = new World(2, 1);
    const before = world.getMoney();
    // JSON.parse("1e999") → Infinity in JS; Number.isInteger(Infinity) === false.
    const raw = '{"v":3,"w":2,"h":1,"t":["grass","grass"],"l":[0,0],"m":1e999}';
    expect(deserializeWorldInto(world, raw)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('(v3, m negative) → reject', () => {
    const world = new World(2, 1);
    const before = world.getMoney();
    expect(deserializeWorldInto(world, makeV3({ m: -1 }))).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('(v3, m fractional 12.5) → reject', () => {
    const world = new World(2, 1);
    const before = world.getMoney();
    expect(deserializeWorldInto(world, makeV3({ m: 12.5 }))).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  // --- all-or-nothing across map + money ---

  it('(v3, valid m but invalid map l: non-zone ROAD level≠0) → reject; money unchanged', () => {
    const world = new World(2, 1);
    const before = world.getMoney();
    // ROAD tile with level=1 is invalid per map rules.
    const payload = JSON.stringify({
      v: 3,
      w: 2,
      h: 1,
      t: [TileType.ROAD, TileType.GRASS],
      l: [1, 0],
      m: 500,
    });
    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  // --- unsupported envelope version ---

  it('(envelope v:4) → reject', () => {
    const world = new World(2, 1);
    const before = world.getMoney();
    const payload = JSON.stringify({
      v: 4,
      w: 2,
      h: 1,
      t: [TileType.GRASS, TileType.GRASS],
      l: [0, 0],
      m: 0,
    });
    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });
});
