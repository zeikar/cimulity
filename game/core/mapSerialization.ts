/**
 * (De)serialization for both the raw map and the world envelope.
 *
 * TWO SEPARATE APIS:
 *
 * 1. Map-only API  (SAVE_VERSION, serializeMap, deserializeMapInto)
 *    Handles just tile types + zone levels. v1/v2 only.
 *    Used internally by the world-envelope API; never writes to World.money.
 *
 * 2. World-envelope API  (WORLD_SAVE_VERSION, serializeWorld, deserializeWorldInto)
 *    The persisted file format. A flat object = map fields PLUS `m?: number`.
 *    `v` in the persisted file is the ENVELOPE version (owned by this API);
 *    serializeMap's internal `v:2` is only ever seen by map-level helpers.
 *    Envelope v1/v2 had no `m` (money defaults to STARTING_FUNDS). v3 adds `m`.
 *
 * ENVELOPE SHAPE-GUARD (checked first, before reading v or m):
 *   parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
 *   && typeof parsed.v === 'number'
 *
 * ENVELOPE VERSION TABLE:
 *   v ∉ {1,2,3}     → reject
 *   v === 1, no m   → legacy accept; money = STARTING_FUNDS; map via v1 rules
 *   v === 1, m key  → reject (strict symmetry with map-level v1+stray-l rejection)
 *   v === 2, no m   → backward-compat; money = STARTING_FUNDS; map via v2 rules
 *   v === 2, m key  → m ignored / lenient (v1 is strict, v2 is lenient; documented asymmetry)
 *   v === 3         → m required, must satisfy Number.isInteger(m) && m >= 0
 *                     map rules are identical to v2 (envelope only adds m)
 *
 * V3 → MAP-VIEW TRANSLATION:
 *   deserializeMapInto only understands v1/v2. For a v3 envelope we build a
 *   temporary map-view object with v rewritten to 2 and pass that to
 *   deserializeMapInto — map-level code needs no v3 awareness.
 *   For v1/v2 envelopes we pass the original JSON string unchanged.
 *
 * MONEY VALIDATION:
 *   All money values are whole non-negative units: Number.isInteger(m) && m >= 0.
 *   Rejects non-number, null, NaN, Infinity, fractional, or negative values.
 *
 * ALL-OR-NOTHING:
 *   shape-guard → validate money → apply map → set money.
 *   If any step fails nothing is mutated (neither map nor money).
 */

import { GameMap } from './Map';
import { TileType, createTile, isZoneType } from './Tile';
import { ZONE_MAX_LEVEL, STARTING_FUNDS } from './World';
import type { World } from './World';

/** Map schema version — owned by serializeMap/deserializeMapInto. Internal only; the persisted file uses WORLD_SAVE_VERSION. */
export const SAVE_VERSION = 2;

/**
 * World-envelope version — owned by serializeWorld/deserializeWorldInto.
 * This is the `v` value written to disk. v1/v2 had no money field;
 * v3 adds `m` (whole non-negative integer treasury balance).
 */
export const WORLD_SAVE_VERSION = 3;

interface SaveData {
  v: number;
  w: number;
  h: number;
  t: TileType[];
  l?: number[];
}

const VALID_TYPES = new Set<string>(Object.values(TileType));

export function serializeMap(map: GameMap): string {
  const data: SaveData = {
    v: SAVE_VERSION,
    w: map.getWidth(),
    h: map.getHeight(),
    t: [...map.iterateTiles()].map((tile) => tile.type),
    l: [...map.iterateTiles()].map((tile) => tile.level ?? 0),
  };
  return JSON.stringify(data);
}

/**
 * Apply a serialized payload onto an existing map.
 * @returns true if applied; false (without mutating) on any mismatch.
 *
 * Version rules:
 *   v1, no `l` key  → accept, all levels = 0 (legacy)
 *   v1, `l` present → reject (v1 has no level concept)
 *   v2, valid `l`   → accept, load levels
 *   v2, bad `l`     → reject
 *   other versions  → reject
 */
export function deserializeMapInto(map: GameMap, json: string): boolean {
  let data: SaveData;
  try {
    data = JSON.parse(json) as SaveData;
  } catch {
    return false;
  }

  // Basic structural checks (shared across all versions).
  if (
    !data ||
    typeof data.v !== 'number' ||
    data.w !== map.getWidth() ||
    data.h !== map.getHeight() ||
    !Array.isArray(data.t) ||
    data.t.length !== data.w * data.h ||
    !data.t.every((type) => VALID_TYPES.has(type))
  ) {
    return false;
  }

  const size = data.w * data.h;

  if (data.v === 1) {
    // v1 must NOT have an `l` key in any form.
    if ('l' in data) {
      return false;
    }
    // Accept legacy: all levels = 0.
    for (let i = 0; i < size; i++) {
      const x = i % data.w;
      const y = Math.floor(i / data.w);
      map.setTile(x, y, createTile(x, y, data.t[i], 0));
    }
    return true;
  }

  if (data.v === 2) {
    // v2 requires a fully-valid `l` array.
    if (
      !Array.isArray(data.l) ||
      data.l.length !== size
    ) {
      return false;
    }
    // Validate every entry before writing any tile.
    for (let i = 0; i < size; i++) {
      const lvl = data.l[i];
      const typ = data.t[i];
      if (!Number.isInteger(lvl)) return false;
      if (isZoneType(typ)) {
        if (lvl < 0 || lvl > ZONE_MAX_LEVEL) return false;
      } else {
        if (lvl !== 0) return false;
      }
    }
    // All checks passed — write.
    for (let i = 0; i < size; i++) {
      const x = i % data.w;
      const y = Math.floor(i / data.w);
      map.setTile(x, y, createTile(x, y, data.t[i], data.l![i]));
    }
    return true;
  }

  // Unsupported version.
  return false;
}

/**
 * World envelope shape: the same flat object serializeMap produces (v,w,h,t,l?)
 * with v overridden to WORLD_SAVE_VERSION and m added.
 * Persisted files are always world envelopes; serializeMap is only an internal helper.
 */
interface WorldSaveData {
  v: number;
  w: number;
  h: number;
  t: TileType[];
  l?: number[];
  m?: number;
}

/**
 * Serialize the full world state (map + money) to a JSON string.
 * Reuses serializeMap's field construction to keep t/l as single source of truth:
 * we parse the map JSON, then override v to WORLD_SAVE_VERSION and add m.
 */
export function serializeWorld(world: World): string {
  // Parse the map-level JSON and augment it — avoids duplicating the t/l mapping logic.
  const mapFields = JSON.parse(serializeMap(world.getMap())) as WorldSaveData;
  const data: WorldSaveData = {
    ...mapFields,
    v: WORLD_SAVE_VERSION,
    m: world.getMoney(),
  };
  return JSON.stringify(data);
}

/**
 * Apply a serialized world envelope onto an existing World instance.
 * @returns true if both map and money were applied; false (without mutating) on any failure.
 *
 * Ordering: shape-guard → validate money → apply map → set money.
 * If map application fails, money is never changed.
 */
export function deserializeWorldInto(world: World, json: string): boolean {
  let data: WorldSaveData;
  try {
    data = JSON.parse(json) as WorldSaveData;
  } catch {
    return false;
  }

  // Shape-guard: must be a non-null, non-array object with a numeric v.
  if (
    data === null ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    typeof data.v !== 'number'
  ) {
    return false;
  }

  const v = data.v;

  // Reject unsupported envelope versions.
  if (v !== 1 && v !== 2 && v !== 3) {
    return false;
  }

  // Determine resolved money and validate per version table.
  let resolvedMoney: number;

  if (v === 1) {
    // v1: stray `m` key is a strict reject (mirrors map-level v1+stray-l rejection).
    if ('m' in data) return false;
    resolvedMoney = STARTING_FUNDS;
  } else if (v === 2) {
    // v2: backward-compat; stray `m` is silently ignored (lenient vs v1-strict asymmetry).
    resolvedMoney = STARTING_FUNDS;
  } else {
    // v === 3: m is required and must be a whole non-negative integer.
    if (
      !('m' in data) ||
      !Number.isInteger(data.m) ||
      (data.m as number) < 0
    ) {
      return false;
    }
    resolvedMoney = data.m as number;
  }

  // Build the map-view JSON to pass to deserializeMapInto.
  // deserializeMapInto only understands v1/v2; for v3 we rewrite v to 2.
  // v1/v2 envelopes are passed as-is (their v values are valid for the map layer).
  let mapJson: string;
  if (v === 3) {
    // v3 → map-view v:2 translation: rewrite envelope v to 2 before delegating.
    const mapView: WorldSaveData = { ...data, v: 2 };
    mapJson = JSON.stringify(mapView);
  } else {
    mapJson = json;
  }

  // Apply map (all-or-nothing); only set money on success.
  const mapApplied = deserializeMapInto(world.getMap(), mapJson);
  if (!mapApplied) return false;

  world.setMoney(resolvedMoney);
  return true;
}
