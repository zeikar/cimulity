import { describe, it, expect, beforeEach } from 'vitest';
import { buildToolCommands, buildToolPreview, structureFootprint } from './ToolActions';
import { executeClick } from '../engine/CommandDispatcher';
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
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ROAD) },
    ]);
  });

  it('ZONE rejects any-corner water terrain', () => {
    world.getTerrain().unsafeSetVertexHeight(1, 1, SEA_LEVEL);
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 1, y: 1 }], world, { x: 1, y: 1 })).toEqual([]);
  });

  it('BULLDOZE clears roads to DIRT only', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    expect(buildToolCommands(Tool.BULLDOZE, [{ x: 3, y: 3 }, { x: 4, y: 4 }], world, { x: 3, y: 3 })).toEqual([
      { kind: 'tile', x: 3, y: 3, tile: createTile(3, 3, TileType.DIRT) },
    ]);
  });

  it('SELECT returns empty commands', () => {
    expect(buildToolCommands(Tool.SELECT, [{ x: 0, y: 0 }], world, { x: 0, y: 0 })).toEqual([]);
  });

  it('ZONE_COMMERCIAL emits a tile write on flat dry terrain', () => {
    expect(buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ZONE_COMMERCIAL) },
    ]);
  });

  it('ZONE_INDUSTRIAL emits a tile write on flat dry terrain', () => {
    expect(buildToolCommands(Tool.ZONE_INDUSTRIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ZONE_INDUSTRIAL) },
    ]);
  });

  it('ROAD skips tiles that already have a road', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ROAD skips zoned tiles', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ROAD places on a uniform N-S ramp (coplanar non-flat)', () => {
    // Tile (2,2): topH=(2,2)=1, rightH=(3,2)=1, bottomH=(3,3)=2, leftH=(2,3)=2
    // topH+bottomH=3 === leftH+rightH=3 → coplanar
    world.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ROAD) },
    ]);
  });

  it('ROAD places on a uniform E-W ramp (coplanar non-flat)', () => {
    // Tile (2,2): topH=(2,2)=1, rightH=(3,2)=2, bottomH=(3,3)=2, leftH=(2,3)=1
    // topH+bottomH=3 === leftH+rightH=3 → coplanar
    world.getTerrain().unsafeSetVertexHeight(3, 2, 2);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ROAD) },
    ]);
  });

  it('ROAD rejects triangle wedge (not coplanar)', () => {
    // Tile (2,2): topH=(2,2)=1, rightH=(3,2)=1, bottomH=(3,3)=2, leftH=(2,3)=1
    // topH+bottomH=3 !== leftH+rightH=2 → NOT coplanar
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ROAD still rejects any-corner water terrain', () => {
    world.getTerrain().unsafeSetVertexHeight(2, 2, SEA_LEVEL);
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_RESIDENTIAL places on a uniform N-S ramp (coplanar non-flat)', () => {
    // Same N-S ramp as ROAD test: topH+bottomH === leftH+rightH → coplanar
    world.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ZONE_RESIDENTIAL) },
    ]);
  });

  it('ZONE_RESIDENTIAL rejects triangle wedge', () => {
    // Only one corner elevated → not coplanar
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_COMMERCIAL places on coplanar ramp', () => {
    // N-S ramp: coplanar non-flat
    world.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    expect(buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ZONE_COMMERCIAL) },
    ]);
  });

  it('ZONE_INDUSTRIAL places on coplanar ramp', () => {
    // N-S ramp: coplanar non-flat
    world.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    expect(buildToolCommands(Tool.ZONE_INDUSTRIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([
      { kind: 'tile', x: 2, y: 2, tile: createTile(2, 2, TileType.ZONE_INDUSTRIAL) },
    ]);
  });
});

describe('buildToolCommands - ROAD drag transactional', () => {
  it('Test A (water in path): any-reject causes transactional empty result', () => {
    // Vertex (4,4)=0 → tile (3,3) has a water corner → classifyRoadTile returns reject
    world.getTerrain().unsafeSetVertexHeight(4, 4, SEA_LEVEL);
    const commands = buildToolCommands(Tool.ROAD, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], world, { x: 1, y: 1 });
    expect(commands).toEqual([]);
  });

  it('Test B (all valid): emits one ROAD command per tile in path order', () => {
    const commands = buildToolCommands(Tool.ROAD, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], world, { x: 0, y: 0 });
    expect(commands).toEqual([
      { kind: 'tile', x: 0, y: 0, tile: createTile(0, 0, TileType.ROAD) },
      { kind: 'tile', x: 1, y: 0, tile: createTile(1, 0, TileType.ROAD) },
      { kind: 'tile', x: 2, y: 0, tile: createTile(2, 0, TileType.ROAD) },
      { kind: 'tile', x: 3, y: 0, tile: createTile(3, 0, TileType.ROAD) },
    ]);
  });

  it('Test C (triangle wedge in path): any-reject causes transactional empty result', () => {
    // Vertex (3,3)=2 → tile (2,2): topH=1, rightH=1, bottomH=2, leftH=1
    // topH+bottomH=3 !== leftH+rightH=2 → NOT coplanar → classifyRoadTile returns reject
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    const commands = buildToolCommands(Tool.ROAD, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], world, { x: 0, y: 0 });
    expect(commands).toEqual([]);
  });

  it('Test D (zoned tile in path): any-reject causes transactional empty result', () => {
    world.getMap().setTile(2, 1, createTile(2, 1, TileType.ZONE_RESIDENTIAL));
    const commands = buildToolCommands(Tool.ROAD, [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], world, { x: 0, y: 1 });
    expect(commands).toEqual([]);
  });

  it('Test E (existing-road is skip, not reject): drag still commits remaining tiles', () => {
    // Pre-placed ROAD at (1,1) is a skip — does not trigger transactional rollback
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.ROAD));
    const commands = buildToolCommands(Tool.ROAD, [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], world, { x: 1, y: 1 });
    expect(commands).toEqual([
      { kind: 'tile', x: 2, y: 1, tile: createTile(2, 1, TileType.ROAD) },
      { kind: 'tile', x: 3, y: 1, tile: createTile(3, 1, TileType.ROAD) },
    ]);
  });
});

describe('buildToolCommands - ZONE partial regression', () => {
  it('Test F (mixed water+flat → partial): rejected tile is omitted, others still emit', () => {
    // Vertex (2,1)=0 touches tiles (1,0),(2,0),(1,1),(2,1).
    // Tile (1,1) min corner = 0 → water → reject.
    // Tiles (1,2) and (1,3) corners stay all at 1 → emit.
    world.getTerrain().unsafeSetVertexHeight(2, 1, SEA_LEVEL);
    const commands = buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], world, { x: 1, y: 1 });
    expect(commands).toEqual([
      { kind: 'tile', x: 1, y: 2, tile: createTile(1, 2, TileType.ZONE_RESIDENTIAL) },
      { kind: 'tile', x: 1, y: 3, tile: createTile(1, 3, TileType.ZONE_RESIDENTIAL) },
    ]);
  });

  it('Test G (same-type skip, different-type repaint): skip omits tile, repaint emits', () => {
    // (2,2) same type → skip; (3,2) ZONE_COMMERCIAL → repaint to ZONE_RESIDENTIAL → emit; (4,2) GRASS → emit
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ZONE_COMMERCIAL));
    const commands = buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }], world, { x: 2, y: 2 });
    expect(commands).toEqual([
      { kind: 'tile', x: 3, y: 2, tile: createTile(3, 2, TileType.ZONE_RESIDENTIAL) },
      { kind: 'tile', x: 4, y: 2, tile: createTile(4, 2, TileType.ZONE_RESIDENTIAL) },
    ]);
  });
});

describe('buildToolCommands - TERRAIN_UP vertex edits', () => {
  it('click emits one vertex-edit command with 4 sorted unique vertex writes', () => {
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 3 }], world, { x: 2, y: 3 });
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
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 0, y: 0 }, { x: 1, y: 0 }], world, { x: 0, y: 0 });
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
    expect(buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('skips capped vertices but keeps other valid vertices', () => {
    for (let vy = 1; vy <= 4; vy++) {
      for (let vx = 1; vx <= 4; vx++) {
        world.getTerrain().unsafeSetVertexHeight(vx, vy, 5);
      }
    }
    world.getTerrain().unsafeSetVertexHeight(2, 2, MAX_ELEVATION);
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(commands).toHaveLength(1);
    if (commands[0].kind !== 'vertex-edit') throw new Error('expected vertex edit');
    expect(commands[0].writes).not.toContainEqual({ vx: 2, vy: 2, height: MAX_ELEVATION + 1 });
    expect(commands[0].writes.length).toBeGreaterThan(0);
  });
});
describe('buildToolCommands - TERRAIN_DOWN vertex edits', () => {
  it('click emits one vertex-edit command lowering 4 vertices to sea level', () => {
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world, { x: 2, y: 3 });
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
    const commands = buildToolCommands(Tool.TERRAIN_DOWN, [{ x: 2, y: 3 }], world, { x: 2, y: 3 });
    expect(commands).toHaveLength(1);
    if (commands[0].kind !== 'vertex-edit') throw new Error('expected vertex edit');
    expect(commands[0].writes).toEqual([
      { vx: 2, vy: 3, height: 0 },
      { vx: 2, vy: 4, height: 0 },
    ]);
  });
});

describe('buildToolCommands - TERRAIN_LEVEL vertex edits', () => {
  it('Test 1: no-op on flat tile — all corners already at target', () => {
    // Default world: every vertex at MIN_LAND_ELEVATION=1.
    // Tile (2,2) corners all=1, target=1. All vertices already at target → no writes.
    const commands = buildToolCommands(Tool.TERRAIN_LEVEL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(commands).toEqual([]);
  });

  it('Test 2: mixed corners step toward target on a single tile', () => {
    // Tile (2,2) corners: (2,2)=3, (3,2)=4, (2,3)=5, (3,3)=5.
    // Pad ring so that writing to 3 passes canPlayerSetVertexHeight.
    world.getTerrain().unsafeSetVertexHeight(2, 2, 3);
    world.getTerrain().unsafeSetVertexHeight(3, 2, 4);
    world.getTerrain().unsafeSetVertexHeight(2, 3, 5);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 5);
    // Pad 8-neighborhood ring (vertices outside this ring keep the default
    // MIN_LAND_ELEVATION=1; |1-3|=2 ≤ cap, so writes to height 3 stay legal).
    world.getTerrain().unsafeSetVertexHeight(1, 1, 3);
    world.getTerrain().unsafeSetVertexHeight(2, 1, 3);
    world.getTerrain().unsafeSetVertexHeight(3, 1, 3);
    world.getTerrain().unsafeSetVertexHeight(4, 1, 3);
    world.getTerrain().unsafeSetVertexHeight(1, 2, 3);
    world.getTerrain().unsafeSetVertexHeight(4, 2, 3);
    world.getTerrain().unsafeSetVertexHeight(1, 3, 3);
    world.getTerrain().unsafeSetVertexHeight(4, 3, 3);
    world.getTerrain().unsafeSetVertexHeight(2, 4, 3);
    world.getTerrain().unsafeSetVertexHeight(3, 4, 3);
    world.getTerrain().unsafeSetVertexHeight(4, 4, 3);
    // target = min(3,4,5,5) = 3. Vertex (2,2) skipped (h===target).
    const commands = buildToolCommands(Tool.TERRAIN_LEVEL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(commands).toEqual([
      {
        kind: 'vertex-edit',
        direction: 'level',
        writes: [
          { vx: 3, vy: 2, height: 3 },
          { vx: 2, vy: 3, height: 3 },
          { vx: 3, vy: 3, height: 3 },
        ],
      },
    ]);
  });

  it('Test 3: uniform drag is no-op — all vertices already at target', () => {
    // Default world all at 1. DragStart tile (0,0), target=1. Two tiles, all corners at 1.
    const commands = buildToolCommands(
      Tool.TERRAIN_LEVEL,
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      world,
      { x: 0, y: 0 }
    );
    expect(commands).toEqual([]);
  });

  it('Test 4: drag across 1×2 strip levels east vertices to target', () => {
    // Tile (0,0) corners all=2 (left strip). Tile (1,0) east corners=5.
    world.getTerrain().unsafeSetVertexHeight(0, 0, 2);
    world.getTerrain().unsafeSetVertexHeight(1, 0, 2);
    world.getTerrain().unsafeSetVertexHeight(0, 1, 2);
    world.getTerrain().unsafeSetVertexHeight(1, 1, 2);
    world.getTerrain().unsafeSetVertexHeight(2, 0, 5);
    world.getTerrain().unsafeSetVertexHeight(2, 1, 5);
    // Pad so canPlayerSetVertexHeight admits writing (2,0)=2 and (2,1)=2.
    // (2,0) neighbors: (1,0)=2,(3,0),(1,1)=2,(2,1)=5,(3,1). |5-2|=3 ✓, default 1→|1-2|=1 ✓.
    world.getTerrain().unsafeSetVertexHeight(3, 0, 5);
    world.getTerrain().unsafeSetVertexHeight(3, 1, 5);
    world.getTerrain().unsafeSetVertexHeight(3, 2, 5);
    world.getTerrain().unsafeSetVertexHeight(2, 2, 5);
    world.getTerrain().unsafeSetVertexHeight(1, 2, 2);
    world.getTerrain().unsafeSetVertexHeight(0, 2, 2);
    // target = min(tile(0,0)) = min(2,2,2,2) = 2.
    // (2,0) and (2,1) step from 5→2 (|5-2|=3 ≤ cap); others already at 2 → skip.
    const commands = buildToolCommands(
      Tool.TERRAIN_LEVEL,
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      world,
      { x: 0, y: 0 }
    );
    expect(commands).toEqual([
      {
        kind: 'vertex-edit',
        direction: 'level',
        writes: [
          { vx: 2, vy: 0, height: 2 },
          { vx: 2, vy: 1, height: 2 },
        ],
      },
    ]);
  });

  it('Test 5: closest legal value on graded cliffs — Pass A, re-grade between, then Pass B', () => {
    // Build a graded cliff: peak (2,2)=8, inner ring=5, outer ring=2.
    world.getTerrain().unsafeSetVertexHeight(2, 2, 8);
    for (const [vx, vy] of [[1,1],[2,1],[3,1],[1,2],[3,2],[1,3],[2,3],[3,3]] as const) {
      world.getTerrain().unsafeSetVertexHeight(vx, vy, 5);
    }
    for (const [vx, vy] of [
      [0,0],[1,0],[2,0],[3,0],[4,0],
      [0,1],[4,1],
      [0,2],[4,2],
      [0,3],[4,3],
      [0,4],[1,4],[2,4],[3,4],[4,4],
    ] as const) {
      world.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
    }

    // Pass A: executeClick on tile (1,1). Corners: (1,1)=5,(2,1)=5,(2,2)=8,(1,2)=5. target=5.
    // (2,2)=8 → search from 5 toward 8: try 5. All 8-neighbors of (2,2) are 5 → |5-5|=0 ≤3. Legal.
    const resultA = executeClick(Tool.TERRAIN_LEVEL, { x: 1, y: 1 }, world);
    expect(resultA.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getVertexHeight(2, 2)).toBe(5);

    // Pass B setup: re-grade (2,2)'s 8-neighbors to 2. (2,2) is now 5 after Pass A.
    for (const [vx, vy] of [[1,1],[2,1],[3,1],[1,2],[3,2],[1,3],[2,3],[3,3]] as const) {
      world.getTerrain().unsafeSetVertexHeight(vx, vy, 2);
    }
    // Pass B: tile (1,1) corners: (1,1)=2,(2,1)=2,(2,2)=5,(1,2)=2. target=2.
    // (2,2)=5 → search from 2 toward 5: try 2. Neighbors all=2 → |2-2|=0 ≤3. Legal.
    const resultB = executeClick(Tool.TERRAIN_LEVEL, { x: 1, y: 1 }, world);
    expect(resultB.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getVertexHeight(2, 2)).toBe(2);
  });

  it('Test 6: shared vertex that would break adjacent road flatness is dropped (layer-b reject)', () => {
    // Install ROAD at (3,3).
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    // Grid setup (graded from 0 in the low-left to 3 in the upper-right region).
    // Row y=0
    world.getTerrain().unsafeSetVertexHeight(0, 0, 0);
    world.getTerrain().unsafeSetVertexHeight(1, 0, 0);
    world.getTerrain().unsafeSetVertexHeight(2, 0, 0);
    world.getTerrain().unsafeSetVertexHeight(3, 0, 0);
    world.getTerrain().unsafeSetVertexHeight(4, 0, 0);
    world.getTerrain().unsafeSetVertexHeight(5, 0, 3);
    // Row y=1
    world.getTerrain().unsafeSetVertexHeight(0, 1, 0);
    world.getTerrain().unsafeSetVertexHeight(1, 1, 0);
    world.getTerrain().unsafeSetVertexHeight(2, 1, 0);
    world.getTerrain().unsafeSetVertexHeight(3, 1, 0);
    world.getTerrain().unsafeSetVertexHeight(4, 1, 3);
    world.getTerrain().unsafeSetVertexHeight(5, 1, 3);
    // Row y=2
    world.getTerrain().unsafeSetVertexHeight(0, 2, 0);
    world.getTerrain().unsafeSetVertexHeight(1, 2, 0);
    world.getTerrain().unsafeSetVertexHeight(2, 2, 0);
    world.getTerrain().unsafeSetVertexHeight(3, 2, 3);
    world.getTerrain().unsafeSetVertexHeight(4, 2, 3);
    world.getTerrain().unsafeSetVertexHeight(5, 2, 3);
    // Row y=3
    world.getTerrain().unsafeSetVertexHeight(0, 3, 0);
    world.getTerrain().unsafeSetVertexHeight(1, 3, 0);
    world.getTerrain().unsafeSetVertexHeight(2, 3, 3);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 3);
    world.getTerrain().unsafeSetVertexHeight(4, 3, 3);
    world.getTerrain().unsafeSetVertexHeight(5, 3, 3);
    // Row y=4
    world.getTerrain().unsafeSetVertexHeight(0, 4, 0);
    world.getTerrain().unsafeSetVertexHeight(1, 4, 0);
    world.getTerrain().unsafeSetVertexHeight(2, 4, 3);
    world.getTerrain().unsafeSetVertexHeight(3, 4, 3);
    world.getTerrain().unsafeSetVertexHeight(4, 4, 3);
    world.getTerrain().unsafeSetVertexHeight(5, 4, 3);
    // Row y=5
    world.getTerrain().unsafeSetVertexHeight(0, 5, 0);
    world.getTerrain().unsafeSetVertexHeight(1, 5, 0);
    world.getTerrain().unsafeSetVertexHeight(2, 5, 3);
    world.getTerrain().unsafeSetVertexHeight(3, 5, 3);
    world.getTerrain().unsafeSetVertexHeight(4, 5, 3);
    world.getTerrain().unsafeSetVertexHeight(5, 5, 3);
    // Tile (2,2) corners: (2,2)=0,(3,2)=3,(2,3)=3,(3,3)=3. target=0.
    // (3,3) is the road's NW corner; writing 0 there would make road non-flat → dropped.
    const commands = buildToolCommands(
      Tool.TERRAIN_LEVEL,
      [{ x: 2, y: 2 }],
      world,
      { x: 2, y: 2 }
    );
    expect(commands).toEqual([
      {
        kind: 'vertex-edit',
        direction: 'level',
        writes: [
          { vx: 3, vy: 2, height: 0 },
          { vx: 2, vy: 3, height: 0 },
        ],
      },
    ]);
    // Road tile is still there (builder does not mutate).
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.ROAD);
  });

  it('Test 7: layer-a source-cell skip + layer-b shared-vertex reject across 2×2 drag rect', () => {
    // Install zone at (2,2) with all corners flat at 2.
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.getTerrain().unsafeSetVertexHeight(2, 2, 2);
    world.getTerrain().unsafeSetVertexHeight(3, 2, 2);
    world.getTerrain().unsafeSetVertexHeight(2, 3, 2);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    // Non-zone tile (1,1) non-shared corner=1 (default); shared corners at 2.
    world.getTerrain().unsafeSetVertexHeight(2, 1, 2);
    world.getTerrain().unsafeSetVertexHeight(1, 2, 2);
    // Pad ring (already at default 1, but set explicitly for clarity):
    world.getTerrain().unsafeSetVertexHeight(3, 1, 1);
    world.getTerrain().unsafeSetVertexHeight(4, 1, 1);
    world.getTerrain().unsafeSetVertexHeight(4, 2, 1);
    world.getTerrain().unsafeSetVertexHeight(4, 3, 1);
    world.getTerrain().unsafeSetVertexHeight(1, 3, 1);
    world.getTerrain().unsafeSetVertexHeight(0, 3, 1);
    world.getTerrain().unsafeSetVertexHeight(2, 4, 1);
    world.getTerrain().unsafeSetVertexHeight(3, 4, 1);
    world.getTerrain().unsafeSetVertexHeight(4, 4, 1);
    // Drag rect [(1,1),(2,1),(1,2),(2,2)], dragStart=(1,1).
    // target = min(tile(1,1)) = min((1,1)=1,(2,1)=2,(2,2)=2,(1,2)=2) = 1.
    // Layer (a): tile(2,2) structured → no vertices from it; (3,3) not contributed.
    // Layer (b): shared zone corners (2,2),(3,2),(2,3) would break zone flatness → dropped.
    // (2,1)=2→1 and (1,2)=2→1 are legal and not zone-protected.
    const commands = buildToolCommands(
      Tool.TERRAIN_LEVEL,
      [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
      world,
      { x: 1, y: 1 }
    );
    expect(commands).toEqual([
      {
        kind: 'vertex-edit',
        direction: 'level',
        writes: [
          { vx: 2, vy: 1, height: 1 },
          { vx: 1, vy: 2, height: 1 },
        ],
      },
    ]);
  });

  it('Test 8: vertex lowering crosses SEA_LEVEL — builder output only, no reconcile', () => {
    // Tile (2,2) corners: (2,2)=0 (target), (3,2)=3, (2,3)=3, (3,3)=3.
    // Default neighbors are all 1; |1-0|=1 ≤3 and |3-0|=3 ≤3 → cap satisfied.
    world.getTerrain().unsafeSetVertexHeight(2, 2, 0);
    world.getTerrain().unsafeSetVertexHeight(3, 2, 3);
    world.getTerrain().unsafeSetVertexHeight(2, 3, 3);
    world.getTerrain().unsafeSetVertexHeight(3, 3, 3);
    // target = min(0,3,3,3) = 0. (2,2) already at 0 → skip. Others lower from 3→0.
    const commands = buildToolCommands(
      Tool.TERRAIN_LEVEL,
      [{ x: 2, y: 2 }],
      world,
      { x: 2, y: 2 }
    );
    expect(commands).toEqual([
      {
        kind: 'vertex-edit',
        direction: 'level',
        writes: [
          { vx: 3, vy: 2, height: 0 },
          { vx: 2, vy: 3, height: 0 },
          { vx: 3, vy: 3, height: 0 },
        ],
      },
    ]);
  });
});

describe('buildToolCommands - POWER_PLANT cell rejection', () => {
  it('ROAD rejects a single POWER_PLANT tile (transactional: returns empty)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ROAD rejects a mixed path containing a POWER_PLANT tile (transactional: all-or-nothing)', () => {
    world.getMap().setTile(2, 0, createTile(2, 0, TileType.POWER_PLANT));
    expect(buildToolCommands(Tool.ROAD, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], world, { x: 0, y: 0 })).toEqual([]);
  });

  it('ZONE_RESIDENTIAL rejects a POWER_PLANT tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_COMMERCIAL rejects a POWER_PLANT tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    expect(buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_INDUSTRIAL rejects a POWER_PLANT tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    expect(buildToolCommands(Tool.ZONE_INDUSTRIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('TERRAIN_UP skips a POWER_PLANT cell — no vertex writes for that tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    expect(buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('TERRAIN_UP skips POWER_PLANT cells in a mixed path and raises vertices for non-POWER_PLANT cells only', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }, { x: 3, y: 2 }], world, { x: 2, y: 2 });
    expect(commands).toHaveLength(1);
    if (commands[0].kind !== 'vertex-edit') throw new Error('expected vertex-edit');
    const writtenVertices = commands[0].writes.map(w => `${w.vx},${w.vy}`);
    expect(writtenVertices).toContain('4,2');
    expect(writtenVertices).toContain('4,3');
  });
});

describe('buildToolCommands - POWER_PLANT placement', () => {
  it('accepts on flat grass with no obstacles — emits one place-structure command', () => {
    // World is 8×8 flat grass by default (regenerate: false).
    const result = buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toEqual([{ kind: 'place-structure', x: 2, y: 2, structureType: 'power_plant' }]);
  });

  it('rejects when the 2×2 extends out of bounds (anchor at width-1, height-1)', () => {
    // 8×8 map — anchor at (7,7) means (8,8) OOB.
    const result = buildToolCommands(Tool.POWER_PLANT, [{ x: 7, y: 7 }], world, { x: 7, y: 7 });
    expect(result).toEqual([]);
  });

  it('rejects when any of the 4 cells is a road', () => {
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any of the 4 cells is a zone tile', () => {
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ZONE_RESIDENTIAL));
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any of the 4 cells is DIRT', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any of the 4 cells is already POWER_PLANT', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any cell is owned by a building', () => {
    // Place a building that occupies (3,3).
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
    const placed = world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 3, y: 3 }],
      anchor: { x: 3, y: 3 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 3, y: 3, w: 1, h: 1 },
    });
    expect(placed).not.toBeNull();
    // Anchor at (2,2) — cells (3,3) is owned by the building.
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any cell is owned by an existing structure', () => {
    // Place a structure at (2,2)–(3,3).
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.POWER_PLANT));
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.POWER_PLANT));
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.POWER_PLANT));
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });
    // Overlapping anchor — (2,2) is occupied.
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
    // Partially overlapping anchor — (3,3) is occupied.
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 3, y: 3 }], world, { x: 3, y: 3 })).toEqual([]);
  });

  it('rejects when the 2×2 fails canBuildAt (non-flat slab)', () => {
    // Raise one corner inside the 2×2 footprint to break flatness.
    world.getTerrain().unsafeSetVertexHeight(3, 3, 3);
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });
});

describe('buildToolPreview - POWER_PLANT', () => {
  it('populates rejected=[] for accepted placement', () => {
    const preview = buildToolPreview(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('populates rejected=[tile] for rejected placement (OOB)', () => {
    const preview = buildToolPreview(Tool.POWER_PLANT, [{ x: 7, y: 7 }], world);
    expect(preview.rejected).toEqual([{ x: 7, y: 7 }]);
    expect(preview.pathTiles).toEqual([{ x: 7, y: 7 }]);
  });

  it('populates rejected=[tile] when anchor cell is road', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const preview = buildToolPreview(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([{ x: 2, y: 2 }]);
  });

  it('returns empty rejected for empty tiles array', () => {
    const preview = buildToolPreview(Tool.POWER_PLANT, [], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([]);
  });
});

describe('buildToolCommands - BULLDOZE with POWER_PLANT', () => {
  function placePlant(w: World, ax: number, ay: number): void {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        w.getMap().setTile(ax + dx, ay + dy, createTile(ax + dx, ay + dy, TileType.POWER_PLANT));
      }
    }
    w.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [
        { x: ax,     y: ay     },
        { x: ax + 1, y: ay     },
        { x: ax,     y: ay + 1 },
        { x: ax + 1, y: ay + 1 },
      ],
      anchor: { x: ax, y: ay },
    });
  }

  it('single plant cell → 1 remove-structure command', () => {
    placePlant(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('3 of 4 plant cells → exactly 1 remove-structure command (dedup)', () => {
    placePlant(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
    ], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('two separate plants → 2 remove-structure commands', () => {
    placePlant(world, 0, 0);
    placePlant(world, 4, 4);
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 0, y: 0 }, { x: 4, y: 4 },
    ], world, { x: 0, y: 0 });
    expect(result).toHaveLength(2);
    expect(result.every(c => c.kind === 'remove-structure')).toBe(true);
    // Each references a different structure id.
    if (result[0].kind === 'remove-structure' && result[1].kind === 'remove-structure') {
      expect(result[0].structureId).not.toBe(result[1].structureId);
    }
  });

  it('mixed batch (1 road + 2 plant cells + 1 grass) → 1 tile→DIRT for road + 1 remove-structure for plant', () => {
    placePlant(world, 2, 2);
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 0, y: 0 }, // road
      { x: 2, y: 2 }, // plant cell 1
      { x: 3, y: 2 }, // plant cell 2
      { x: 5, y: 5 }, // grass — untouched
    ], world, { x: 0, y: 0 });
    const tileCommands = result.filter(c => c.kind === 'tile');
    const removeCommands = result.filter(c => c.kind === 'remove-structure');
    expect(tileCommands).toHaveLength(1);
    expect(removeCommands).toHaveLength(1);
    if (tileCommands[0].kind === 'tile') {
      expect(tileCommands[0].tile.type).toBe(TileType.DIRT);
    }
  });
});

describe('buildToolPreview - BULLDOZE with POWER_PLANT', () => {
  function placePlant(w: World, ax: number, ay: number): void {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        w.getMap().setTile(ax + dx, ay + dy, createTile(ax + dx, ay + dy, TileType.POWER_PLANT));
      }
    }
    w.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [
        { x: ax,     y: ay     },
        { x: ax + 1, y: ay     },
        { x: ax,     y: ay + 1 },
        { x: ax + 1, y: ay + 1 },
      ],
      anchor: { x: ax, y: ay },
    });
  }

  it('POWER_PLANT cells are NOT classified as rejected in BULLDOZE preview', () => {
    placePlant(world, 2, 2);
    const preview = buildToolPreview(Tool.BULLDOZE, [{ x: 2, y: 2 }, { x: 3, y: 2 }], world);
    expect(preview.rejected).toEqual([]);
  });

  it('affectedBuildingIds does not include the plant', () => {
    placePlant(world, 2, 2);
    const preview = buildToolPreview(Tool.BULLDOZE, [{ x: 2, y: 2 }], world);
    expect(preview.affectedBuildingIds.size).toBe(0);
  });
});

describe('structureFootprint helper', () => {
  it('returns 1 expected cell for water_tower', () => {
    const cells = structureFootprint({ x: 2, y: 3 }, 'water_tower');
    expect(cells).toHaveLength(1);
    expect(cells).toContainEqual({ x: 2, y: 3 });
  });

  it('returns 4 expected cells for power_plant (regression guard)', () => {
    const cells = structureFootprint({ x: 1, y: 1 }, 'power_plant');
    expect(cells).toHaveLength(4);
    expect(cells).toContainEqual({ x: 1, y: 1 });
    expect(cells).toContainEqual({ x: 2, y: 1 });
    expect(cells).toContainEqual({ x: 1, y: 2 });
    expect(cells).toContainEqual({ x: 2, y: 2 });
  });
});

describe('buildToolCommands - WATER_TOWER cell rejection', () => {
  beforeEach(() => {
    // Place a 1×1 WATER_TOWER at (2,2) for rejection tests.
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.WATER_TOWER));
  });

  it('ROAD returns [] when target is WATER_TOWER (transactional)', () => {
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ROAD rejects a mixed path containing a WATER_TOWER tile (transactional: all-or-nothing)', () => {
    expect(buildToolCommands(Tool.ROAD, [{ x: 0, y: 0 }, { x: 2, y: 2 }], world, { x: 0, y: 0 })).toEqual([]);
  });

  it('ZONE_RESIDENTIAL returns [] over WATER_TOWER', () => {
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_COMMERCIAL returns [] over WATER_TOWER', () => {
    expect(buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_INDUSTRIAL returns [] over WATER_TOWER', () => {
    expect(buildToolCommands(Tool.ZONE_INDUSTRIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('TERRAIN_UP produces no vertex writes touching tower cells', () => {
    // WATER_TOWER cells are structured — terrain tool skips them entirely.
    expect(buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('TERRAIN_UP skips WATER_TOWER cells in a mixed path', () => {
    // (2,2) is WATER_TOWER (structured-cell skip); (5,5) is plain grass — gets raised.
    const commands = buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }, { x: 5, y: 5 }], world, { x: 2, y: 2 });
    expect(commands).toHaveLength(1);
    if (commands[0].kind !== 'vertex-edit') throw new Error('expected vertex-edit');
    // Vertices from (5,5) should be present.
    const written = commands[0].writes.map(({ vx, vy }) => `${vx},${vy}`);
    expect(written).toContain('5,5');
    // Vertices exclusive to the WATER_TOWER tile at (2,2) must NOT appear: (2,2) is the
    // shared vertex at the NW corner of tile (2,2). It must not be written because the
    // terrain tool skips tiles whose TileType is a structured type.
    // Note: vertices are skipped at the tile level; (2,2)…(3,3) vertices could still appear
    // if they are shared with the non-tower tile at (5,5). Since (5,5) is far away, they won't.
    expect(written).not.toContain('2,2');
  });
});

describe('buildToolCommands - WATER_TOWER placement', () => {
  it('accepts on flat grass with no obstacles — emits one place-structure command', () => {
    const result = buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toEqual([{ kind: 'place-structure', x: 2, y: 2, structureType: 'water_tower' }]);
  });

  it('rejects when the anchor itself is out of bounds (anchor at x=width)', () => {
    // 1×1 tower — only the anchor cell matters. A last in-bounds cell (7,7) is VALID.
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 7, y: 7 }], world, { x: 7, y: 7 })).not.toEqual([]);
    // Anchor at x=8 (=width) is out of bounds → rejected.
    const result = buildToolCommands(Tool.WATER_TOWER, [{ x: 8, y: 0 }], world, { x: 8, y: 0 });
    expect(result).toEqual([]);
  });

  it('rejects when the cell is a road', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the cell is a zone tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the cell is DIRT', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the cell is already WATER_TOWER', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.WATER_TOWER));
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the cell is already POWER_PLANT', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POWER_PLANT));
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the cell is owned by a building', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    const placed = world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });
    expect(placed).not.toBeNull();
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the cell is owned by an existing structure', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.WATER_TOWER));
    world.getStructureMap().addStructure({
      type: 'water_tower',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
    });
    // Same cell is occupied → rejected.
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the 1×1 anchor cell fails canBuildAt (non-flat slab)', () => {
    world.getTerrain().unsafeSetVertexHeight(3, 3, 3);
    expect(buildToolCommands(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });
});

describe('buildToolPreview - WATER_TOWER', () => {
  it('populates rejected=[] for accepted placement', () => {
    const preview = buildToolPreview(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('populates rejected=[tile] for rejected placement (non-grass tile)', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    const preview = buildToolPreview(Tool.WATER_TOWER, [{ x: 3, y: 3 }], world);
    expect(preview.rejected).toEqual([{ x: 3, y: 3 }]);
    expect(preview.pathTiles).toEqual([{ x: 3, y: 3 }]);
  });

  it('populates rejected=[tile] when anchor cell is road', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const preview = buildToolPreview(Tool.WATER_TOWER, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([{ x: 2, y: 2 }]);
  });

  it('returns empty rejected for empty tiles array', () => {
    const preview = buildToolPreview(Tool.WATER_TOWER, [], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([]);
  });
});

describe('buildToolCommands - BULLDOZE with WATER_TOWER', () => {
  function placeTower(w: World, ax: number, ay: number): void {
    w.getMap().setTile(ax, ay, createTile(ax, ay, TileType.WATER_TOWER));
    w.getStructureMap().addStructure({
      type: 'water_tower',
      footprint: [
        { x: ax, y: ay },
      ],
      anchor: { x: ax, y: ay },
    });
  }

  it('single tower cell → 1 remove-structure command', () => {
    placeTower(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('drag over the tower single cell still emits exactly 1 remove-structure command (dedup)', () => {
    // Even when the same 1-cell tower appears multiple times in the drag selection,
    // dedup logic ensures only 1 remove-structure command is emitted.
    placeTower(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 2, y: 2 },
    ], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('one tower + one plant in one drag → two remove-structure commands', () => {
    placeTower(world, 0, 0);
    // Manually place power plant at (4,4)
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        world.getMap().setTile(4 + dx, 4 + dy, createTile(4 + dx, 4 + dy, TileType.POWER_PLANT));
      }
    }
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 5 }],
      anchor: { x: 4, y: 4 },
    });
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 0, y: 0 }, { x: 4, y: 4 },
    ], world, { x: 0, y: 0 });
    expect(result).toHaveLength(2);
    expect(result.every(c => c.kind === 'remove-structure')).toBe(true);
    if (result[0].kind === 'remove-structure' && result[1].kind === 'remove-structure') {
      expect(result[0].structureId).not.toBe(result[1].structureId);
    }
  });

  it('mixed batch (road + tower cell) → 1 tile→DIRT + 1 remove-structure', () => {
    placeTower(world, 2, 2);
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 0, y: 0 }, // road
      { x: 2, y: 2 }, // tower cell
    ], world, { x: 0, y: 0 });
    const tileCommands = result.filter(c => c.kind === 'tile');
    const removeCommands = result.filter(c => c.kind === 'remove-structure');
    expect(tileCommands).toHaveLength(1);
    expect(removeCommands).toHaveLength(1);
    if (tileCommands[0].kind === 'tile') {
      expect(tileCommands[0].tile.type).toBe(TileType.DIRT);
    }
  });
});

describe('buildToolCommands - POWER_PLANT regression after structureFootprint repoint', () => {
  it('still emits place-structure on flat grass', () => {
    const result = buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toEqual([{ kind: 'place-structure', x: 2, y: 2, structureType: 'power_plant' }]);
  });

  it('still rejects when 2×2 is out of bounds', () => {
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 7, y: 7 }], world, { x: 7, y: 7 })).toEqual([]);
  });

  it('still rejects when a cell is not grass', () => {
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.POWER_PLANT, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });
});

describe('buildToolCommands - POLICE_STATION placement', () => {
  it('accepts on flat 2×2 grass with no obstacles — emits one place-structure command', () => {
    // World is 8×8 flat grass by default (regenerate: false).
    const result = buildToolCommands(Tool.POLICE_STATION, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toEqual([{ kind: 'place-structure', x: 2, y: 2, structureType: 'police_station' }]);
  });

  it('rejects when the 2×2 extends out of bounds (anchor at width-1, height-1)', () => {
    // 8×8 map — anchor at (7,7) means (8,8) OOB.
    const result = buildToolCommands(Tool.POLICE_STATION, [{ x: 7, y: 7 }], world, { x: 7, y: 7 });
    expect(result).toEqual([]);
  });

  it('rejects when any of the 4 cells is a road (non-grass)', () => {
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.POLICE_STATION, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any of the 4 cells is a zone tile', () => {
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ZONE_RESIDENTIAL));
    expect(buildToolCommands(Tool.POLICE_STATION, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the footprint overlaps an existing structure', () => {
    // Existing power plant at (2,2)..(3,3) — overlaps a police station anchored at (3,3).
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        world.getMap().setTile(2 + dx, 2 + dy, createTile(2 + dx, 2 + dy, TileType.POWER_PLANT));
      }
    }
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });
    expect(buildToolCommands(Tool.POLICE_STATION, [{ x: 3, y: 3 }], world, { x: 3, y: 3 })).toEqual([]);
  });
});

describe('buildToolPreview - POLICE_STATION', () => {
  it('populates rejected=[] for accepted placement', () => {
    const preview = buildToolPreview(Tool.POLICE_STATION, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('populates rejected=[tile] for rejected placement (non-grass cell in footprint)', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    const preview = buildToolPreview(Tool.POLICE_STATION, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([{ x: 2, y: 2 }]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('buildToolCommands - BULLDOZE with POLICE_STATION', () => {
  function placeStation(w: World, ax: number, ay: number): void {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        w.getMap().setTile(ax + dx, ay + dy, createTile(ax + dx, ay + dy, TileType.POLICE_STATION));
      }
    }
    w.getStructureMap().addStructure({
      type: 'police_station',
      footprint: [{ x: ax, y: ay }, { x: ax + 1, y: ay }, { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 }],
      anchor: { x: ax, y: ay },
    });
  }

  it('single station cell → 1 remove-structure command', () => {
    placeStation(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('drag over 3 of 4 station cells → exactly 1 remove-structure command (dedup)', () => {
    placeStation(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
    ], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });
});

describe('buildToolCommands - FIRE_STATION placement', () => {
  it('accepts on flat 2×2 grass with no obstacles — emits one place-structure command', () => {
    // World is 8×8 flat grass by default (regenerate: false).
    const result = buildToolCommands(Tool.FIRE_STATION, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toEqual([{ kind: 'place-structure', x: 2, y: 2, structureType: 'fire_station' }]);
  });

  it('rejects when the 2×2 extends out of bounds (anchor at width-1, height-1)', () => {
    // 8×8 map — anchor at (7,7) means (8,8) OOB.
    const result = buildToolCommands(Tool.FIRE_STATION, [{ x: 7, y: 7 }], world, { x: 7, y: 7 });
    expect(result).toEqual([]);
  });

  it('rejects when any of the 4 cells is a road (non-grass)', () => {
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.FIRE_STATION, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any of the 4 cells is a zone tile', () => {
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ZONE_RESIDENTIAL));
    expect(buildToolCommands(Tool.FIRE_STATION, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the footprint overlaps an existing structure', () => {
    // Existing power plant at (2,2)..(3,3) — overlaps a fire station anchored at (3,3).
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        world.getMap().setTile(2 + dx, 2 + dy, createTile(2 + dx, 2 + dy, TileType.POWER_PLANT));
      }
    }
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });
    expect(buildToolCommands(Tool.FIRE_STATION, [{ x: 3, y: 3 }], world, { x: 3, y: 3 })).toEqual([]);
  });
});

describe('buildToolPreview - FIRE_STATION', () => {
  it('populates rejected=[] for accepted placement', () => {
    const preview = buildToolPreview(Tool.FIRE_STATION, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('populates rejected=[tile] for rejected placement (non-grass cell in footprint)', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    const preview = buildToolPreview(Tool.FIRE_STATION, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([{ x: 2, y: 2 }]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('buildToolCommands - HOSPITAL placement', () => {
  it('accepts on flat 2×2 grass with no obstacles — emits one place-structure command', () => {
    // World is 8×8 flat grass by default (regenerate: false).
    const result = buildToolCommands(Tool.HOSPITAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toEqual([{ kind: 'place-structure', x: 2, y: 2, structureType: 'hospital' }]);
  });

  it('rejects when the 2×2 extends out of bounds (anchor at width-1, height-1)', () => {
    // 8×8 map — anchor at (7,7) means (8,8) OOB.
    const result = buildToolCommands(Tool.HOSPITAL, [{ x: 7, y: 7 }], world, { x: 7, y: 7 });
    expect(result).toEqual([]);
  });

  it('rejects when any of the 4 cells is a road (non-grass)', () => {
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.HOSPITAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any of the 4 cells is a zone tile', () => {
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ZONE_RESIDENTIAL));
    expect(buildToolCommands(Tool.HOSPITAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the footprint overlaps an existing structure', () => {
    // Existing power plant at (2,2)..(3,3) — overlaps a hospital anchored at (3,3).
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        world.getMap().setTile(2 + dx, 2 + dy, createTile(2 + dx, 2 + dy, TileType.POWER_PLANT));
      }
    }
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });
    expect(buildToolCommands(Tool.HOSPITAL, [{ x: 3, y: 3 }], world, { x: 3, y: 3 })).toEqual([]);
  });
});

describe('buildToolPreview - HOSPITAL', () => {
  it('populates rejected=[] for accepted placement', () => {
    const preview = buildToolPreview(Tool.HOSPITAL, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('populates rejected=[tile] for rejected placement (non-grass cell in footprint)', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    const preview = buildToolPreview(Tool.HOSPITAL, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([{ x: 2, y: 2 }]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('buildToolCommands - FIRE_STATION cell protections', () => {
  it('ROAD rejects a single FIRE_STATION tile (transactional: returns empty)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.FIRE_STATION));
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_RESIDENTIAL rejects a FIRE_STATION tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.FIRE_STATION));
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_COMMERCIAL rejects a FIRE_STATION tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.FIRE_STATION));
    expect(buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_INDUSTRIAL rejects a FIRE_STATION tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.FIRE_STATION));
    expect(buildToolCommands(Tool.ZONE_INDUSTRIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('TERRAIN_UP skips a FIRE_STATION cell — no vertex writes for that tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.FIRE_STATION));
    expect(buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });
});

describe('buildToolCommands - BULLDOZE with FIRE_STATION', () => {
  function placeFireStation(w: World, ax: number, ay: number): void {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        w.getMap().setTile(ax + dx, ay + dy, createTile(ax + dx, ay + dy, TileType.FIRE_STATION));
      }
    }
    w.getStructureMap().addStructure({
      type: 'fire_station',
      footprint: [{ x: ax, y: ay }, { x: ax + 1, y: ay }, { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 }],
      anchor: { x: ax, y: ay },
    });
  }

  it('single fire station cell → 1 remove-structure command', () => {
    placeFireStation(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('drag over 3 of 4 fire station cells → exactly 1 remove-structure command (dedup)', () => {
    placeFireStation(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
    ], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });
});

describe('buildToolCommands - HOSPITAL cell protections', () => {
  it('ROAD rejects a single HOSPITAL tile (transactional: returns empty)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.HOSPITAL));
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_RESIDENTIAL rejects a HOSPITAL tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.HOSPITAL));
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_COMMERCIAL rejects a HOSPITAL tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.HOSPITAL));
    expect(buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_INDUSTRIAL rejects a HOSPITAL tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.HOSPITAL));
    expect(buildToolCommands(Tool.ZONE_INDUSTRIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('TERRAIN_UP skips a HOSPITAL cell — no vertex writes for that tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.HOSPITAL));
    expect(buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });
});

describe('buildToolCommands - BULLDOZE with HOSPITAL', () => {
  function placeHospital(w: World, ax: number, ay: number): void {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        w.getMap().setTile(ax + dx, ay + dy, createTile(ax + dx, ay + dy, TileType.HOSPITAL));
      }
    }
    w.getStructureMap().addStructure({
      type: 'hospital',
      footprint: [{ x: ax, y: ay }, { x: ax + 1, y: ay }, { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 }],
      anchor: { x: ax, y: ay },
    });
  }

  it('single hospital cell → 1 remove-structure command', () => {
    placeHospital(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('drag over 3 of 4 hospital cells → exactly 1 remove-structure command (dedup)', () => {
    placeHospital(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
    ], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });
});

describe('buildToolCommands - SCHOOL cell protections', () => {
  function placeSchool(w: World, ax: number, ay: number): void {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        w.getMap().setTile(ax + dx, ay + dy, createTile(ax + dx, ay + dy, TileType.SCHOOL));
      }
    }
    w.getStructureMap().addStructure({
      type: 'school',
      footprint: [{ x: ax, y: ay }, { x: ax + 1, y: ay }, { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 }],
      anchor: { x: ax, y: ay },
    });
  }

  it('ROAD rejects a single SCHOOL tile (transactional: returns empty)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.SCHOOL));
    expect(buildToolCommands(Tool.ROAD, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_RESIDENTIAL rejects a SCHOOL tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.SCHOOL));
    expect(buildToolCommands(Tool.ZONE_RESIDENTIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_COMMERCIAL rejects a SCHOOL tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.SCHOOL));
    expect(buildToolCommands(Tool.ZONE_COMMERCIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('ZONE_INDUSTRIAL rejects a SCHOOL tile', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.SCHOOL));
    expect(buildToolCommands(Tool.ZONE_INDUSTRIAL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('TERRAIN_UP skips a SCHOOL cell — no vertex writes for that tile (isStructuredCell)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.SCHOOL));
    expect(buildToolCommands(Tool.TERRAIN_UP, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('single school cell → 1 remove-structure command (BULLDOZE)', () => {
    placeSchool(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('drag over 3 of 4 school cells → exactly 1 remove-structure command (dedup)', () => {
    placeSchool(world, 2, 2);
    const result = buildToolCommands(Tool.BULLDOZE, [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
    ], world, { x: 2, y: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('remove-structure');
  });

  it('BULLDOZE preview expands school footprint to full 2×2 (pathTiles covers all 4 cells)', () => {
    placeSchool(world, 2, 2);
    // Drag touches only anchor cell (2,2); preview should expand to full footprint.
    const preview = buildToolPreview(Tool.BULLDOZE, [{ x: 2, y: 2 }], world);
    expect(preview.pathTiles).toContainEqual({ x: 2, y: 2 });
    expect(preview.pathTiles).toContainEqual({ x: 3, y: 2 });
    expect(preview.pathTiles).toContainEqual({ x: 2, y: 3 });
    expect(preview.pathTiles).toContainEqual({ x: 3, y: 3 });
    expect(preview.rejected).toEqual([]);
    expect(preview.affectedBuildingIds.size).toBe(0);
  });
});

describe('buildToolCommands - SCHOOL placement', () => {
  it('accepts on flat 2×2 grass with no obstacles — emits one place-structure command', () => {
    const result = buildToolCommands(Tool.SCHOOL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toEqual([{ kind: 'place-structure', x: 2, y: 2, structureType: 'school' }]);
  });

  it('rejects when the 2×2 extends out of bounds (anchor at width-1, height-1)', () => {
    // 8×8 map — anchor at (7,7) means (8,8) OOB.
    const result = buildToolCommands(Tool.SCHOOL, [{ x: 7, y: 7 }], world, { x: 7, y: 7 });
    expect(result).toEqual([]);
  });

  it('rejects when any of the 4 cells is a road (non-grass)', () => {
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.SCHOOL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when any of the 4 cells is a zone tile', () => {
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.ZONE_RESIDENTIAL));
    expect(buildToolCommands(Tool.SCHOOL, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the footprint overlaps an existing structure', () => {
    // Existing power plant at (2,2)..(3,3) — overlaps a school anchored at (3,3).
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        world.getMap().setTile(2 + dx, 2 + dy, createTile(2 + dx, 2 + dy, TileType.POWER_PLANT));
      }
    }
    world.getStructureMap().addStructure({
      type: 'power_plant',
      footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      anchor: { x: 2, y: 2 },
    });
    expect(buildToolCommands(Tool.SCHOOL, [{ x: 3, y: 3 }], world, { x: 3, y: 3 })).toEqual([]);
  });
});

describe('buildToolPreview - SCHOOL', () => {
  it('populates rejected=[] for accepted placement', () => {
    const preview = buildToolPreview(Tool.SCHOOL, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('populates rejected=[tile] for rejected placement (non-grass cell in footprint)', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    const preview = buildToolPreview(Tool.SCHOOL, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([{ x: 2, y: 2 }]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('buildToolCommands - PARK placement', () => {
  it('accepts on flat 1×1 grass with no obstacles — emits one place-structure command', () => {
    const result = buildToolCommands(Tool.PARK, [{ x: 2, y: 2 }], world, { x: 2, y: 2 });
    expect(result).toEqual([{ kind: 'place-structure', x: 2, y: 2, structureType: 'park' }]);
  });

  it('rejects when the cell is non-grass (road)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    expect(buildToolCommands(Tool.PARK, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the cell is non-grass (zone)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    expect(buildToolCommands(Tool.PARK, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });

  it('rejects when the footprint overlaps an existing structure', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.POLICE_STATION));
    world.getStructureMap().addStructure({
      type: 'police_station',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
    });
    expect(buildToolCommands(Tool.PARK, [{ x: 2, y: 2 }], world, { x: 2, y: 2 })).toEqual([]);
  });
});

describe('buildToolPreview - PARK', () => {
  it('populates rejected=[] for accepted placement', () => {
    const preview = buildToolPreview(Tool.PARK, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('populates rejected=[tile] for rejected placement (non-grass cell)', () => {
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const preview = buildToolPreview(Tool.PARK, [{ x: 2, y: 2 }], world);
    expect(preview.rejected).toEqual([{ x: 2, y: 2 }]);
    expect(preview.pathTiles).toEqual([{ x: 2, y: 2 }]);
  });
});
