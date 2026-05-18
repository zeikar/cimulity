/**
 * Pure map (de)serialization.
 *
 * Payload persists tile types and per-tile zone level (`l`, row-major).
 * v1 legacy saves (no `l` field) load with all levels 0 and upgrade to v2
 * on the next save. Only v1 and v2 are supported; all other versions are
 * rejected. Validation is all-or-nothing: a payload is fully checked before
 * any tile is written, so a bad/old save never half-applies.
 */

import { GameMap } from './Map';
import { TileType, createTile, isZoneType } from './Tile';
import { ZONE_MAX_LEVEL } from './World';

export const SAVE_VERSION = 2;

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
