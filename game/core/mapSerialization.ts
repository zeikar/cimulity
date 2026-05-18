/**
 * Pure map (de)serialization.
 *
 * Persists only tile types in row-major order; x/y are recoverable from
 * the index and elevation is always 0 in the current model, so the save
 * payload stays small. No localStorage here — that I/O glue lives in
 * worldStore. Validation is all-or-nothing: a payload is fully checked
 * before any tile is written, so a bad/old save never half-applies.
 */

import { GameMap } from './Map';
import { TileType, createTile } from './Tile';

export const SAVE_VERSION = 1;

interface SaveData {
  v: number;
  w: number;
  h: number;
  t: TileType[];
}

const VALID_TYPES = new Set<string>(Object.values(TileType));

export function serializeMap(map: GameMap): string {
  const data: SaveData = {
    v: SAVE_VERSION,
    w: map.getWidth(),
    h: map.getHeight(),
    t: [...map.iterateTiles()].map((tile) => tile.type),
  };
  return JSON.stringify(data);
}

/**
 * Apply a serialized payload onto an existing map.
 * @returns true if applied; false (without mutating) on any mismatch —
 *          wrong version, dimensions, length, or unknown tile type.
 */
export function deserializeMapInto(map: GameMap, json: string): boolean {
  let data: SaveData;
  try {
    data = JSON.parse(json) as SaveData;
  } catch {
    return false;
  }

  if (
    !data ||
    data.v !== SAVE_VERSION ||
    data.w !== map.getWidth() ||
    data.h !== map.getHeight() ||
    !Array.isArray(data.t) ||
    data.t.length !== data.w * data.h ||
    !data.t.every((type) => VALID_TYPES.has(type))
  ) {
    return false;
  }

  for (let i = 0; i < data.t.length; i++) {
    const x = i % data.w;
    const y = Math.floor(i / data.w);
    map.setTile(x, y, createTile(x, y, data.t[i]));
  }
  return true;
}
