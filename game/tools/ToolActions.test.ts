import { describe, it, expect, beforeEach } from 'vitest';
import { buildToolCommands } from './ToolActions';
import { Tool } from './Tool';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { MAX_ELEVATION, SEA_LEVEL } from '../core/Terrain';

let world: World;

beforeEach(() => {
  world = new World(8, 8, { regenerate: false });
});

describe('buildToolCommands - normal tile tools', () => {
  it('ROAD emits a tile write on flat dry terrain', () => {
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world)).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ROAD) },
    ]);
  });

  it('ZONE rejects any-corner water terrain', () => {
    world.getTerrain().unsafeSetVertexHeight(1, 1, SEA_LEVEL);
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 1, y: 1 }], world)).toEqual([]);
  });

  it('BULLDOZE clears roads to DIRT only', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    expect(buildToolCommands(Tool.BULLDOZE, [{ x: 3, y: 3 }, { x: 4, y: 4 }], world)).toEqual([
      { kind: 'tile', x: 3, y: 3, tile: createTile(3, 3, TileType.DIRT) },
    ]);
  });
});

describe('buildToolCommands - TERRAIN_UP vertex edits', () => {
  it('click emits one vertex-edit command with 4 sorted unique vertex writes', () => {
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 3 }], world);
    expect(commands).toEqual([
      {
        kind: 'vertex-edit',
        direction: 'up',
        writes: [
          { vx: 2, vy: 3, height: 2 },
          { vx: 3, vy: 3, height: 2 },
          { vx: 2, vy: 4, height: 2 },
          { vx: 3, vy: 4, height: 2 },
        ],
      },
    ]);
  });

  it('drag command dedupes shared vertices and keeps row-major order', () => {
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 0, y: 0 }, { x: 1, y: 0 }], world);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ kind: 'vertex-edit', direction: 'up' });
    if (commands[0].kind !== 'vertex-edit') throw new Error('expected vertex edit');
    expect(commands[0].writes).toEqual([
      { vx: 0, vy: 0, height: 2 },
      { vx: 1, vy: 0, height: 2 },
      { vx: 2, vy: 0, height: 2 },
      { vx: 0, vy: 1, height: 2 },
      { vx: 1, vy: 1, height: 2 },
      { vx: 2, vy: 1, height: 2 },
    ]);
  });

  it('skips structured target tiles', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world)).toEqual([]);
  });

  it('skips capped vertices but keeps other valid vertices', () => {
    for (let vy = 1; vy <= 4; vy++) {
      for (let vx = 1; vx <= 4; vx++) {
        world.getTerrain().unsafeSetVertexHeight(vx, vy, 5);
      }
    }
    world.getTerrain().unsafeSetVertexHeight(2, 2, MAX_ELEVATION);
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world);
    expect(commands).toHaveLength(1);
    if (commands[0].kind !== 'vertex-edit') throw new Error('expected vertex edit');
    expect(commands[0].writes).not.toContainEqual({ vx: 2, vy: 2, height: MAX_ELEVATION + 1 });
    expect(commands[0].writes.length).toBeGreaterThan(0);
  });
});

describe('buildToolCommands - TERRAIN_DOWN vertex edits', () => {
  it('click emits one vertex-edit command lowering 4 vertices to sea level', () => {
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world);
    expect(commands).toEqual([
      {
        kind: 'vertex-edit',
        direction: 'down',
        writes: [
          { vx: 2, vy: 3, height: 0 },
          { vx: 3, vy: 3, height: 0 },
          { vx: 2, vy: 4, height: 0 },
          { vx: 3, vy: 4, height: 0 },
        ],
      },
    ]);
  });

  it('skips vertices whose edit would make a structured touching tile non-flat', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world);
    expect(commands).toHaveLength(1);
    if (commands[0].kind !== 'vertex-edit') throw new Error('expected vertex edit');
    expect(commands[0].writes).toEqual([
      { vx: 2, vy: 3, height: 0 },
      { vx: 2, vy: 4, height: 0 },
    ]);
  });
});
