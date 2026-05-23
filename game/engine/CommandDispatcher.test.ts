import { describe, it, expect } from 'vitest';
import { executeClick, executeDrag, previewDrag } from './CommandDispatcher';
import { Tool } from '../tools/Tool';
import { World } from '../core/World';
import { ROAD_COST, ZONE_COST, BULLDOZE_COST } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { SEA_LEVEL, MAX_ELEVATION } from '../core/Terrain';
import type { Building } from '../core/Building';
import { tileFillColor, WATER_COLOR } from '../render/visuals/palette';
import { serializeWorld, deserializeWorldInto } from '../core/mapSerialization';

function makeWorld(size = 5): World {
  return new World(size, size, { regenerate: false });
}

describe('executeClick', () => {
  it('places a road on a grass tile and reports the change', () => {
    const world = makeWorld();
    const result = executeClick(Tool.ROAD, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
  });

  it('does not place a road on water (elevation-derived)', () => {
    const world = makeWorld();
    // Water is now elevation-derived: drop (1,1) to SEA_LEVEL so world.isWater returns true.
    world.getTerrain().unsafeSetElevation(1, 1, 0);

    const result = executeClick(Tool.ROAD, { x: 1, y: 1 }, world);

    expect(result.changedTiles).toEqual([]);
  });

  it('does not re-place a road on an existing road', () => {
    const world = makeWorld();
    executeClick(Tool.ROAD, { x: 0, y: 0 }, world);

    const result = executeClick(Tool.ROAD, { x: 0, y: 0 }, world);

    expect(result.changedTiles).toEqual([]);
  });

  it('reports no change when clicking out of bounds', () => {
    const world = makeWorld();
    const result = executeClick(Tool.ROAD, { x: 99, y: 99 }, world);

    expect(result.changedTiles).toEqual([]);
  });

  it('changes nothing for the SELECT tool', () => {
    const world = makeWorld();
    const result = executeClick(Tool.SELECT, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });

});

describe('executeClick — bulldoze', () => {
  it('reverts a road tile back to dirt', () => {
    const world = makeWorld();
    executeClick(Tool.ROAD, { x: 2, y: 2 }, world);

    const result = executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.DIRT);
  });

  it('does nothing on a non-road tile', () => {
    const world = makeWorld();
    // (1, 1) is a water-elevation cell — bulldoze still skips it because it is
    // not ROAD/zone and the tile type stays GRASS.
    world.getTerrain().unsafeSetElevation(1, 1, 0);

    expect(
      executeClick(Tool.BULLDOZE, { x: 0, y: 0 }, world).changedTiles
    ).toEqual([]);
    expect(
      executeClick(Tool.BULLDOZE, { x: 1, y: 1 }, world).changedTiles
    ).toEqual([]);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
    expect(world.isWater(1, 1)).toBe(true);
  });

  it('reports no change when bulldozing out of bounds', () => {
    const world = makeWorld();
    expect(
      executeClick(Tool.BULLDOZE, { x: 99, y: 99 }, world).changedTiles
    ).toEqual([]);
  });
});

describe('executeDrag — bulldoze', () => {
  it('clears only the road tiles inside the dragged rectangle to dirt', () => {
    const world = makeWorld(5);
    // Roads on two opposite corners of a 2x2 box; the other two stay grass
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.ROAD));
    // A road outside the box must survive
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));

    const result = executeDrag(Tool.BULLDOZE, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

    // Row-major order, non-road tiles in the box skipped
    expect(result.changedTiles).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.DIRT);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.DIRT);
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.ROAD);
  });
});

describe('executeDrag', () => {
  it('places roads along a bounds-filtered horizontal path', () => {
    const world = makeWorld(5);
    // Snapped path runs x=0..10,y=0; only x=0..4 are in bounds
    const result = executeDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 10, y: 0 }, world);

    expect(result.changedTiles).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('skips water tiles in the middle of a diagonal drag (elevation-derived)', () => {
    const world = makeWorld(5);
    // Water is now elevation-derived: drop (2,2) to SEA_LEVEL so world.isWater returns true.
    world.getTerrain().unsafeSetElevation(2, 2, 0);

    const result = executeDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 4, y: 4 }, world);

    expect(result.changedTiles).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
  });

  it('reports no change when the tool has no drag path', () => {
    const world = makeWorld();
    const result = executeDrag(Tool.SELECT, { x: 0, y: 0 }, { x: 3, y: 0 }, world);

    expect(result.changedTiles).toEqual([]);
  });
});

describe('previewDrag', () => {
  it('returns the bounds-filtered path without mutating core', () => {
    const world = makeWorld(5);
    const path = previewDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 10, y: 0 }, world);

    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
    // Nothing was written
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('returns an empty path for a tool with no drag rule', () => {
    const world = makeWorld();
    expect(previewDrag(Tool.SELECT, { x: 0, y: 0 }, { x: 3, y: 3 }, world)).toEqual([]);
  });
});

describe('executeClick - zoning', () => {
  const zoneCases: Array<[Tool, TileType]> = [
    [Tool.ZONE_RESIDENTIAL, TileType.ZONE_RESIDENTIAL],
    [Tool.ZONE_COMMERCIAL, TileType.ZONE_COMMERCIAL],
    [Tool.ZONE_INDUSTRIAL, TileType.ZONE_INDUSTRIAL],
  ];

  for (const [tool, expectedType] of zoneCases) {
    it(`places a zone tile when clicking with ${tool}`, () => {
      const world = makeWorld();
      const result = executeClick(tool, { x: 2, y: 2 }, world);

      expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
      expect(world.getMap().getTile(2, 2)?.type).toBe(expectedType);
    });

    it(`rejects ${tool} on a water tile`, () => {
      const world = makeWorld();
      // Water is elevation-derived: drop (1, 1) to SEA_LEVEL so world.isWater is true.
      world.getTerrain().unsafeSetElevation(1, 1, 0);

      const result = executeClick(tool, { x: 1, y: 1 }, world);

      expect(result.changedTiles).toEqual([]);
      expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
      expect(world.isWater(1, 1)).toBe(true);
    });
  }
});

describe('executeDrag/previewDrag - zoning rectangle paint', () => {
  const zoneCases: Array<[Tool, TileType]> = [
    [Tool.ZONE_RESIDENTIAL, TileType.ZONE_RESIDENTIAL],
    [Tool.ZONE_COMMERCIAL, TileType.ZONE_COMMERCIAL],
    [Tool.ZONE_INDUSTRIAL, TileType.ZONE_INDUSTRIAL],
  ];

  for (const [tool, expectedType] of zoneCases) {
    it(`(a) PAINT incl. DIRT: ${tool} paints all four tiles in a 2x2 drag including a dirt tile`, () => {
      const world = makeWorld(5);
      world.getMap().setTile(1, 0, createTile(1, 0, TileType.DIRT));

      const result = executeDrag(tool, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

      expect(result.changedTiles).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]);
      expect(world.getMap().getTile(0, 0)?.type).toBe(expectedType);
      expect(world.getMap().getTile(1, 0)?.type).toBe(expectedType);
      expect(world.getMap().getTile(0, 1)?.type).toBe(expectedType);
      expect(world.getMap().getTile(1, 1)?.type).toBe(expectedType);
    });

    it(`(b) SKIP allowlist: ${tool} skips water-elevation, ROAD, and the same-zone no-op inside the rect`, () => {
      const world = makeWorld(5);
      // Water is elevation-derived: drop (1, 1) to SEA_LEVEL.
      world.getTerrain().unsafeSetElevation(1, 1, 0);
      world.getMap().setTile(0, 1, createTile(0, 1, TileType.ROAD));
      world.getMap().setTile(1, 0, createTile(1, 0, expectedType));

      const result = executeDrag(tool, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

      expect(result.changedTiles).toEqual([{ x: 0, y: 0 }]);
      expect(world.getMap().getTile(0, 0)?.type).toBe(expectedType);
      // Water cell stayed GRASS (no zone applied) and remained at sea level.
      expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
      expect(world.isWater(1, 1)).toBe(true);
      expect(world.getMap().getTile(0, 1)?.type).toBe(TileType.ROAD);
      expect(world.getMap().getTile(1, 0)?.type).toBe(expectedType);
    });

    it(`(b2) CROSS-ZONE repaint: ${tool} overwrites a different existing zone inside the rect`, () => {
      const world = makeWorld(5);
      const otherZone =
        expectedType === TileType.ZONE_RESIDENTIAL
          ? TileType.ZONE_COMMERCIAL
          : TileType.ZONE_RESIDENTIAL;
      // (1, 1) is a non-paintable ROAD; (0, 1) is also ROAD; (1, 0) is a different zone.
      world.getMap().setTile(1, 1, createTile(1, 1, TileType.ROAD));
      world.getMap().setTile(0, 1, createTile(0, 1, TileType.ROAD));
      world.getMap().setTile(1, 0, createTile(1, 0, otherZone));

      const result = executeDrag(tool, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

      expect(result.changedTiles).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
      expect(world.getMap().getTile(0, 0)?.type).toBe(expectedType);
      expect(world.getMap().getTile(1, 0)?.type).toBe(expectedType);
      expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.ROAD);
      expect(world.getMap().getTile(0, 1)?.type).toBe(TileType.ROAD);
    });

    it(`(c) PREVIEW path: ${tool} previews 4-tile rectangle without mutating`, () => {
      const world = makeWorld(5);

      const path = previewDrag(tool, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

      expect(path).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]);
      expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
    });

    it(`(d) BOUNDS clip: ${tool} drops out-of-bounds x=-1 column from preview and paint`, () => {
      const world = makeWorld(5);

      const path = previewDrag(tool, { x: -1, y: 0 }, { x: 1, y: 1 }, world);
      expect(path).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]);

      const result = executeDrag(tool, { x: -1, y: 0 }, { x: 1, y: 1 }, world);
      expect(result.changedTiles).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]);
      expect(world.getMap().getTile(0, 0)?.type).toBe(expectedType);
      expect(world.getMap().getTile(1, 0)?.type).toBe(expectedType);
      expect(world.getMap().getTile(0, 1)?.type).toBe(expectedType);
      expect(world.getMap().getTile(1, 1)?.type).toBe(expectedType);
    });

    it(`(e) REVERSED corners: ${tool} drag from {1,1} to {0,0} yields same 4 tiles as forward`, () => {
      const world = makeWorld(5);

      const result = executeDrag(tool, { x: 1, y: 1 }, { x: 0, y: 0 }, world);

      expect(result.changedTiles).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]);
      expect(world.getMap().getTile(0, 0)?.type).toBe(expectedType);
      expect(world.getMap().getTile(1, 0)?.type).toBe(expectedType);
      expect(world.getMap().getTile(0, 1)?.type).toBe(expectedType);
      expect(world.getMap().getTile(1, 1)?.type).toBe(expectedType);
    });

    it(`(f) SAME-ZONE level preserved: ${tool} repaint over a level-3 tile emits no change and level stays 3`, () => {
      const world = makeWorld(5);
      // Pre-seed a developed tile at level 3
      world.getMap().setTile(2, 2, createTile(2, 2, expectedType, 3));

      const result = executeClick(tool, { x: 2, y: 2 }, world);

      // Same-zone skip in buildZoneCommands → no command emitted → no write
      expect(result.changedTiles).toEqual([]);
      expect(world.getMap().getTile(2, 2)?.level).toBe(3);
      expect(world.getMap().getTile(2, 2)?.type).toBe(expectedType);
    });

    it(`(g) DIFFERENT-ZONE resets level: painting a different zone over a level-3 ${tool} tile resets level to 0`, () => {
      const world = makeWorld(5);
      const otherTool =
        tool === Tool.ZONE_RESIDENTIAL ? Tool.ZONE_COMMERCIAL : Tool.ZONE_RESIDENTIAL;
      const otherType =
        otherTool === Tool.ZONE_RESIDENTIAL
          ? TileType.ZONE_RESIDENTIAL
          : TileType.ZONE_COMMERCIAL;
      // Pre-seed a developed tile at level 3
      world.getMap().setTile(2, 2, createTile(2, 2, expectedType, 3));

      const result = executeClick(otherTool, { x: 2, y: 2 }, world);

      expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
      expect(world.getMap().getTile(2, 2)?.type).toBe(otherType);
      expect(world.getMap().getTile(2, 2)?.level).toBe(0);
    });
  }
});

describe('executeClick - zoning × level', () => {
  it('(c) GRASS paint: zone placed on a grass tile starts with level 0', () => {
    const world = makeWorld(5);
    // Tile at (2,2) is GRASS by default

    const result = executeClick(Tool.ZONE_RESIDENTIAL, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(world.getMap().getTile(2, 2)?.level).toBe(0);
  });
});

describe('build costs', () => {
  it('placing a road deducts ROAD_COST from the treasury', () => {
    const world = makeWorld();
    const before = world.getMoney();
    executeClick(Tool.ROAD, { x: 2, y: 2 }, world);
    expect(world.getMoney()).toBe(before - ROAD_COST);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
  });

  it('placing a zone tile deducts ZONE_COST from the treasury', () => {
    const world = makeWorld();
    const before = world.getMoney();
    executeClick(Tool.ZONE_RESIDENTIAL, { x: 2, y: 2 }, world);
    expect(world.getMoney()).toBe(before - ZONE_COST);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ZONE_RESIDENTIAL);
  });

  it('bulldozing a tile deducts BULLDOZE_COST from the treasury', () => {
    const world = makeWorld();
    // Place a road first (free accounting — we only care about the bulldoze cost here)
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const before = world.getMoney();
    executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    expect(world.getMoney()).toBe(before - BULLDOZE_COST);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.DIRT);
  });

  it('dragging road over N tiles deducts N × ROAD_COST', () => {
    const world = makeWorld(5);
    const before = world.getMoney();
    // horizontal drag x=0..4, y=0 → 5 tiles
    const result = executeDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 4, y: 0 }, world);
    expect(result.changedTiles).toHaveLength(5);
    expect(world.getMoney()).toBe(before - 5 * ROAD_COST);
  });

  it('insufficient funds: tile is NOT placed and money is unchanged', () => {
    const world = makeWorld();
    world.setMoney(ROAD_COST - 1); // one short
    const before = world.getMoney();
    const result = executeClick(Tool.ROAD, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(world.getMoney()).toBe(before);
  });

  it('same-zone repaint emits no command → money is unchanged', () => {
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL, 3));
    const before = world.getMoney();
    const result = executeClick(Tool.ZONE_RESIDENTIAL, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getMoney()).toBe(before);
  });

  it('partial-afford drag: entire batch is rejected when total exceeds balance', () => {
    const world = makeWorld(5);
    // Balance sufficient for 2 roads but not 5
    world.setMoney(2 * ROAD_COST);
    const before = world.getMoney();
    // horizontal drag produces 5 road commands; total = 5 × ROAD_COST > balance
    const result = executeDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 4, y: 0 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getMoney()).toBe(before);
    // No tiles were placed
    for (let x = 0; x <= 4; x++) {
      expect(world.getMap().getTile(x, 0)?.type).toBe(TileType.GRASS);
    }
  });

  it('bulldozing a zone tile deducts BULLDOZE_COST from the treasury', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    const before = world.getMoney();
    const result = executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.DIRT);
    expect(world.getMoney()).toBe(before - BULLDOZE_COST);
  });

  it('bulldoze drag over zone tiles deducts BULLDOZE_COST per tile cleared', () => {
    const world = makeWorld(5);
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    const before = world.getMoney();
    const result = executeDrag(Tool.BULLDOZE, { x: 0, y: 0 }, { x: 1, y: 0 }, world);
    expect(result.changedTiles).toHaveLength(2);
    expect(world.getMoney()).toBe(before - 2 * BULLDOZE_COST);
  });

  it('insufficient funds: zone bulldoze is rejected and tiles stay unchanged', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    world.setMoney(BULLDOZE_COST - 1); // one short
    const before = world.getMoney();
    const result = executeClick(Tool.BULLDOZE, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(world.getMoney()).toBe(before);
  });

  it('previewDrag does not spend money', () => {
    const world = makeWorld(5);
    const before = world.getMoney();
    previewDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 4, y: 0 }, world);
    expect(world.getMoney()).toBe(before);
    // No tiles written either
    for (let x = 0; x <= 4; x++) {
      expect(world.getMap().getTile(x, 0)?.type).toBe(TileType.GRASS);
    }
  });

  it('bulldoze drag over multiple tiles deducts BULLDOZE_COST per tile cleared', () => {
    const world = makeWorld(5);
    // Seed two road tiles inside the drag rectangle
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    const before = world.getMoney();
    const result = executeDrag(Tool.BULLDOZE, { x: 0, y: 0 }, { x: 1, y: 0 }, world);
    expect(result.changedTiles).toHaveLength(2);
    expect(world.getMoney()).toBe(before - 2 * BULLDOZE_COST);
  });
});

describe('executeClick - TERRAIN_UP / TERRAIN_DOWN', () => {
  it('UP slope-safe: raises elevation by 1', () => {
    const world = makeWorld(5);

    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(2);
  });

  it('UP at MAX_ELEVATION clamp: no change', () => {
    const world = makeWorld(5);
    // Seed center and 3×3 neighborhood to MAX_ELEVATION so canSetElevation passes
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.getTerrain().unsafeSetElevation(2 + dx, 2 + dy, MAX_ELEVATION);
      }
    }

    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(MAX_ELEVATION);
  });

  it('UP slope-cap blocked: neighbor 6 blocks raise 1→2 (delta 4 > cap 3)', () => {
    // Neighbor at 6, center raises 1→2: |6-2|=4 > cap 3 → blocked.
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(1, 2, 6);

    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(1);
  });

  it('DOWN slope-safe: elevation becomes SEA_LEVEL, cell is water', () => {
    const world = makeWorld(5);

    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(SEA_LEVEL);
    expect(world.isWater(2, 2)).toBe(true);
  });

  it('DOWN at SEA_LEVEL floor: no change', () => {
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(2, 2, SEA_LEVEL);

    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
  });

  it('DOWN slope-blocked: steep neighbor blocks the lower', () => {
    // Center at 5, neighbor (1,2) at 0: |0-4|=4 > cap 3 → blocked.
    const world = makeWorld(5);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.getTerrain().unsafeSetElevation(2 + dx, 2 + dy, 5);
      }
    }
    world.getTerrain().unsafeSetElevation(1, 2, 0);

    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(5);
  });

  it('Structured-tile reject UP: ROAD tile blocks TERRAIN_UP', () => {
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const elevBefore = world.getTerrain().getTileElevation(2, 2);

    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(elevBefore);
  });

  it('Structured-tile reject DOWN: ZONE_RESIDENTIAL tile blocks TERRAIN_DOWN', () => {
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));

    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
  });

  it('Building footprint reject: TERRAIN_UP and TERRAIN_DOWN both blocked by a building', () => {
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    const building: Building = {
      id: 0,
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 0,
      density: 0,
      age: 0,
    };
    world.getMap().getBuildings().addExistingBuilding(building);
    const elevBefore = world.getTerrain().getTileElevation(2, 2);

    const upResult = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);
    const downResult = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(upResult.changedTiles).toEqual([]);
    expect(downResult.changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(elevBefore);
  });

  it('DIRT → SEA_LEVEL paired commit: tile becomes GRASS, elevation = SEA_LEVEL, changedTiles has two (2,2) entries', () => {
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));

    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    // Tile write + elevation write → two entries at the same coord
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(SEA_LEVEL);
    expect(world.isWater(2, 2)).toBe(true);
    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }, { x: 2, y: 2 }]);
  });

  it('DIRT → SEA_LEVEL slope-blocked: tile stays DIRT, elevation unchanged', () => {
    // Neighbor at 4 makes |4-0|=4 > cap 3, so preflight rejects — neither tile nor elevation commits.
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(1, 2, 4);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));

    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.DIRT);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(1);
  });

  it('changedTiles contract pin (Design D8 regression bait): single TERRAIN_DOWN on DIRT at MIN_LAND_ELEVATION emits exactly 2 entries', () => {
    // applyCommands pushes once per committed command; duplicates at the same coord are part of the contract.
    // If a future refactor adds dedup, update D8 and this test together.
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));

    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(result.changedTiles.length).toBe(2);
  });

  it('cap-3 UP boundary: neighbor at 5 (delta 3 from new elev 2) ACCEPTS raise', () => {
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(1, 2, 5);
    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(2);
  });

  it('cap-3 UP boundary: neighbor at 6 (delta 4 > cap) REJECTS raise', () => {
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(1, 2, 6);
    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(1);
  });

  it('cap-3 DOWN boundary: center 4 with neighbor at 6 (delta 3 = cap from new elev 3) ACCEPTS lower', () => {
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(2, 2, 4);
    world.getTerrain().unsafeSetElevation(1, 2, 6);
    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(3);
  });

  it('cap-3 DOWN boundary: center 4 with neighbor at 7 (delta 4 > cap from new elev 3) REJECTS lower', () => {
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(2, 2, 4);
    world.getTerrain().unsafeSetElevation(1, 2, 7);
    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(4);
  });

  it('needle-spike UP flow: four sequential TERRAIN_UP clicks on isolated tile (flat-1 neighbors) — clicks 1/2/3 raise 1→2→3→4, click 4 rejected at the cap', () => {
    // Each accepted click commits via applyCommands → next call sees the new elevation.
    // Cap-3 boundary: at center=4 with neighbors=1, next=5 gives |1-5|=4 > cap.
    const world = makeWorld(5);
    expect(executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world).changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(2);
    expect(executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world).changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(3);
    expect(executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world).changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(4);
    expect(executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world).changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(4);
  });

  it('needle-spike DOWN flow: lower an isolated peak at elev 4 (flat-1 neighbors) — four lowers reach SEA_LEVEL, fifth rejected at the floor', () => {
    // Pre-seed (2,2)=4 with neighbors=1. All four lowers stay within cap-3 because neighbors don't change.
    // Fifth click hits the SEA_LEVEL floor (not the cap).
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(2, 2, 4);
    for (const expectedElev of [3, 2, 1, SEA_LEVEL]) {
      const r = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);
      expect(r.changedTiles).toContainEqual({ x: 2, y: 2 });
      expect(world.getTerrain().getTileElevation(2, 2)).toBe(expectedElev);
    }
    expect(executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world).changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(SEA_LEVEL);
  });

  it('raise next to a ROAD at SAME elevation is ACCEPTED — raise cannot add a LOWER bit to the road bitmask (D4 lower-only)', () => {
    // Default world: all elevation 1. Road at (3,2). Raise (2,2) from 1→2.
    // Road's west neighbor becomes 2 > road's elev 1 → bit unset → flat preserved.
    const world = makeWorld(5);
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ROAD));
    const result = executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(2);
  });

  it('lower next to a ROAD at SAME elevation is REJECTED — would set a LOWER bit on the road bitmask (D4)', () => {
    // Seed map to 2 so DOWN is slope-legal; road at (3,2). Lower (2,2) from 2→1.
    const world = makeWorld(5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        world.getTerrain().unsafeSetElevation(x, y, 2);
      }
    }
    world.getMap().setTile(3, 2, createTile(3, 2, TileType.ROAD));
    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(2);
  });

  it('DIRT → SEA_LEVEL accept at cap boundary: neighbor at 3 (delta 3 = cap) → atomic GRASS + SEA_LEVEL commit, no partial mutation', () => {
    // DIRT at (2,2) elev 1, neighbor (1,2) at 3. Lower 1→0: |3-0|=3 ≤ cap → preflight accepts.
    // Builder emits paired {tile GRASS, elevation 0}; dispatcher applies both via setPlayerElevation.
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    world.getTerrain().unsafeSetElevation(1, 2, 3);
    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(SEA_LEVEL);
    expect(world.isWater(2, 2)).toBe(true);
    expect(result.changedTiles.length).toBe(2);
  });

  it('DIRT → SEA_LEVEL reject above cap: neighbor at 4 (delta 4 > cap) → preflight rejects, tile stays DIRT, elevation unchanged (no partial GRASS write)', () => {
    // Cap exceeded at the builder layer — preflight emits zero commands, so no tile-write either.
    // Pins the per-tile atomicity contract: a rejected paired DIRT write leaves the DIRT tile untouched.
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    world.getTerrain().unsafeSetElevation(1, 2, 4);
    const result = executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);
    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.DIRT);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(1);
  });
});

describe('executeDrag / previewDrag - TERRAIN_UP / TERRAIN_DOWN', () => {
  it('UP drag 2×2 on default world: all four cells raised to elevation 2', () => {
    const world = makeWorld(5);

    const result = executeDrag(Tool.TERRAIN_UP, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

    expect(result.changedTiles.length).toBe(4);
    expect(world.getTerrain().getTileElevation(0, 0)).toBe(2);
    expect(world.getTerrain().getTileElevation(1, 0)).toBe(2);
    expect(world.getTerrain().getTileElevation(0, 1)).toBe(2);
    expect(world.getTerrain().getTileElevation(1, 1)).toBe(2);
  });

  it('DOWN drag 2×2 with mixed DIRT+GRASS rect: DIRT cell gets paired write, total changedTiles === 5', () => {
    const world = makeWorld(5);
    // Seed DIRT at (1,0) only; rest of the 2×2 rect is GRASS
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.DIRT));

    const result = executeDrag(Tool.TERRAIN_DOWN, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

    // Three GRASS cells → 1 changedTile each (elevation only); DIRT cell → 2 changedTiles (tile + elevation)
    expect(result.changedTiles.length).toBe(5);
    // DIRT coord appears exactly twice
    expect(result.changedTiles.filter(t => t.x === 1 && t.y === 0).length).toBe(2);

    expect(result.changedTiles).toContainEqual({ x: 0, y: 0 });
    expect(result.changedTiles).toContainEqual({ x: 1, y: 0 });
    expect(result.changedTiles).toContainEqual({ x: 0, y: 1 });
    expect(result.changedTiles).toContainEqual({ x: 1, y: 1 });

    // (1,0) tile write: DIRT → GRASS
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.GRASS);
    expect(world.getTerrain().getTileElevation(1, 0)).toBe(SEA_LEVEL);

    // All four cells are now water
    expect(world.isWater(0, 0)).toBe(true);
    expect(world.isWater(1, 0)).toBe(true);
    expect(world.isWater(0, 1)).toBe(true);
    expect(world.isWater(1, 1)).toBe(true);
  });

  it('Per-tile slope rejection inside drag (D6): slope-blocked cell is skipped, others change', () => {
    // Seed outside cell (3,3) to elevation 4 so that only cell (2,2) (proposed: 1→0) sees |4-0|=4 > cap 3 → slope-blocked.
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(3, 3, 4);

    const result = executeDrag(Tool.TERRAIN_DOWN, { x: 1, y: 1 }, { x: 2, y: 2 }, world);

    // Three safe GRASS cells → 3 elevation changes; (2,2) skipped; no DIRT so no paired writes
    expect(result.changedTiles.length).toBe(3);
    expect(world.getTerrain().getTileElevation(1, 1)).toBe(SEA_LEVEL);
    expect(world.getTerrain().getTileElevation(2, 1)).toBe(SEA_LEVEL);
    expect(world.getTerrain().getTileElevation(1, 2)).toBe(SEA_LEVEL);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(1); // unchanged
  });

  it('drag mixed cap-boundary: 2×1 TERRAIN_DOWN rect — accepted cell at delta-3 from outside neighbor commits, rejected cell at delta-4 stays unchanged (D5 per-tile atomicity at batch level)', () => {
    // (1,2) and (2,2) both at elev 4, next=3. Outside (0,2) at 6: |6-3|=3 ≤ cap → (1,2) accepts.
    // Outside (3,2) at 7: |7-3|=4 > cap → (2,2) rejects. Inside-rect delta=0, so neither breaks the other.
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(1, 2, 4);
    world.getTerrain().unsafeSetElevation(2, 2, 4);
    world.getTerrain().unsafeSetElevation(0, 2, 6);
    world.getTerrain().unsafeSetElevation(3, 2, 7);

    const result = executeDrag(Tool.TERRAIN_DOWN, { x: 1, y: 2 }, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([{ x: 1, y: 2 }]);
    expect(world.getTerrain().getTileElevation(1, 2)).toBe(3);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(4); // rejected cell unchanged
  });

  it('drag adjacent-both-commit at cap boundary: 2×1 TERRAIN_UP rect — both rect cells (8-neighbors of each other) accept at outside-neighbor cap boundary (delta exactly 3) and apply cleanly despite mid-batch mutation of the other cell (D6 same-direction uniform-step atomicity proof)', () => {
    // (2,2) and (3,2) both at elev 0, next=1. Outside (1,2) at 4: |4-1|=3 = cap → (2,2) accepts.
    // Outside (4,2) at 4: |4-1|=3 = cap → (3,2) accepts. Pins that the mid-batch mutation of cell 1
    // does not invalidate cell 2's apply-time delta check (uniform +1 step preserves relative deltas).
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(2, 2, 0);
    world.getTerrain().unsafeSetElevation(3, 2, 0);
    world.getTerrain().unsafeSetElevation(1, 2, 4);
    world.getTerrain().unsafeSetElevation(4, 2, 4);

    const result = executeDrag(Tool.TERRAIN_UP, { x: 2, y: 2 }, { x: 3, y: 2 }, world);

    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }, { x: 3, y: 2 }]);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(1);
    expect(world.getTerrain().getTileElevation(3, 2)).toBe(1);
  });

  it('previewDrag pure: TERRAIN_UP preview returns rect tiles, world state unchanged', () => {
    const world = makeWorld(5);
    const elevBefore = world.getTerrain().getTileElevation(0, 0);

    const path = previewDrag(Tool.TERRAIN_UP, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    // World unchanged
    expect(world.getTerrain().getTileElevation(0, 0)).toBe(elevBefore);
    expect(world.getTerrain().getTileElevation(1, 0)).toBe(elevBefore);
    expect(world.getTerrain().getTileElevation(0, 1)).toBe(elevBefore);
    expect(world.getTerrain().getTileElevation(1, 1)).toBe(elevBefore);
  });
});

describe('TERRAIN_UP / TERRAIN_DOWN cost', () => {
  it('TERRAIN_UP on plain GRASS: money unchanged', () => {
    const world = makeWorld(5);
    const before = world.getMoney();

    executeClick(Tool.TERRAIN_UP, { x: 2, y: 2 }, world);

    expect(world.getMoney()).toBe(before);
  });

  it('TERRAIN_DOWN on plain GRASS: money unchanged', () => {
    const world = makeWorld(5);
    const before = world.getMoney();

    executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(world.getMoney()).toBe(before);
  });

  it('DIRT → SEA_LEVEL paired commit: money unchanged', () => {
    // commandCost charges by cmd.tile.type for tile writes; paired DIRT→GRASS writes a GRASS tile
    // (fallback return 0), not the BULLDOZE_COST DIRT branch. Explicit assertion guards against future cost refactors.
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    const before = world.getMoney();

    executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(world.getMoney()).toBe(before);
  });

  it('TERRAIN_UP drag over five GRASS cells: money unchanged', () => {
    const world = makeWorld(5);
    const before = world.getMoney();

    const result = executeDrag(Tool.TERRAIN_UP, { x: 0, y: 0 }, { x: 4, y: 0 }, world);

    expect(result.changedTiles).toHaveLength(5);
    expect(world.getMoney()).toBe(before);
  });
});

describe('TERRAIN_DOWN — render/save coherence', () => {
  it('Palette coherence (GRASS → SEA_LEVEL): tileFillColor returns WATER_COLOR after click', () => {
    const world = makeWorld(5);
    executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    // Elevation is now SEA_LEVEL; three-arg call required for water branch to fire
    expect(tileFillColor(TileType.GRASS, 0, world.getTerrain().getTileElevation(2, 2))).toBe(WATER_COLOR);
    expect(tileFillColor(TileType.GRASS, 0, SEA_LEVEL)).toBe(WATER_COLOR);
  });

  it('Palette coherence after DIRT→SEA_LEVEL paired commit: tile is GRASS and renders as water', () => {
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world);

    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(tileFillColor(TileType.GRASS, 0, SEA_LEVEL)).toBe(WATER_COLOR);
  });

  it('Serialization round-trip: DIRT→SEA_LEVEL state survives save/load', () => {
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    executeClick(Tool.TERRAIN_DOWN, { x: 2, y: 2 }, world); // paired DIRT→GRASS + elevation → SEA_LEVEL

    const json = serializeWorld(world);
    const loaded = new World(5, 5, { regenerate: false });
    expect(deserializeWorldInto(loaded, json)).toBe(true);
    expect(loaded.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(loaded.getTerrain().getTileElevation(2, 2)).toBe(SEA_LEVEL);
  });

  it('Serialization round-trip negative control: DIRT tile at SEA_LEVEL elevation is rejected', () => {
    // Serialize a valid world, then mutate the JSON so cell (2,2) has DIRT type but elevation <= SEA_LEVEL.
    // This pins the "elevation <= SEA_LEVEL ⇒ GRASS" invariant — the loader must reject incoherent data.
    const world = makeWorld(5);
    // Lower (2,2) to SEA_LEVEL first (valid: GRASS at sea level)
    world.getTerrain().unsafeSetElevation(2, 2, SEA_LEVEL);
    const json = serializeWorld(world);

    // Mutate the tile at index (2*5+2 = 12) from GRASS to DIRT in the JSON
    const parsed = JSON.parse(json) as { t: string[] };
    parsed.t[2 * 5 + 2] = TileType.DIRT;
    const mutatedJson = JSON.stringify(parsed);

    expect(deserializeWorldInto(new World(5, 5, { regenerate: false }), mutatedJson)).toBe(false);
  });
});
