import { describe, it, expect } from 'vitest';
import { GameMap } from './Map';
import { TileType, createTile } from './Tile';
import {
  serializeMap,
  deserializeMapInto,
  SAVE_VERSION,
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

  it('rejects a payload from a different schema version without mutating', () => {
    const map = new GameMap(2, 2);
    const stale = JSON.stringify({
      v: SAVE_VERSION + 1,
      w: 2,
      h: 2,
      t: [TileType.ROAD, TileType.ROAD, TileType.ROAD, TileType.ROAD],
    });

    expect(deserializeMapInto(map, stale)).toBe(false);
    expect(map.getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('rejects a payload whose dimensions do not match the map', () => {
    const map = new GameMap(2, 2);
    const src = new GameMap(3, 3);
    expect(deserializeMapInto(map, serializeMap(src))).toBe(false);
  });

  it('rejects a payload with an unknown tile type', () => {
    const map = new GameMap(2, 1);
    const bad = JSON.stringify({ v: SAVE_VERSION, w: 2, h: 1, t: ['lava', 'grass'] });
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
    // Schema-correct payload: correct v/w/h, correct t length (w*h=6),
    // but one entry uses the obsolete string 'building'.
    const stalePayload = JSON.stringify({
      v: SAVE_VERSION,
      w,
      h,
      t: [TileType.GRASS, TileType.GRASS, 'building', TileType.GRASS, TileType.GRASS, TileType.GRASS],
    });

    expect(deserializeMapInto(map, stalePayload)).toBe(false);

    // All tiles must still be GRASS — no partial mutation.
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        expect(map.getTile(x, y)?.type).toBe(TileType.GRASS);
      }
    }
  });
});
