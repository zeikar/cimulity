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

  it('round-trips a ROAD placed on a coplanar non-flat tile', () => {
    // N-S ramp at tile (2,2): corners (2,2)=1,(3,2)=1 on the top edge,
    // (2,3)=2,(3,3)=2 on the bottom edge — coplanar but not flat.
    const src = new World(4, 4, { regenerate: false });
    src.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    src.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    src.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));

    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);
    expect(dst.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
    expect(dst.getTerrain().getVertexHeight(2, 3)).toBe(2);
    expect(dst.getTerrain().getVertexHeight(3, 3)).toBe(2);
  });

  it('round-trips a ZONE_RESIDENTIAL placed on a coplanar non-flat tile', () => {
    // Same N-S ramp shape at tile (2,2), zone with no building.
    const src = new World(4, 4, { regenerate: false });
    src.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    src.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    src.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));

    const dst = new World(4, 4, { regenerate: false });
    expect(deserializeWorldInto(dst, serializeWorld(src))).toBe(true);
    expect(dst.getMap().getTile(2, 2)?.type).toBe(TileType.ZONE_RESIDENTIAL);
  });

  it('rejects a save where a building footprint lands on a coplanar non-flat tile', () => {
    // Construct a save object directly with a coplanar non-flat tile at (2,2)
    // that has a building footprint on it. The strict-flat predicate must reject this.
    const base = JSON.parse(serializeWorld(new World(4, 4, { regenerate: false })));
    const w = 4;

    // Set N-S ramp vertices: (2,3)=2 and (3,3)=2 while (2,2) and (3,2) stay at 1.
    base.terrain.vertexHeights[3][2] = 2;
    base.terrain.vertexHeights[3][3] = 2;

    // Place ZONE_RESIDENTIAL at (2,2) (required tile type for 'residential' buildings).
    base.t[2 * w + 2] = TileType.ZONE_RESIDENTIAL;

    // Add a building with footprint [[2,2]].
    base.b = [{
      id: 0,
      type: 'residential',
      foot: [[2, 2]],
      anc: [2, 2],
      lvl: 1,
      den: 0,
      age: 0,
    }];

    const target = new World(4, 4, { regenerate: false });
    // Pre-mark target so we can verify no mutation occurred.
    target.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));

    expect(deserializeWorldInto(target, JSON.stringify(base))).toBe(false);
    // Target must be unchanged.
    expect(target.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(target.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });
});
