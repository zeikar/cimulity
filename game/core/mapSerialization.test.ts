import { describe, it, expect } from 'vitest';
import { World } from './World';
import { TileType, createTile } from './Tile';
import { serializeWorld, deserializeWorldInto, WORLD_SAVE_VERSION } from './mapSerialization';

describe('v8 serialization', () => {
  it('WORLD_SAVE_VERSION is 8 and serializeWorld emits vertex-smooth terrain', () => {
    const world = new World(4, 4, { regenerate: false });
    const parsed = JSON.parse(serializeWorld(world));
    expect(WORLD_SAVE_VERSION).toBe(8);
    expect(parsed.v).toBe(8);
    expect(parsed.terrain.mode).toBe('vertex-smooth');
    expect(parsed.terrain.vertexHeights).toHaveLength(5);
    expect('tileElevations' in parsed.terrain).toBe(false);
  });

  it('round-trips vertex heights and tiles', () => {
    const src = new World(4, 4, { regenerate: false });
    src.getTerrain().unsafeSetVertexHeight(1, 1, 2);
    src.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));

    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);
    expect(dst.getTerrain().getVertexHeight(1, 1)).toBe(2);
    expect(dst.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
  });

  it('rejects native v8 terrain with tileElevations present', () => {
    const obj = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    obj.terrain.tileElevations = [[1]];
    expect(deserializeWorldInto(new World(4, 4, { regenerate: false }), JSON.stringify(obj))).toBe(false);
  });
  it('rejects v7 and older saves without mutating the target world', () => {
    const obj = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    obj.v = 7;

    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);

    obj.v = 6;
    expect(deserializeWorldInto(world, JSON.stringify(obj))).toBe(false);
  });
});
