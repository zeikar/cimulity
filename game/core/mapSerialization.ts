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
 *   v ∉ {1,2,3,4,5,6} → reject
 *   v === 1, no m   → legacy accept; money = STARTING_FUNDS; map via v1 rules
 *   v === 1, m key  → reject (strict symmetry with map-level v1+stray-l rejection)
 *   v === 2, no m   → backward-compat; money = STARTING_FUNDS; map via v2 rules
 *   v === 2, m key  → m ignored / lenient (v1 is strict, v2 is lenient; documented asymmetry)
 *   v === 3         → m required, must satisfy Number.isInteger(m) && m >= 0
 *                     map rules are identical to v2 (envelope only adds m)
 *   v === 4         → m required (validated exactly as v3) AND d required,
 *                     must satisfy Number.isInteger(d) && d >= 0
 *                     map rules are identical to v2/v3 (envelope only adds d)
 *   v === 5         → m + d required (same rules as v4) AND b required (building array);
 *                     all building fields validated before any mutation.
 *   v === 6         → v5 fields + terrain required; terrain must be a full TerrainData DTO
 *                     (mode "tile-step", no vertexHeights, no waterLevel);
 *                     terrain dims must match world map dims; all-or-nothing.
 *   v1/v2/v3 default d = 0 (backward-compat — calendar restarts at Year 1 M1 D1 /
 *     Tick 0; v3 money still preserved, v1/v2 money still STARTING_FUNDS;
 *     existing v3/v2/v1 behavior otherwise fully preserved).
 *
 * Legacy migration (v1–v5):
 *   After the legacy deserializer's commit succeeds, install a fresh default
 *   Terrain (all-zero elevations, all-grass baseTiles) regardless of the
 *   target world's prior state. baseTiles stays all-grass — do NOT mirror
 *   legacy TileType.WATER into baseTiles in v1 (decision #8). The tile-layer
 *   water is preserved by the legacy map load; world.isWater() reads the
 *   tile layer. A future v7 save migration will rebuild baseTiles from the
 *   tile layer when base-water becomes authoritative.
 *
 * V → MAP-VIEW TRANSLATION:
 *   deserializeMapInto only understands v1/v2. For a v3/v4/v5 envelope we build a
 *   temporary map-view object with v rewritten to 2 and pass that to
 *   deserializeMapInto — map-level code needs no v3/v4/v5 awareness.
 *   For v1/v2 envelopes we pass the original JSON string unchanged.
 *
 * MONEY VALIDATION:
 *   All money values are whole non-negative units: Number.isInteger(m) && m >= 0.
 *   Rejects non-number, null, NaN, Infinity, fractional, or negative values.
 *
 * ALL-OR-NOTHING:
 *   shape-guard → validate money → validate day → apply map → set money → set day (which also sets tick).
 *   If any step fails nothing is mutated (neither map nor money nor day/tick).
 *   For v5 the full staging-then-commit pattern is used: parse → validate all → reset → commit.
 */

import { GameMap } from './Map';
import { TileType, createTile, isZoneType } from './Tile';
import { ZONE_MAX_LEVEL, STARTING_FUNDS } from './World';
import type { World } from './World';
import { isBuildingType, tileTypeFromBuildingType } from './Building';
import type { Building, BuildingType } from './Building';
import { Terrain } from './Terrain';

/** Map schema version — owned by serializeMap/deserializeMapInto. Internal only; the persisted file uses WORLD_SAVE_VERSION. */
export const SAVE_VERSION = 2;

/**
 * World-envelope version — owned by serializeWorld/deserializeWorldInto.
 * This is the `v` value written to disk. v1/v2 had no money field;
 * v3 adds `m` (whole non-negative integer treasury balance);
 * v4 adds a single `d` (whole non-negative integer elapsed-day counter;
 * tickCount is restored from the same `d` on the World side — no separate
 * persisted tick field).
 * v5 adds `b` (building array with preserved ids and footprints).
 * v6 adds `terrain` (full TerrainData DTO; mode "tile-step" only).
 */
export const WORLD_SAVE_VERSION = 6;

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
  d?: number;
  b?: unknown[];
  terrain?: unknown;
}

/**
 * Wire format for one building entry in v5 `b[]`.
 * Compact tuple-array style matching `t`/`l` v4 compactness:
 *   { id, type, foot: [[x,y],...], anc: [x,y], lvl, den, age }
 */
interface BuildingSaveEntry {
  id: number;
  type: string;
  foot: [number, number][];
  anc: [number, number];
  lvl: number;
  den: number;
  age: number;
}

/**
 * Serialize the full world state (map + money + buildings) to a JSON string.
 * Reuses serializeMap's field construction to keep t/l as single source of truth.
 *
 * l[] for v5 saves: derived from buildings (level = building.level for owned zone tiles,
 * else 0). Redundant with b[] — kept for external-tooling compat; may be dropped in a
 * future version.
 *
 * b[] is sorted by id ascending to ensure deterministic byte-equality in round-trips.
 */
export function serializeWorld(world: World): string {
  const map = world.getMap();
  const buildings = map.getBuildings();

  // Build the l[] array from building data (for v5, this is redundant with b[]
  // but kept for backward compat with external tooling that may read l[]).
  const w = map.getWidth();
  const h = map.getHeight();
  const tiles = [...map.iterateTiles()];
  const t = tiles.map((tile) => tile.type);
  const l = tiles.map((tile) => {
    if (!isZoneType(tile.type)) return 0;
    const building = buildings.getBuildingAt(tile.x, tile.y);
    return building !== null ? building.level : 0;
  });

  // Build b[] sorted by id ascending.
  const allBuildings = [...buildings.getAllBuildings()].sort((a, b) => a.id - b.id);
  const b: BuildingSaveEntry[] = allBuildings.map((building) => ({
    id: building.id,
    type: building.type,
    foot: building.footprint.map(({ x, y }) => [x, y] as [number, number]),
    anc: [building.anchor.x, building.anchor.y],
    lvl: building.level,
    den: building.density,
    age: building.age,
  }));

  const data = {
    v: WORLD_SAVE_VERSION,
    w,
    h,
    t,
    l,
    m: world.getMoney(),
    d: world.getElapsedDays(),
    b,
    terrain: world.getTerrain().toJSON(),
  };
  return JSON.stringify(data);
}

/**
 * Apply a serialized world envelope onto an existing World instance.
 * @returns true if map, money and day/tick were applied; false (without mutating) on any failure.
 *
 * Ordering: shape-guard → validate money → validate day → apply map → set money → set day (which also sets tick).
 * If map application fails, money and day/tick are never changed.
 *
 * For v5: full staging-then-commit — parse → validate ALL → reset → commit (in that order).
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
  if (v !== 1 && v !== 2 && v !== 3 && v !== 4 && v !== 5 && v !== 6) {
    return false;
  }

  // Determine resolved money + day and validate per version table.
  let resolvedMoney: number;
  // v1/v2/v3 have no calendar concept — restart at day 0 (backward-compat).
  let resolvedDay = 0;

  if (v === 1) {
    // v1: stray `m` key is a strict reject (mirrors map-level v1+stray-l rejection).
    if ('m' in data) return false;
    resolvedMoney = STARTING_FUNDS;
  } else if (v === 2) {
    // v2: backward-compat; stray `m` is silently ignored (lenient vs v1-strict asymmetry).
    resolvedMoney = STARTING_FUNDS;
  } else if (v === 3) {
    // v === 3: m is required and must be a whole non-negative integer.
    if (
      !('m' in data) ||
      !Number.isInteger(data.m) ||
      (data.m as number) < 0
    ) {
      return false;
    }
    resolvedMoney = data.m as number;
  } else {
    // v === 4, v === 5, or v === 6: m validated exactly as v3, AND d required as a whole non-negative integer.
    if (
      !('m' in data) ||
      !Number.isInteger(data.m) ||
      (data.m as number) < 0 ||
      !('d' in data) ||
      !Number.isInteger(data.d) ||
      (data.d as number) < 0
    ) {
      return false;
    }
    resolvedMoney = data.m as number;
    resolvedDay = data.d as number;
  }

  // v6 path: staging-then-commit with full building + terrain validation.
  if (v === 6) {
    return deserializeV6(world, data, resolvedMoney, resolvedDay);
  }

  // v5 path: staging-then-commit with full building validation.
  if (v === 5) {
    const ok = deserializeV5(world, data, resolvedMoney, resolvedDay);
    if (ok) {
      // Legacy migration: install a fresh default Terrain after a successful v5 commit.
      world.installTerrain(new Terrain(world.getMap().getWidth(), world.getMap().getHeight()));
    }
    return ok;
  }

  // Build the map-view JSON to pass to deserializeMapInto.
  // deserializeMapInto only understands v1/v2; for v3/v4 we rewrite v to 2.
  // v1/v2 envelopes are passed as-is (their v values are valid for the map layer).
  let mapJson: string;
  if (v === 3 || v === 4) {
    // v3/v4 → map-view v:2 translation: rewrite envelope v to 2 before delegating.
    const mapView: WorldSaveData = { ...data, v: 2 };
    mapJson = JSON.stringify(mapView);
  } else {
    mapJson = json;
  }

  // Apply map (all-or-nothing); only set money + day on success.
  const mapApplied = deserializeMapInto(world.getMap(), mapJson);
  if (!mapApplied) return false;

  // setMoney/setElapsedDays return values are intentionally ignored: both values
  // were already validated immediately above with the identical guard.
  world.setMoney(resolvedMoney);
  world.setElapsedDays(resolvedDay); // also restores tickCount (1 tick = 1 day)

  // Clear any pre-existing buildings before migration so stale state can't survive a load.
  world.getMap().getBuildings().clear();

  // v1–v4 migration: synthesize 1×1 buildings for zone tiles with level > 0.
  // This converts old tile-level data into the new building-centric model.
  migrateV1ToV4Buildings(world);

  // Land value is not persisted — mark dirty so the first tick after load recomputes.
  world.markLandValueDirty();

  // Legacy migration: install a fresh default Terrain after a successful v1–v4 commit.
  // baseTiles stays all-grass — do NOT mirror legacy TileType.WATER into baseTiles.
  world.installTerrain(new Terrain(world.getMap().getWidth(), world.getMap().getHeight()));

  return true;
}

/**
 * v1–v4 migration: for each zone tile with level > 0, synthesize a 1×1 building.
 * level = tile.level, density = 0, age = 0. ids allocated sequentially.
 * Only called after a successful v1–v4 map apply.
 */
function migrateV1ToV4Buildings(world: World): void {
  const map = world.getMap();
  const buildings = map.getBuildings();
  let maxSynthesizedId = -1;

  for (const tile of map.iterateTiles()) {
    if (!isZoneType(tile.type) || tile.level === 0) continue;

    const bType = tile.type.replace('zone_', '') as BuildingType;
    const created = buildings.addBuilding({
      type: bType,
      footprint: [{ x: tile.x, y: tile.y }],
      anchor: { x: tile.x, y: tile.y },
      level: tile.level,
      density: 0,
      age: 0,
    });
    if (created !== null) {
      maxSynthesizedId = Math.max(maxSynthesizedId, created.id);
    }
  }

  if (maxSynthesizedId >= 0) {
    buildings.setNextIdFloor(maxSynthesizedId);
  }
}

/**
 * v5 staging-then-commit deserialization.
 * Validates ALL invariants before any world mutation.
 * Returns false (no mutation) on any failure.
 */
function deserializeV5(
  world: World,
  data: WorldSaveData,
  resolvedMoney: number,
  resolvedDay: number,
): boolean {
  const mapDims = world.getMap();
  if (data.w !== mapDims.getWidth() || data.h !== mapDims.getHeight()) {
    return false;
  }

  const w = data.w;
  const h = data.h;

  // Validate t[] — same rules as v2 map layer.
  if (
    !Array.isArray(data.t) ||
    data.t.length !== w * h ||
    !data.t.every((type) => VALID_TYPES.has(type))
  ) {
    return false;
  }

  // Validate l[] — required for v5, same rules as v2.
  const size = w * h;
  if (
    !Array.isArray(data.l) ||
    data.l.length !== size
  ) {
    return false;
  }
  for (let i = 0; i < size; i++) {
    const lvl = data.l[i];
    const typ = data.t[i];
    if (!Number.isInteger(lvl)) return false;
    if (isZoneType(typ as TileType)) {
      if (lvl < 0 || lvl > ZONE_MAX_LEVEL) return false;
    } else {
      if (lvl !== 0) return false;
    }
  }

  // b[] is required for v5.
  if (!Array.isArray(data.b)) return false;

  // Validate each building entry. Track occupied tile indices to detect overlaps.
  const occupiedIndices = new Set<number>();
  const seenIds = new Set<number>();
  const stagingBuildings: Building[] = [];

  for (const entry of data.b) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const e = entry as BuildingSaveEntry;

    // id: integer >= 0 and unique
    if (!Number.isInteger(e.id) || e.id < 0) return false;
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);

    // type: must pass isBuildingType
    if (typeof e.type !== 'string' || !isBuildingType(e.type)) return false;

    // lvl: integer in [0, ZONE_MAX_LEVEL]
    if (!Number.isInteger(e.lvl) || e.lvl < 0 || e.lvl > ZONE_MAX_LEVEL) return false;

    // den: must be 0, 1, or 2 (integer)
    if (!Number.isInteger(e.den) || (e.den !== 0 && e.den !== 1 && e.den !== 2)) return false;

    // age: integer >= 0
    if (!Number.isInteger(e.age) || e.age < 0) return false;

    // foot: non-empty array of [x, y] integer coordinate pairs
    if (!Array.isArray(e.foot) || e.foot.length === 0) return false;

    const footprintIndices = new Set<number>();
    const footprint: { x: number; y: number }[] = [];
    for (const coord of e.foot) {
      if (!Array.isArray(coord) || coord.length < 2) return false;
      const cx = coord[0];
      const cy = coord[1];
      // Integer check — rejects fractional coords
      if (!Number.isInteger(cx) || !Number.isInteger(cy)) return false;
      // Bounds check
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) return false;
      // Duplicate cell within this footprint
      const idx = cy * w + cx;
      if (footprintIndices.has(idx)) return false;
      footprintIndices.add(idx);
      footprint.push({ x: cx, y: cy });
    }

    // anc: [x, y] integer pair, must be one of the footprint cells
    if (!Array.isArray(e.anc) || e.anc.length < 2) return false;
    const ax = e.anc[0];
    const ay = e.anc[1];
    if (!Number.isInteger(ax) || !Number.isInteger(ay)) return false;
    const ancInFootprint = footprint.some((c) => c.x === ax && c.y === ay);
    if (!ancInFootprint) return false;

    // Zone type match: every footprint cell must be the matching zone type in t[]
    const expectedTileType = tileTypeFromBuildingType(e.type);
    for (const c of footprint) {
      const tileType = data.t[c.y * w + c.x];
      if (tileType !== expectedTileType) return false;
    }

    // No overlap with other buildings
    for (const idx of footprintIndices) {
      if (occupiedIndices.has(idx)) return false;
      occupiedIndices.add(idx);
    }

    stagingBuildings.push({
      id: e.id,
      type: e.type,
      footprint,
      anchor: { x: ax, y: ay },
      level: e.lvl,
      density: e.den as 0 | 1 | 2,
      age: e.age,
    });
  }

  // All validation passed — now commit (reset then apply staged data).
  // regenerate: false so procedural terrain is not run over the data we are about to hydrate.
  world.reset({ regenerate: false });

  const map = world.getMap();
  const buildings = map.getBuildings();

  // Apply tiles via setTile (NOT setTileAndReconcile — buildings come from b[]).
  for (let i = 0; i < size; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    map.setTile(x, y, createTile(x, y, data.t[i], data.l![i]));
  }

  // Hydrate buildings using addExistingBuilding to preserve ids.
  let maxId = -1;
  for (const building of stagingBuildings) {
    buildings.addExistingBuilding(building);
    if (building.id > maxId) maxId = building.id;
  }

  // Advance nextId floor so new buildings won't reuse any existing ids.
  if (maxId >= 0) {
    buildings.setNextIdFloor(maxId);
  }

  world.setMoney(resolvedMoney);
  world.setElapsedDays(resolvedDay);

  // Land value is not persisted — mark dirty so the first tick after load recomputes.
  world.markLandValueDirty();

  return true;
}

/**
 * v6 staging-then-commit deserialization.
 * Validates ALL invariants (including terrain DTO and dimension cross-check) BEFORE any world mutation.
 * Returns false (no mutation) on any failure.
 */
function deserializeV6(
  world: World,
  data: WorldSaveData,
  resolvedMoney: number,
  resolvedDay: number,
): boolean {
  const mapDims = world.getMap();
  if (data.w !== mapDims.getWidth() || data.h !== mapDims.getHeight()) {
    return false;
  }

  const w = data.w;
  const h = data.h;

  // Validate t[] — same rules as v2 map layer.
  if (
    !Array.isArray(data.t) ||
    data.t.length !== w * h ||
    !data.t.every((type) => VALID_TYPES.has(type))
  ) {
    return false;
  }

  // Validate l[] — required for v6, same rules as v2.
  const size = w * h;
  if (
    !Array.isArray(data.l) ||
    data.l.length !== size
  ) {
    return false;
  }
  for (let i = 0; i < size; i++) {
    const lvl = data.l[i];
    const typ = data.t[i];
    if (!Number.isInteger(lvl)) return false;
    if (isZoneType(typ as TileType)) {
      if (lvl < 0 || lvl > ZONE_MAX_LEVEL) return false;
    } else {
      if (lvl !== 0) return false;
    }
  }

  // b[] is required for v6.
  if (!Array.isArray(data.b)) return false;

  // Validate each building entry.
  const occupiedIndices = new Set<number>();
  const seenIds = new Set<number>();
  const stagingBuildings: Building[] = [];

  for (const entry of data.b) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const e = entry as BuildingSaveEntry;

    if (!Number.isInteger(e.id) || e.id < 0) return false;
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);

    if (typeof e.type !== 'string' || !isBuildingType(e.type)) return false;
    if (!Number.isInteger(e.lvl) || e.lvl < 0 || e.lvl > ZONE_MAX_LEVEL) return false;
    if (!Number.isInteger(e.den) || (e.den !== 0 && e.den !== 1 && e.den !== 2)) return false;
    if (!Number.isInteger(e.age) || e.age < 0) return false;
    if (!Array.isArray(e.foot) || e.foot.length === 0) return false;

    const footprintIndices = new Set<number>();
    const footprint: { x: number; y: number }[] = [];
    for (const coord of e.foot) {
      if (!Array.isArray(coord) || coord.length < 2) return false;
      const cx = coord[0];
      const cy = coord[1];
      if (!Number.isInteger(cx) || !Number.isInteger(cy)) return false;
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) return false;
      const idx = cy * w + cx;
      if (footprintIndices.has(idx)) return false;
      footprintIndices.add(idx);
      footprint.push({ x: cx, y: cy });
    }

    if (!Array.isArray(e.anc) || e.anc.length < 2) return false;
    const ax = e.anc[0];
    const ay = e.anc[1];
    if (!Number.isInteger(ax) || !Number.isInteger(ay)) return false;
    const ancInFootprint = footprint.some((c) => c.x === ax && c.y === ay);
    if (!ancInFootprint) return false;

    const expectedTileType = tileTypeFromBuildingType(e.type);
    for (const c of footprint) {
      const tileType = data.t[c.y * w + c.x];
      if (tileType !== expectedTileType) return false;
    }

    for (const idx of footprintIndices) {
      if (occupiedIndices.has(idx)) return false;
      occupiedIndices.add(idx);
    }

    stagingBuildings.push({
      id: e.id,
      type: e.type,
      footprint,
      anchor: { x: ax, y: ay },
      level: e.lvl,
      density: e.den as 0 | 1 | 2,
      age: e.age,
    });
  }

  // Validate terrain DTO (throws on any invalid field).
  let candidate: Terrain;
  try {
    candidate = Terrain.fromData(data.terrain);
  } catch {
    return false;
  }

  // Cross-check terrain dims against target world map dims (validation phase — BEFORE reset).
  if (
    candidate.getWidth() !== world.getMap().getWidth() ||
    candidate.getHeight() !== world.getMap().getHeight()
  ) {
    return false;
  }

  // All validation passed — commit (reset then apply staged data).
  // regenerate: false so procedural terrain is not run over the data we are about to hydrate.
  world.reset({ regenerate: false });

  const map = world.getMap();
  const buildings = map.getBuildings();

  for (let i = 0; i < size; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    map.setTile(x, y, createTile(x, y, data.t[i], data.l![i]));
  }

  let maxId = -1;
  for (const building of stagingBuildings) {
    buildings.addExistingBuilding(building);
    if (building.id > maxId) maxId = building.id;
  }

  if (maxId >= 0) {
    buildings.setNextIdFloor(maxId);
  }

  // Install validated terrain (wires onMutate callback and bumps terrainRev).
  world.installTerrain(candidate);

  world.setMoney(resolvedMoney);
  world.setElapsedDays(resolvedDay);

  world.markLandValueDirty();

  return true;
}
