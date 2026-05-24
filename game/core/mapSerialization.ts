/**
 * World-envelope (de)serialization.
 *
 * v8 is native; older saves are rejected; `worldStore` falls back to a fresh
 * procedural world. `t[]` accepts only
 * the current `TileType` enum (no `'water'`); coherence (water ⇒ GRASS && no building footprint) is checked after
 * staging validation and before commit. `serializeWorld` does NOT validate coherence —
 * it serializes the in-memory `World` as-is; `devApi.seedScene` is the only legitimate
 * producer of incoherent worlds and the load-side rejection is the safety net.
 */

import { TileType, createTile, isZoneType } from './Tile';
import { ZONE_MAX_LEVEL } from './World';
import type { World } from './World';
import { isBuildingType, tileTypeFromBuildingType } from './Building';
import type { Building } from './Building';
import { Terrain, SEA_LEVEL } from './Terrain';

/**
 * World-envelope version — owned by serializeWorld/deserializeWorldInto.
 * This is the `v` value written to disk. Only native v8 saves are accepted.
 */
export const WORLD_SAVE_VERSION = 8;

const VALID_TILE_TYPES = new Set<string>(Object.values(TileType));

/**
 * Wire format for one building entry in `b[]`.
 * Compact tuple-array style: { id, type, foot: [[x,y],...], anc: [x,y], lvl, den, age }.
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
 * Serialize the full world state to a JSON string.
 * Always emits `v: WORLD_SAVE_VERSION` (= 8).
 * Does NOT validate coherence — the in-memory world is serialized as-is.
 *
 * `b[]` is sorted by id ascending for deterministic byte-equality across round-trips.
 */
export function serializeWorld(world: World): string {
  const map = world.getMap();
  const buildings = map.getBuildings();

  const w = map.getWidth();
  const h = map.getHeight();
  const tiles = [...map.iterateTiles()];
  const t = tiles.map((tile) => tile.type);
  const l = tiles.map((tile) => {
    if (!isZoneType(tile.type)) return 0;
    const building = buildings.getBuildingAt(tile.x, tile.y);
    return building !== null ? building.level : 0;
  });

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

interface WorldSaveData {
  v: number;
  w: number;
  h: number;
  t: TileType[];
  l: number[];
  m: number;
  d: number;
  b: unknown[];
  terrain: unknown;
}

/**
 * Validate the `b[]` array against the staged tile array and stage Building objects.
 * Returns the staged Building[] on success, or null on any validation failure.
 * Pure validation: no world mutation. Callers must run the elevation-coherence check
 * separately against the staged footprints.
 */
function validateBuildingsArray(data: WorldSaveData, w: number, h: number): Building[] | null {
  if (!Array.isArray(data.b)) return null;

  const occupiedIndices = new Set<number>();
  const seenIds = new Set<number>();
  const staging: Building[] = [];

  for (const entry of data.b) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const e = entry as BuildingSaveEntry;

    if (!Number.isInteger(e.id) || e.id < 0) return null;
    if (seenIds.has(e.id)) return null;
    seenIds.add(e.id);

    if (typeof e.type !== 'string' || !isBuildingType(e.type)) return null;
    if (!Number.isInteger(e.lvl) || e.lvl < 0 || e.lvl > ZONE_MAX_LEVEL) return null;
    if (!Number.isInteger(e.den) || (e.den !== 0 && e.den !== 1 && e.den !== 2)) return null;
    if (!Number.isInteger(e.age) || e.age < 0) return null;
    if (!Array.isArray(e.foot) || e.foot.length === 0) return null;

    const footprintIndices = new Set<number>();
    const footprint: { x: number; y: number }[] = [];
    for (const coord of e.foot) {
      if (!Array.isArray(coord) || coord.length < 2) return null;
      const cx = coord[0];
      const cy = coord[1];
      if (!Number.isInteger(cx) || !Number.isInteger(cy)) return null;
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) return null;
      const idx = cy * w + cx;
      if (footprintIndices.has(idx)) return null;
      footprintIndices.add(idx);
      footprint.push({ x: cx, y: cy });
    }

    if (!Array.isArray(e.anc) || e.anc.length < 2) return null;
    const ax = e.anc[0];
    const ay = e.anc[1];
    if (!Number.isInteger(ax) || !Number.isInteger(ay)) return null;
    const ancInFootprint = footprint.some((c) => c.x === ax && c.y === ay);
    if (!ancInFootprint) return null;

    const expectedTileType = tileTypeFromBuildingType(e.type);
    for (const c of footprint) {
      const tileType = data.t[c.y * w + c.x];
      if (tileType !== expectedTileType) return null;
    }

    for (const idx of footprintIndices) {
      if (occupiedIndices.has(idx)) return null;
      occupiedIndices.add(idx);
    }

    staging.push({
      id: e.id,
      type: e.type,
      footprint,
      anchor: { x: ax, y: ay },
      level: e.lvl,
      density: e.den as 0 | 1 | 2,
      age: e.age,
    });
  }

  return staging;
}

/**
 * Apply a serialized v8 world envelope onto an existing World instance.
 * @returns true if the full world state was committed; false (without mutating) on any failure.
 *
 * Ordering: parse → shape-guard → v===8 → dims → m/d → t[] → l[] → b[] → terrain → coherence → commit.
 * Full staging-then-commit: every invariant is checked before any world mutation.
 */
export function deserializeWorldInto(world: World, json: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }

  // Shape-guard: must be a non-null, non-array object with a numeric v.
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as { v?: unknown }).v !== 'number'
  ) {
    return false;
  }

  const data = parsed as WorldSaveData;

  if (data.v !== WORLD_SAVE_VERSION) return false;

  // Dims must match the target world.
  const map = world.getMap();
  const w = map.getWidth();
  const h = map.getHeight();
  if (data.w !== w || data.h !== h) return false;

  // Money + day: both required, whole non-negative integers.
  if (!Number.isInteger(data.m) || data.m < 0) return false;
  if (!Number.isInteger(data.d) || data.d < 0) return false;

  // t[]: required array of length w*h with every entry in the current TileType enum.
  const size = w * h;
  if (
    !Array.isArray(data.t) ||
    data.t.length !== size ||
    !data.t.every((type) => VALID_TILE_TYPES.has(type))
  ) {
    return false;
  }

  // l[]: required array; non-zone tiles must be 0, zone tiles in [0, ZONE_MAX_LEVEL].
  if (!Array.isArray(data.l) || data.l.length !== size) return false;
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

  // b[]: staged Building objects, fully validated.
  const stagingBuildings = validateBuildingsArray(data, w, h);
  if (stagingBuildings === null) return false;

  // terrain: native v8 DTO parsed directly.
  let candidateTerrain: Terrain;
  try {
    candidateTerrain = Terrain.fromData(data.terrain);
  } catch {
    return false;
  }
  if (candidateTerrain.getWidth() !== w || candidateTerrain.getHeight() !== h) return false;

  // Coherence: water cells must be GRASS and uncovered; ROAD/zone cells must be
  // coplanar (single plane) above sea level; building-footprint cells must additionally
  // be strict-flat (mirrors World.tick spawn — building visuals are not tilted-ready).
  const footprintIndices = new Set<number>();
  for (const building of stagingBuildings) {
    for (const c of building.footprint) {
      footprintIndices.add(c.y * w + c.x);
    }
  }
  const isWater = (cx: number, cy: number) =>
    candidateTerrain.getTileMinCornerHeight(cx, cy) <= SEA_LEVEL;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (candidateTerrain.getTileMinCornerHeight(x, y) <= SEA_LEVEL) {
        if (data.t[i] !== TileType.GRASS) return false;
        if (footprintIndices.has(i)) return false;
      }
      const isRoadOrZone = data.t[i] === TileType.ROAD || isZoneType(data.t[i]);
      if (isRoadOrZone && !candidateTerrain.isCoplanarTile(x, y, isWater)) {
        return false;
      }
      if (footprintIndices.has(i) && !candidateTerrain.isFlatTile(x, y, isWater)) {
        return false;
      }
    }
  }

  // All validation passed — commit. regenerate: false so procedural terrain does not
  // overwrite the hydrated data we are about to install.
  world.reset({ regenerate: false });

  for (let i = 0; i < size; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    map.setTile(x, y, createTile(x, y, data.t[i], data.l[i]));
  }

  const buildings = map.getBuildings();
  let maxId = -1;
  for (const building of stagingBuildings) {
    buildings.addExistingBuilding(building);
    if (building.id > maxId) maxId = building.id;
  }
  if (maxId >= 0) buildings.setNextIdFloor(maxId);

  world.installTerrain(candidateTerrain);

  world.setMoney(data.m);
  world.setElapsedDays(data.d);

  // Land value is not persisted — mark dirty so the first tick after load recomputes.
  world.markLandValueDirty();

  return true;
}
