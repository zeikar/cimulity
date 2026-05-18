import { describe, it, expect } from 'vitest';
import { GameMap } from './Map';
import { TileType, createTile } from './Tile';

describe('GameMap', () => {
  it('initializes every cell as a grass tile with its own coordinates', () => {
    const map = new GameMap(3, 2);

    expect(map.getWidth()).toBe(3);
    expect(map.getHeight()).toBe(2);
    expect(map.totalTiles).toBe(6);

    const tile = map.getTile(2, 1);
    expect(tile).toEqual({ x: 2, y: 1, type: TileType.GRASS, elevation: 0, level: 0 });
  });

  it('returns null for out-of-bounds reads', () => {
    const map = new GameMap(4, 4);

    expect(map.getTile(-1, 0)).toBeNull();
    expect(map.getTile(0, -1)).toBeNull();
    expect(map.getTile(4, 0)).toBeNull();
    expect(map.getTile(0, 4)).toBeNull();
  });

  it('writes a tile in bounds and reports success', () => {
    const map = new GameMap(4, 4);
    const road = createTile(1, 2, TileType.ROAD);

    expect(map.setTile(1, 2, road)).toBe(true);
    expect(map.getTile(1, 2)).toBe(road);
  });

  it('rejects out-of-bounds writes without mutating', () => {
    const map = new GameMap(4, 4);

    expect(map.setTile(-1, 0, createTile(-1, 0, TileType.ROAD))).toBe(false);
    expect(map.setTile(4, 0, createTile(4, 0, TileType.ROAD))).toBe(false);
    expect(map.setTile(0, 4, createTile(0, 4, TileType.ROAD))).toBe(false);
  });

  it('reads by flat row-major index', () => {
    const map = new GameMap(3, 3);
    // index = y * width + x  →  (x=2, y=1) = 1*3 + 2 = 5
    expect(map.getTileByIndex(5)).toEqual(map.getTile(2, 1));
  });

  it('reset() returns every cell to a fresh grass tile', () => {
    const map = new GameMap(3, 3);
    map.setTile(1, 1, createTile(1, 1, TileType.ROAD));

    map.reset();

    expect(map.getTile(1, 1)).toEqual({
      x: 1,
      y: 1,
      type: TileType.GRASS,
      elevation: 0,
      level: 0,
    });
  });

  it('iterates all tiles in row-major order', () => {
    const map = new GameMap(2, 2);
    const coords = [...map.iterateTiles()].map((t) => [t.x, t.y]);

    expect(coords).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });
});
