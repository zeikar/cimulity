import { describe, it, expect, vi } from 'vitest';
import { GameMap } from './Map';
import { TileType, createTile } from './Tile';
import { World, ZONE_MAX_LEVEL, STARTING_FUNDS, DAYS_PER_MONTH } from './World';
import {
  serializeMap,
  deserializeMapInto,
  serializeWorld,
  deserializeWorldInto,
  SAVE_VERSION,
  WORLD_SAVE_VERSION,
} from './mapSerialization';
import { BuildingMap } from './Building';
import { MAX_ELEVATION } from './Terrain';
import * as terrainGeneratorModule from './terrainGenerator';

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

  // Helper: build a minimal valid v4 JSON for a 2x1 map (d defaults to 0).
  function makeV4(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      v: 4,
      w: 2,
      h: 1,
      t: [TileType.GRASS, TileType.GRASS],
      l: [0, 0],
      m: 500,
      d: 0,
      ...overrides,
    });
  }

  it('round-trips money: serialize then deserializeWorldInto restores map + money, v === WORLD_SAVE_VERSION', () => {
    const src = new World(3, 2, { regenerate: false });
    src.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    src.trySpend(3000);
    src.earn(250);
    const expectedMoney = src.getMoney();

    const json = serializeWorld(src);
    const parsed = JSON.parse(json);
    expect(parsed.v).toBe(WORLD_SAVE_VERSION);

    const dst = new World(3, 2, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);
    expect(dst.getMoney()).toBe(expectedMoney);
    expect(dst.getMap().getTile(1, 0)?.type).toBe(TileType.ROAD);
    expect(dst.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  // --- v4 calendar round-trip ---

  it('(v4) round-trip: serialize a ticked World → v === WORLD_SAVE_VERSION, d present, no tk; restores map + money + days + tick + date', () => {
    const src = new World(3, 2, { regenerate: false });
    // Road-adjacent zone so ticks both spend nothing and exercise growth.
    src.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    src.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 0));
    src.trySpend(3000);
    src.earn(250);

    // Advance the calendar by a known number of real tick() calls.
    const TICKS = 17;
    for (let i = 0; i < TICKS; i++) src.tick();

    const expectedMoney = src.getMoney();
    const expectedDays = src.getElapsedDays();
    const expectedTick = src.getTick();
    const expectedDate = src.getDate();

    const json = serializeWorld(src);
    const parsed = JSON.parse(json);
    expect(parsed.v).toBe(WORLD_SAVE_VERSION);
    expect(parsed.v).toBe(6);
    expect(parsed.d).toBe(expectedDays);
    expect('tk' in parsed).toBe(false);

    const dst = new World(3, 2, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);
    expect(dst.getMoney()).toBe(expectedMoney);
    expect(dst.getElapsedDays()).toBe(expectedDays);
    // setElapsedDays restores tickCount too — both must equal the source.
    expect(dst.getTick()).toBe(expectedTick);
    expect(dst.getElapsedDays()).toBe(dst.getTick());
    expect(dst.getDate()).toEqual(expectedDate);
    expect(dst.getMap().getTile(1, 0)?.type).toBe(TileType.ROAD);
    expect(dst.getMap().getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
  });

  it('(v4) serializeWorld after real tick() emits d reflecting the ticked count and round-trips with getTick() === getElapsedDays()', () => {
    const src = new World(2, 1, { regenerate: false });
    const TICKS = DAYS_PER_MONTH + 5;
    for (let i = 0; i < TICKS; i++) src.tick();

    const json = serializeWorld(src);
    const parsed = JSON.parse(json);
    expect(parsed.d).toBe(TICKS);
    expect(parsed.d).toBe(src.getElapsedDays());

    const dst = new World(2, 1, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);
    expect(dst.getElapsedDays()).toBe(TICKS);
    expect(dst.getTick()).toBe(TICKS);
    expect(dst.getTick()).toBe(dst.getElapsedDays());
    expect(dst.getDate()).toEqual(src.getDate());
  });

  it('split-contract lock: serializeWorld (v4) JSON accepted by deserializeWorldInto, rejected by deserializeMapInto', () => {
    const world = new World(2, 2, { regenerate: false });
    const json = serializeWorld(world);

    const fresh = new World(2, 2, { regenerate: false });
    expect(deserializeWorldInto(fresh, json)).toBe(true);

    const map = new GameMap(2, 2);
    expect(deserializeMapInto(map, json)).toBe(false);
  });

  // --- Shape-guard ---

  it('shape-guard: "null" → false, world untouched', () => {
    const world = new World(2, 2, { regenerate: false });
    const before = world.getMoney();
    expect(deserializeWorldInto(world, 'null')).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('shape-guard: "[]" → false, world untouched', () => {
    const world = new World(2, 2, { regenerate: false });
    const before = world.getMoney();
    expect(deserializeWorldInto(world, '[]')).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('shape-guard: "{}" → false (no v field), world untouched', () => {
    const world = new World(2, 2, { regenerate: false });
    const before = world.getMoney();
    expect(deserializeWorldInto(world, '{}')).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  // --- v1 legacy ---

  it('(v1, no m, no l) legacy: map loads with all levels 0, money === STARTING_FUNDS', () => {
    const w = 2;
    const h = 2;
    const world = new World(w, h, { regenerate: false });
    const payload = JSON.stringify({
      v: 1,
      w,
      h,
      t: [TileType.ROAD, TileType.GRASS, TileType.ZONE_RESIDENTIAL, TileType.WATER],
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(world.getMap().getTile(0, 0)?.level).toBe(0);
  });

  it('(v1, stray m:{v:1,...,m:0}) → reject, world untouched', () => {
    const w = 2;
    const h = 1;
    const world = new World(w, h, { regenerate: false });
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
    const world = new World(w, h, { regenerate: false });
    const payload = JSON.stringify({
      v: 2,
      w,
      h,
      t: [TileType.ROAD, TileType.GRASS],
      l: [0, 0],
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(STARTING_FUNDS);
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
  });

  it('(v2, valid l, stray m) → accepted, m ignored, money === STARTING_FUNDS', () => {
    const w = 2;
    const h = 1;
    const world = new World(w, h, { regenerate: false });
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
    const world = new World(w, h, { regenerate: false });
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
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(world.getMap().getTile(0, 0)?.level).toBe(2);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.ROAD);
  });

  it('(v3, valid l + m, stray d key) → accepted, d ignored, day/tick stay 0 (v3 has no calendar concept; lenient like v2 stray-m)', () => {
    const w = 2;
    const h = 1;
    const world = new World(w, h, { regenerate: false });
    const payload = JSON.stringify({
      v: 3,
      w,
      h,
      t: [TileType.GRASS, TileType.GRASS],
      l: [0, 0],
      m: 750,
      d: 99,
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(750);
    expect(world.getElapsedDays()).toBe(0);
    expect(world.getTick()).toBe(0);
    expect(world.getDate()).toEqual({ year: 1, month: 1, day: 1 });
  });

  // --- v3 m rejection cases ---

  it('(v3, m missing) → reject; money unchanged; map not written', () => {
    const world = new World(2, 1, { regenerate: false });
    const before = world.getMoney();
    const payload = JSON.stringify({ v: 3, w: 2, h: 1, t: [TileType.GRASS, TileType.GRASS], l: [0, 0] });
    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('(v3, m:null) → reject', () => {
    const world = new World(2, 1, { regenerate: false });
    const before = world.getMoney();
    expect(deserializeWorldInto(world, makeV3({ m: null }))).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('(v3, m non-number "x") → reject', () => {
    const world = new World(2, 1, { regenerate: false });
    const before = world.getMoney();
    expect(deserializeWorldInto(world, makeV3({ m: 'x' }))).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('(v3, m overflow literal 1e999 → Infinity) → reject', () => {
    const world = new World(2, 1, { regenerate: false });
    const before = world.getMoney();
    // JSON.parse("1e999") → Infinity in JS; Number.isInteger(Infinity) === false.
    const raw = '{"v":3,"w":2,"h":1,"t":["grass","grass"],"l":[0,0],"m":1e999}';
    expect(deserializeWorldInto(world, raw)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('(v3, m negative) → reject', () => {
    const world = new World(2, 1, { regenerate: false });
    const before = world.getMoney();
    expect(deserializeWorldInto(world, makeV3({ m: -1 }))).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  it('(v3, m fractional 12.5) → reject', () => {
    const world = new World(2, 1, { regenerate: false });
    const before = world.getMoney();
    expect(deserializeWorldInto(world, makeV3({ m: 12.5 }))).toBe(false);
    expect(world.getMoney()).toBe(before);
  });

  // --- all-or-nothing across map + money ---

  it('(v3, valid m but invalid map l: non-zone ROAD level≠0) → reject; money unchanged', () => {
    const world = new World(2, 1, { regenerate: false });
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

  // --- v4 valid ---

  it('(v4, valid l + m + d) → map + money + day + tick + date loaded', () => {
    const w = 2;
    const h = 1;
    const world = new World(w, h, { regenerate: false });
    const payload = JSON.stringify({
      v: 4,
      w,
      h,
      t: [TileType.ZONE_RESIDENTIAL, TileType.ROAD],
      l: [2, 0],
      m: 750,
      d: DAYS_PER_MONTH + 1,
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(750);
    expect(world.getElapsedDays()).toBe(DAYS_PER_MONTH + 1);
    expect(world.getTick()).toBe(DAYS_PER_MONTH + 1);
    expect(world.getDate()).toEqual({ year: 1, month: 2, day: 2 });
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(world.getMap().getTile(0, 0)?.level).toBe(2);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.ROAD);
  });

  // --- v4 d rejection cases (all-or-nothing: money AND map AND day AND tick unchanged) ---

  // Builds a v4 World with placed tiles + non-default money/day so we can assert nothing moved.
  function makeDirtyWorld(): { world: World; money: number; days: number; tick: number } {
    const world = new World(2, 1, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    world.setMoney(4321);
    world.setElapsedDays(7);
    return { world, money: world.getMoney(), days: world.getElapsedDays(), tick: world.getTick() };
  }

  function expectV4Reject(json: string): void {
    const { world, money, days, tick } = makeDirtyWorld();
    expect(deserializeWorldInto(world, json)).toBe(false);
    expect(world.getMoney()).toBe(money);
    expect(world.getElapsedDays()).toBe(days);
    expect(world.getTick()).toBe(tick);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
  }

  it('(v4, d missing) → reject; money/map/day/tick unchanged', () => {
    expectV4Reject(JSON.stringify({ v: 4, w: 2, h: 1, t: [TileType.GRASS, TileType.GRASS], l: [0, 0], m: 500 }));
  });

  it('(v4, d:null) → reject; money/map/day/tick unchanged', () => {
    expectV4Reject(makeV4({ d: null }));
  });

  it("(v4, d non-number 'x') → reject; money/map/day/tick unchanged", () => {
    expectV4Reject(makeV4({ d: 'x' }));
  });

  it('(v4, d overflow literal 1e999 → Infinity) → reject; money/map/day/tick unchanged', () => {
    // JSON.parse("1e999") → Infinity in JS; Number.isInteger(Infinity) === false.
    expectV4Reject('{"v":4,"w":2,"h":1,"t":["grass","grass"],"l":[0,0],"m":500,"d":1e999}');
  });

  it('(v4, d negative) → reject; money/map/day/tick unchanged', () => {
    expectV4Reject(makeV4({ d: -1 }));
  });

  it('(v4, d fractional 12.5) → reject; money/map/day/tick unchanged', () => {
    expectV4Reject(makeV4({ d: 12.5 }));
  });

  it('(v4, valid d but invalid m) → reject; money/map/day/tick unchanged', () => {
    expectV4Reject(makeV4({ m: -1, d: 5 }));
  });

  it('(v4, valid m/d but invalid map l: non-zone ROAD level≠0) → reject; money/map/day/tick unchanged', () => {
    expectV4Reject(JSON.stringify({
      v: 4,
      w: 2,
      h: 1,
      t: [TileType.ROAD, TileType.GRASS],
      l: [1, 0],
      m: 500,
      d: 5,
    }));
  });

  // --- unsupported envelope version ---

  it('(envelope v:99) → reject (unsupported)', () => {
    const world = new World(2, 1, { regenerate: false });
    const before = world.getMoney();
    const payload = JSON.stringify({
      v: 99,
      w: 2,
      h: 1,
      t: [TileType.GRASS, TileType.GRASS],
      l: [0, 0],
      m: 0,
      d: 0,
    });
    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// v5 Building persistence: serializeWorld / deserializeWorldInto
// ---------------------------------------------------------------------------

describe('v5 Building persistence', () => {
  /** Build a minimal valid v5 JSON payload for tests. */
  function makeV5(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      v: 5,
      w: 4,
      h: 4,
      t: Array(16).fill(TileType.GRASS),
      l: Array(16).fill(0),
      m: 500,
      d: 0,
      b: [],
      ...overrides,
    });
  }

  /** Snapshot world state to verify it was not mutated on a rejected load. */
  function snapshotWorld(world: World) {
    return {
      money: world.getMoney(),
      days: world.getElapsedDays(),
      tile00: world.getMap().getTile(0, 0)?.type,
    };
  }

  it('WORLD_SAVE_VERSION is 6', () => {
    expect(WORLD_SAVE_VERSION).toBe(6);
  });

  // --- empty world v5 round-trip ---

  it('empty world v5 round-trip: save → load → identical empty state', () => {
    const src = new World(4, 4, { regenerate: false });
    const json = serializeWorld(src);
    const parsed = JSON.parse(json);
    expect(parsed.v).toBe(WORLD_SAVE_VERSION);
    expect(Array.isArray(parsed.b)).toBe(true);
    expect(parsed.b.length).toBe(0);

    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);
    expect(dst.getMoney()).toBe(src.getMoney());
    expect(dst.getElapsedDays()).toBe(0);
    expect(dst.getMap().getBuildings().getAllBuildings().length).toBe(0);
  });

  // --- v5 round-trip with preserved non-zero ids ---

  it('v5 round-trip preserves non-zero building ids (skipped ids via addBuilding+removeBuilding)', () => {
    const src = new World(4, 4, { regenerate: false });
    const map = src.getMap();

    // Place zone tiles.
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ZONE_COMMERCIAL));

    const buildings = map.getBuildings();

    // addBuilding then removeBuilding to consume id=0.
    const tmp = buildings.addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
    });
    expect(tmp).not.toBeNull();
    expect(tmp!.id).toBe(0);
    buildings.removeBuilding(0);

    // Now add again — will get id=1.
    const b1 = buildings.addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 2,
      density: 0,
      age: 5,
    });
    expect(b1).not.toBeNull();
    expect(b1!.id).toBe(1);

    // Second building — id=2.
    const b2 = buildings.addBuilding({
      type: 'commercial',
      footprint: [{ x: 2, y: 0 }],
      anchor: { x: 2, y: 0 },
      level: 1,
      density: 1,
      age: 3,
    });
    expect(b2).not.toBeNull();
    expect(b2!.id).toBe(2);

    const json = serializeWorld(src);
    const parsed = JSON.parse(json);
    // b[] sorted by id ascending
    expect(parsed.b[0].id).toBe(1);
    expect(parsed.b[1].id).toBe(2);

    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);

    const dstBuildings = dst.getMap().getBuildings();
    const loaded = [...dstBuildings.getAllBuildings()].sort((a, b) => a.id - b.id);
    expect(loaded.length).toBe(2);

    expect(loaded[0].id).toBe(1);
    expect(loaded[0].type).toBe('residential');
    expect(loaded[0].level).toBe(2);
    expect(loaded[0].density).toBe(0);
    expect(loaded[0].age).toBe(5);
    expect(loaded[0].footprint[0]).toEqual({ x: 0, y: 0 });
    expect(loaded[0].anchor).toEqual({ x: 0, y: 0 });

    expect(loaded[1].id).toBe(2);
    expect(loaded[1].type).toBe('commercial');
    expect(loaded[1].level).toBe(1);
    expect(loaded[1].density).toBe(1);
    expect(loaded[1].age).toBe(3);
  });

  it('v5 round-trip: save → load → save produces byte-identical JSON (deterministic b[] ordering)', () => {
    const src = new World(4, 4, { regenerate: false });
    const map = src.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
    });
    map.getBuildings().addBuilding({
      type: 'commercial',
      footprint: [{ x: 1, y: 0 }],
      anchor: { x: 1, y: 0 },
      level: 2,
      density: 0,
      age: 0,
    });

    const json1 = serializeWorld(src);
    const dst = new World(4, 4, { regenerate: false });
    deserializeWorldInto(dst, json1);
    const json2 = serializeWorld(dst);
    expect(json2).toBe(json1);
  });

  // --- setNextIdFloor: new buildings after load don't collide with loaded ids ---

  it('v5 round-trip: addBuilding after load gets a fresh id (setNextIdFloor respected)', () => {
    const src = new World(4, 4, { regenerate: false });
    const map = src.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_INDUSTRIAL));
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
    });
    // id=0 was used

    const json = serializeWorld(src);
    const dst = new World(4, 4, { regenerate: false });
    deserializeWorldInto(dst, json);

    // New building on a free zone tile should get id=1, not reuse 0.
    const newB = dst.getMap().getBuildings().addBuilding({
      type: 'industrial',
      footprint: [{ x: 1, y: 0 }],
      anchor: { x: 1, y: 0 },
      level: 0,
      density: 0,
      age: 0,
    });
    expect(newB).not.toBeNull();
    expect(newB!.id).toBe(1);
  });

  // --- v4 → v5 migration ---

  it('v4 → v5 migration: level-2 zone in v4 save produces synthetic building (level=2, density=0, age=0)', () => {
    const world = new World(4, 4, { regenerate: false });
    const payload = JSON.stringify({
      v: 4,
      w: 4,
      h: 4,
      t: [
        TileType.ZONE_RESIDENTIAL, TileType.GRASS, TileType.GRASS, TileType.GRASS,
        TileType.GRASS, TileType.GRASS, TileType.GRASS, TileType.GRASS,
        TileType.GRASS, TileType.GRASS, TileType.GRASS, TileType.GRASS,
        TileType.GRASS, TileType.GRASS, TileType.GRASS, TileType.GRASS,
      ],
      l: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      m: 1000,
      d: 5,
    });

    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMoney()).toBe(1000);
    expect(world.getElapsedDays()).toBe(5);

    const buildings = world.getMap().getBuildings().getAllBuildings();
    expect(buildings.length).toBe(1);
    expect(buildings[0].type).toBe('residential');
    expect(buildings[0].level).toBe(2);
    expect(buildings[0].density).toBe(0);
    expect(buildings[0].age).toBe(0);
    expect(buildings[0].footprint).toHaveLength(1);
    expect(buildings[0].footprint[0]).toEqual({ x: 0, y: 0 });
    expect(buildings[0].anchor).toEqual({ x: 0, y: 0 });
  });

  it('v4 → v5 migration: zone tile with level=0 does NOT get a synthetic building', () => {
    const world = new World(2, 1, { regenerate: false });
    const payload = JSON.stringify({
      v: 4,
      w: 2,
      h: 1,
      t: [TileType.ZONE_COMMERCIAL, TileType.GRASS],
      l: [0, 0],
      m: 500,
      d: 0,
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getMap().getBuildings().getAllBuildings().length).toBe(0);
  });

  it('v3 → v5 migration: level-1 zone in v3 save produces synthetic building', () => {
    const world = new World(2, 1, { regenerate: false });
    const payload = JSON.stringify({
      v: 3,
      w: 2,
      h: 1,
      t: [TileType.ZONE_INDUSTRIAL, TileType.GRASS],
      l: [1, 0],
      m: 300,
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    const buildings = world.getMap().getBuildings().getAllBuildings();
    expect(buildings.length).toBe(1);
    expect(buildings[0].type).toBe('industrial');
    expect(buildings[0].level).toBe(1);
    expect(buildings[0].density).toBe(0);
    expect(buildings[0].age).toBe(0);
  });

  // --- staging rejections: world untouched ---

  it('v5 rejection — building on water: footprint cell is WATER in t[]', () => {
    const world = new World(4, 4, { regenerate: false });
    world.setMoney(9999);
    const before = snapshotWorld(world);

    // The first tile is WATER but building claims it as residential.
    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.WATER;

    const payload = makeV5({
      t: tiles,
      b: [{
        id: 0,
        type: 'residential',
        foot: [[0, 0]],
        anc: [0, 0],
        lvl: 0,
        den: 0,
        age: 0,
      }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('v5 rejection — type mismatch: residential building over ZONE_COMMERCIAL', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_COMMERCIAL;

    const payload = makeV5({
      t: tiles,
      l: Array(16).fill(0),
      b: [{
        id: 0,
        type: 'residential', // mismatch — should be 'commercial'
        foot: [[0, 0]],
        anc: [0, 0],
        lvl: 0,
        den: 0,
        age: 0,
      }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('v5 rejection — overlap: two buildings claim same cell', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [
        { id: 0, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 0, age: 0 },
        { id: 1, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 0, age: 0 },
      ],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('v5 rejection — duplicate id: two buildings with same id', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;
    tiles[1] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [
        { id: 0, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 0, age: 0 },
        { id: 0, type: 'residential', foot: [[1, 0]], anc: [1, 0], lvl: 0, den: 0, age: 0 },
      ],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — anchor not in footprint', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{
        id: 0,
        type: 'residential',
        foot: [[0, 0]],
        anc: [1, 0], // not in footprint
        lvl: 0,
        den: 0,
        age: 0,
      }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — fractional id', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{ id: 1.5, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 0, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — fractional level', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{ id: 0, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 2.7, den: 0, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — fractional age', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{ id: 0, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 0, age: 0.1 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — fractional coord in footprint', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{ id: 0, type: 'residential', foot: [[0, 1.5]], anc: [0, 0], lvl: 0, den: 0, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — fractional density', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{ id: 0, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 1.5, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — negative id', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{ id: -1, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 0, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — duplicate cell within one footprint', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{
        id: 0,
        type: 'residential',
        foot: [[0, 0], [0, 0]], // duplicate cell
        anc: [0, 0],
        lvl: 0,
        den: 0,
        age: 0,
      }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — missing b[] field', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const payload = JSON.stringify({
      v: 5,
      w: 4,
      h: 4,
      t: Array(16).fill(TileType.GRASS),
      l: Array(16).fill(0),
      m: 500,
      d: 0,
      // b is missing
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — invalid building type string', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{ id: 0, type: 'lava', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 0, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — lvl exceeds ZONE_MAX_LEVEL', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{
        id: 0, type: 'residential', foot: [[0, 0]], anc: [0, 0],
        lvl: ZONE_MAX_LEVEL + 1,
        den: 0,
        age: 0,
      }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — density not in {0,1,2}', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const tiles = Array(16).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.ZONE_RESIDENTIAL;

    const payload = makeV5({
      t: tiles,
      b: [{ id: 0, type: 'residential', foot: [[0, 0]], anc: [0, 0], lvl: 0, den: 3, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — footprint cell out of bounds', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const payload = makeV5({
      b: [{ id: 0, type: 'residential', foot: [[10, 0]], anc: [10, 0], lvl: 0, den: 0, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — empty footprint', () => {
    const world = new World(4, 4, { regenerate: false });
    const before = snapshotWorld(world);

    const payload = makeV5({
      b: [{ id: 0, type: 'residential', foot: [], anc: [0, 0], lvl: 0, den: 0, age: 0 }],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
  });

  it('v5 rejection — w/h mismatch against world dimensions', () => {
    // World is 4×4 but payload claims 2×2 — must reject before any mutation.
    const world = new World(4, 4, { regenerate: false });
    world.setMoney(999);
    const before = snapshotWorld(world);

    const payload = JSON.stringify({
      v: 5,
      w: 2,
      h: 2,
      t: Array(4).fill(TileType.GRASS),
      l: Array(4).fill(0),
      m: 1,
      d: 0,
      b: [],
    });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(before.money);
    expect(world.getMap().getWidth()).toBe(4);
  });

  it('v4 load into world with pre-existing buildings clears stale buildings', () => {
    // Pre-load a world with a synthetic building, then overwrite with a v4 payload
    // that has no levelled zones. The stale building must not survive.
    const world = new World(2, 1, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 1));
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
    });
    expect(world.getMap().getBuildings().getAllBuildings().length).toBe(1);

    const payload = JSON.stringify({
      v: 4,
      w: 2,
      h: 1,
      t: [TileType.GRASS, TileType.GRASS],
      l: [0, 0],
      m: 500,
      d: 0,
    });

    expect(deserializeWorldInto(world, payload)).toBe(true);
    // No levelled zones in payload → migration produces zero buildings.
    expect(world.getMap().getBuildings().getAllBuildings().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// v6 terrain save/load tests (a)–(k)
// ---------------------------------------------------------------------------

describe('v6 terrain save/load', () => {
  const W = 10;
  const H = 10;

  /** Build a minimal valid v6 JSON for a W×H world. */
  function makeV6(overrides: Record<string, unknown> = {}): string {
    const defaultTerrain = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
    };
    return JSON.stringify({
      v: 6,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 500,
      d: 0,
      b: [],
      terrain: defaultTerrain,
      ...overrides,
    });
  }

  // (a) v6 round-trip with cliffs
  it('(a) v6 round-trip with cliffs: serialize → deserialize preserves terrain state', () => {
    const src = new World(W, H, { regenerate: false });
    // Mutate via unsafeSetElevation (legal cliff for save/load)
    src.getTerrain().unsafeSetElevation(5, 5, 3);
    src.getTerrain().unsafeSetElevation(4, 5, 0);

    const json = serializeWorld(src);
    const dst = new World(W, H, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);

    expect(JSON.stringify(dst.getTerrain().toJSON())).toBe(
      JSON.stringify(src.getTerrain().toJSON())
    );
  });

  // (b) Reject mode === "vertex-smooth"
  it('(b) reject terrain.mode "vertex-smooth" — returns false, world unchanged', () => {
    const world = new World(W, H, { regenerate: false });
    world.setMoney(1234);
    const prevMoney = world.getMoney();

    const terrainDto = {
      width: W,
      height: H,
      mode: 'vertex-smooth',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
    };
    const payload = makeV6({ terrain: terrainDto });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(prevMoney);
  });

  // (c) Reject non-integer elevation
  it('(c) reject tileElevations[0][0] = 1.5 — returns false, world unchanged', () => {
    const world = new World(W, H, { regenerate: false });
    const prevMoney = world.getMoney();

    const elev = Array.from({ length: H }, () => new Array<number>(W).fill(0));
    elev[0][0] = 1.5;
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: elev,
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
    };
    const payload = makeV6({ terrain: terrainDto });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(prevMoney);
  });

  // (d) Reject elevation > MAX_ELEVATION
  it('(d) reject tileElevations[0][0] = MAX_ELEVATION + 1 — returns false, world unchanged', () => {
    const world = new World(W, H, { regenerate: false });
    const prevMoney = world.getMoney();

    const elev = Array.from({ length: H }, () => new Array<number>(W).fill(0));
    elev[0][0] = MAX_ELEVATION + 1;
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: elev,
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
    };
    const payload = makeV6({ terrain: terrainDto });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(prevMoney);
  });

  // (e) v1–v5 load installs fresh default terrain (all-zero elevations, all-grass baseTiles)
  it('(e) v1 load installs fresh default terrain (all-zero, all-grass)', () => {
    const world = new World(W, H, { regenerate: false });
    const payload = JSON.stringify({
      v: 1,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    const terrain = world.getTerrain();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(terrain.getTileElevation(x, y)).toBe(0);
        expect(terrain.getBaseTerrain(x, y)).toBe('grass');
      }
    }
  });

  it('(e) v2 load installs fresh default terrain (all-zero, all-grass)', () => {
    const world = new World(W, H, { regenerate: false });
    const payload = JSON.stringify({
      v: 2,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    const terrain = world.getTerrain();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(terrain.getTileElevation(x, y)).toBe(0);
        expect(terrain.getBaseTerrain(x, y)).toBe('grass');
      }
    }
  });

  it('(e) v3 load installs fresh default terrain (all-zero, all-grass)', () => {
    const world = new World(W, H, { regenerate: false });
    const payload = JSON.stringify({
      v: 3,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 500,
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    const terrain = world.getTerrain();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(terrain.getTileElevation(x, y)).toBe(0);
        expect(terrain.getBaseTerrain(x, y)).toBe('grass');
      }
    }
  });

  it('(e) v4 load installs fresh default terrain (all-zero, all-grass)', () => {
    const world = new World(W, H, { regenerate: false });
    const payload = JSON.stringify({
      v: 4,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 500,
      d: 0,
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    const terrain = world.getTerrain();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(terrain.getTileElevation(x, y)).toBe(0);
        expect(terrain.getBaseTerrain(x, y)).toBe('grass');
      }
    }
  });

  it('(e) v5 load installs fresh default terrain (all-zero, all-grass)', () => {
    const world = new World(W, H, { regenerate: false });
    const payload = JSON.stringify({
      v: 5,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 500,
      d: 0,
      b: [],
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    const terrain = world.getTerrain();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(terrain.getTileElevation(x, y)).toBe(0);
        expect(terrain.getBaseTerrain(x, y)).toBe('grass');
      }
    }
  });

  // (f) v5 load with WATER tile preserves tile-layer water; baseTiles stays "grass"
  it('(f) v5 load with WATER tile: tile-layer water preserved; baseTiles stays grass', () => {
    const world = new World(W, H, { regenerate: false });
    const tiles = Array(W * H).fill(TileType.GRASS) as TileType[];
    tiles[0] = TileType.WATER; // (0,0) is water
    const payload = JSON.stringify({
      v: 5,
      w: W,
      h: H,
      t: tiles,
      l: Array(W * H).fill(0),
      m: 500,
      d: 0,
      b: [],
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.isWater(0, 0)).toBe(true);
    expect(world.getTerrain().getBaseTerrain(0, 0)).toBe('grass');
  });

  // (g) Legacy install regression: pre-mutated terrain reset on legacy load
  it('(g) legacy install regression: pre-mutated terrain is reset on v5 load', () => {
    const world = new World(W, H, { regenerate: false });
    world.getTerrain().unsafeSetElevation(5, 5, 3);
    expect(world.getTerrain().getTileElevation(5, 5)).toBe(3);

    const payload = JSON.stringify({
      v: 5,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 500,
      d: 0,
      b: [],
    });
    expect(deserializeWorldInto(world, payload)).toBe(true);
    expect(world.getTerrain().getTileElevation(5, 5)).toBe(0);
  });

  // (h) v6 malformed terrain block: full world state unchanged on rejection
  it('(h) v6 malformed terrain block: world state fully unchanged on rejection', () => {
    const world = new World(W, H, { regenerate: false });
    world.setMoney(9999);
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.ROAD));
    world.getTerrain().unsafeSetElevation(5, 5, 3);

    const prevMoney = world.getMoney();
    const prevBuildingCount = world.getMap().getBuildings().getAllBuildings().length;
    const prevElevation = world.getTerrain().getTileElevation(5, 5);
    const prevRev = world.getTerrainRevision();

    const badTerrain = {
      width: W,
      height: H,
      mode: 'vertex-smooth', // invalid
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
    };
    const payload = makeV6({ terrain: badTerrain });

    expect(deserializeWorldInto(world, payload)).toBe(false);
    expect(world.getMoney()).toBe(prevMoney);
    expect(world.getMap().getBuildings().getAllBuildings().length).toBe(prevBuildingCount);
    expect(world.getTerrain().getTileElevation(5, 5)).toBe(prevElevation);
    expect(world.getTerrainRevision()).toBe(prevRev);
  });

  // (i) Reserved fields rejected; round-trip omits them
  it('(i) vertexHeights: [] in terrain → reject', () => {
    const world = new World(W, H, { regenerate: false });
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
      vertexHeights: [],
    };
    expect(deserializeWorldInto(world, makeV6({ terrain: terrainDto }))).toBe(false);
  });

  it('(i) vertexHeights: [[0]] in terrain → reject', () => {
    const world = new World(W, H, { regenerate: false });
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
      vertexHeights: [[0]],
    };
    expect(deserializeWorldInto(world, makeV6({ terrain: terrainDto }))).toBe(false);
  });

  it('(i) waterLevel: 0 in terrain → reject', () => {
    const world = new World(W, H, { regenerate: false });
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
      waterLevel: 0,
    };
    expect(deserializeWorldInto(world, makeV6({ terrain: terrainDto }))).toBe(false);
  });

  it('(i) waterLevel: 3.5 in terrain → reject', () => {
    const world = new World(W, H, { regenerate: false });
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: Array.from({ length: H }, () => new Array<string>(W).fill('grass')),
      waterLevel: 3.5,
    };
    expect(deserializeWorldInto(world, makeV6({ terrain: terrainDto }))).toBe(false);
  });

  it('(i) round-trip: toJSON() omits vertexHeights and waterLevel', () => {
    const src = new World(W, H, { regenerate: false });
    const json = serializeWorld(src);
    const parsed = JSON.parse(json) as { terrain: Record<string, unknown> };
    expect('vertexHeights' in parsed.terrain).toBe(false);
    expect('waterLevel' in parsed.terrain).toBe(false);

    const dst = new World(W, H, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);
    const reloadedDto = dst.getTerrain().toJSON() as Record<string, unknown>;
    expect('vertexHeights' in reloadedDto).toBe(false);
    expect('waterLevel' in reloadedDto).toBe(false);
  });

  // (j) baseTiles non-grass rejected; round-trip all-grass
  it('(j) baseTiles[0][0] = "water" → reject', () => {
    const world = new World(W, H, { regenerate: false });
    const base = Array.from({ length: H }, () => new Array<string>(W).fill('grass'));
    base[0][0] = 'water';
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: base,
    };
    expect(deserializeWorldInto(world, makeV6({ terrain: terrainDto }))).toBe(false);
  });

  it('(j) baseTiles[0][0] = "sand" → reject', () => {
    const world = new World(W, H, { regenerate: false });
    const base = Array.from({ length: H }, () => new Array<string>(W).fill('grass'));
    base[0][0] = 'sand';
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: base,
    };
    expect(deserializeWorldInto(world, makeV6({ terrain: terrainDto }))).toBe(false);
  });

  it('(j) baseTiles[0][0] = "rock" → reject', () => {
    const world = new World(W, H, { regenerate: false });
    const base = Array.from({ length: H }, () => new Array<string>(W).fill('grass'));
    base[0][0] = 'rock';
    const terrainDto = {
      width: W,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
      baseTiles: base,
    };
    expect(deserializeWorldInto(world, makeV6({ terrain: terrainDto }))).toBe(false);
  });

  it('(j) round-trip: all baseTiles in reloaded terrain are "grass"', () => {
    const src = new World(W, H, { regenerate: false });
    const json = serializeWorld(src);
    const dst = new World(W, H, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);
    const flat = dst.getTerrain().toJSON().baseTiles.flat();
    expect(flat.every((v) => v === 'grass')).toBe(true);
  });

  // (k) v6 terrain/map dimension mismatch — validation-phase rejection (NO world mutation)
  it('(k) v6 terrain/map dimension mismatch rejected in validation phase — world state fully unchanged', () => {
    const world = new World(W, H, { regenerate: false });

    // Pre-populate state
    world.setMoney(999);
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.ROAD));
    world.getTerrain().unsafeSetElevation(5, 5, 3);

    // Snapshot everything
    const prevMoney = world.getMoney();
    const prevBuildingCount = world.getMap().getBuildings().getAllBuildings().length;
    const prevBuildingIds = world.getMap().getBuildings().getAllBuildings().map((b) => b.id);
    const prevElevation = world.getTerrain().getTileElevation(5, 5);
    const prevRev = world.getTerrainRevision();

    // terrain.width is W+1 — dim mismatch
    const mismatchedTerrain = {
      width: W + 1,
      height: H,
      mode: 'tile-step',
      tileElevations: Array.from({ length: H }, () => new Array<number>(W + 1).fill(0)),
      baseTiles: Array.from({ length: H }, () => new Array<string>(W + 1).fill('grass')),
    };
    const payload = makeV6({ terrain: mismatchedTerrain });

    expect(deserializeWorldInto(world, payload)).toBe(false);

    // Assert world fully unchanged
    expect(world.getMoney()).toBe(prevMoney);
    expect(world.getMap().getBuildings().getAllBuildings().length).toBe(prevBuildingCount);
    expect(world.getMap().getBuildings().getAllBuildings().map((b) => b.id)).toEqual(prevBuildingIds);
    expect(world.getTerrain().getTileElevation(5, 5)).toBe(prevElevation);
    expect(world.getTerrainRevision()).toBe(prevRev);
  });
});

// ---------------------------------------------------------------------------
// Task 8: legacy-hydration tests (a)-(e) + generator-spy assertions
// ---------------------------------------------------------------------------

describe('Task 8: hydration + generator-spy tests', () => {
  const W = 8;
  const H = 6;

  // (a) v6 round-trip: procedural world A serialized and deserialized into world B
  // preserves the terrain snapshot byte-for-byte.
  it('(a) v6 round-trip: procedural world terrain survives serialize → deserialize', () => {
    const worldA = new World(W, H, { regenerate: true });
    const snapshot = JSON.stringify(worldA.getTerrain().toJSON());
    const s = serializeWorld(worldA);

    const worldB = new World(W, H, { regenerate: true });
    expect(deserializeWorldInto(worldB, s)).toBe(true);
    expect(JSON.stringify(worldB.getTerrain().toJSON())).toBe(snapshot);
    expect(worldB.getMap().getWidth()).toBe(W);
    expect(worldB.getMap().getHeight()).toBe(H);
  });

  // (b) v5 legacy hydration: all elevations reset to 0; tile-layer water preserved.
  it('(b) v5 legacy hydration: all elevations are 0, water tile preserved on tile layer', () => {
    const tiles = Array(W * H).fill(TileType.GRASS) as TileType[];
    const waterX = 2;
    const waterY = 1;
    tiles[waterY * W + waterX] = TileType.WATER;

    const v5JsonStr = JSON.stringify({
      v: 5,
      w: W,
      h: H,
      t: tiles,
      l: Array(W * H).fill(0),
      m: 500,
      d: 0,
      b: [],
    });

    const world = new World(W, H, { regenerate: true });
    expect(deserializeWorldInto(world, v5JsonStr)).toBe(true);

    // All elevations must be 0 after v5 legacy hydration.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(world.getTerrain().getTileElevation(x, y)).toBe(0);
      }
    }
    // Water tile preserved on the tile layer.
    expect(world.isWater(waterX, waterY)).toBe(true);
  });

  // (c) v1 legacy hydration: all elevations reset to 0.
  it('(c) v1 legacy hydration: all elevations are 0', () => {
    const v1JsonStr = JSON.stringify({
      v: 1,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
    });

    const world = new World(W, H, { regenerate: true });
    expect(deserializeWorldInto(world, v1JsonStr)).toBe(true);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(world.getTerrain().getTileElevation(x, y)).toBe(0);
      }
    }
  });

  // (d) Generator NOT invoked during deserialization for v6, v5, and v1 paths.
  it('(d) generateTerrain NOT called during v6 deserialization', () => {
    const world = new World(W, H, { regenerate: true });
    const s = serializeWorld(world);

    const target = new World(W, H, { regenerate: true });
    const spy = vi.spyOn(terrainGeneratorModule, 'generateTerrain');
    try {
      expect(deserializeWorldInto(target, s)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('(d) generateTerrain NOT called during v5 deserialization', () => {
    const world = new World(W, H, { regenerate: true });
    const v5Str = JSON.stringify({
      v: 5,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
      l: Array(W * H).fill(0),
      m: 500,
      d: 0,
      b: [],
    });

    const spy = vi.spyOn(terrainGeneratorModule, 'generateTerrain');
    try {
      expect(deserializeWorldInto(world, v5Str)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('(d) generateTerrain NOT called during v1 deserialization', () => {
    const world = new World(W, H, { regenerate: true });
    const v1Str = JSON.stringify({
      v: 1,
      w: W,
      h: H,
      t: Array(W * H).fill(TileType.GRASS),
    });

    const spy = vi.spyOn(terrainGeneratorModule, 'generateTerrain');
    try {
      expect(deserializeWorldInto(world, v1Str)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  });

  // (e) Save round-trip across procedural worlds: sA === sB after loading sA into B and re-serializing.
  it('(e) save round-trip across procedural worlds: sA === sB (byte-identical)', () => {
    const worldA = new World(W, H, { regenerate: true });
    const sA = serializeWorld(worldA);

    const worldB = new World(W, H, { regenerate: true });
    worldB.regenerateTerrain(99);
    expect(deserializeWorldInto(worldB, sA)).toBe(true);
    const sB = serializeWorld(worldB);

    expect(sA).toBe(sB);
  });
});
