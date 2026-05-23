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

describe('executeClick - paint terrain', () => {
  it('PAINT_GRASS on DIRT writes GRASS', () => {
    const world = makeWorld();
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.DIRT));

    const result = executeClick(Tool.PAINT_GRASS, { x: 1, y: 1 }, world);

    expect(result.changedTiles).toEqual([{ x: 1, y: 1 }]);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
  });

  it('PAINT_WATER on ROAD reports [] and leaves ROAD intact', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));

    const result = executeClick(Tool.PAINT_WATER, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
  });
});

describe('executeDrag/previewDrag - paint terrain rectangle', () => {
  it('(a) PAINT_GRASS: 2x2 drag over DIRT seed paints all 4 to GRASS', () => {
    const world = makeWorld(5);
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.DIRT));
    world.getMap().setTile(0, 1, createTile(0, 1, TileType.DIRT));
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.DIRT));

    const result = executeDrag(Tool.PAINT_GRASS, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

    expect(result.changedTiles).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.GRASS);
    expect(world.getMap().getTile(0, 1)?.type).toBe(TileType.GRASS);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
  });

  it('(c) previewDrag returns the rect without mutating', () => {
    const world = makeWorld(5);

    const path = previewDrag(Tool.PAINT_WATER, { x: 0, y: 0 }, { x: 1, y: 1 }, world);

    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    // No tiles were written
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.GRASS);
    expect(world.getMap().getTile(0, 1)?.type).toBe(TileType.GRASS);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
  });

  it('(d) out-of-bounds left column clipped — x=-1 column dropped from preview', () => {
    const world = makeWorld(5);

    const path = previewDrag(Tool.PAINT_WATER, { x: -1, y: 0 }, { x: 1, y: 1 }, world);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });
});

describe('paint terrain - cost', () => {
  it('PAINT_WATER click on GRASS leaves money unchanged (free)', () => {
    const world = makeWorld();
    const before = world.getMoney();

    executeClick(Tool.PAINT_WATER, { x: 2, y: 2 }, world);

    expect(world.getMoney()).toBe(before);
  });

  it('PAINT_GRASS drag over a 1x5 row of DIRT leaves money unchanged', () => {
    const world = makeWorld(5);
    for (let x = 0; x < 5; x++) {
      world.getMap().setTile(x, 0, createTile(x, 0, TileType.DIRT));
    }
    const before = world.getMoney();

    const result = executeDrag(Tool.PAINT_GRASS, { x: 0, y: 0 }, { x: 4, y: 0 }, world);

    expect(result.changedTiles).toHaveLength(5);
    expect(world.getMoney()).toBe(before);
  });

  it('PAINT_WATER on a ROAD tile is a no-op — no cost charged, money unchanged', () => {
    const world = makeWorld();
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.ROAD));
    const before = world.getMoney();

    const result = executeClick(Tool.PAINT_WATER, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.ROAD);
    expect(world.getMoney()).toBe(before);
  });
});

describe('executeClick/executeDrag — paint terrain elevation branch (dispatch state)', () => {
  it('PAINT_WATER slope-safe: sets elevation to SEA_LEVEL and world.isWater becomes true', () => {
    // 4×4 world, all GRASS at MIN_LAND_ELEVATION (1). Center (2,2) neighbors are all elev 1.
    // Drop from 1 to 0: difference is 1 — within slope constraint.
    const world = new World(4, 4, { regenerate: false });

    const result = executeClick(Tool.PAINT_WATER, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toHaveLength(1);
    expect(result.changedTiles[0]).toEqual({ x: 2, y: 2 });
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(0); // SEA_LEVEL
    expect(world.isWater(2, 2)).toBe(true);
  });

  it('PAINT_WATER slope-blocked: elevation stays unchanged when drop would create a cliff', () => {
    // Center cell at elev 5, all 8 neighbors also at elev 5.
    // Dropping center to SEA_LEVEL (0) would create a delta of 5 — slope-blocked.
    // Tools emit intent; dispatcher enforces slope. This is the 'hard cliff' contract — silent no-op.
    const world = new World(4, 4, { regenerate: false });
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        world.getTerrain().unsafeSetElevation(x, y, 5);
      }
    }

    const result = executeClick(Tool.PAINT_WATER, { x: 2, y: 2 }, world);

    // setElevation rejected the 5→0 step — changedTiles must not include center
    expect(result.changedTiles.some(c => c.x === 2 && c.y === 2)).toBe(false);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(5);
  });

  it('PAINT_GRASS slope-safe: raises sea-level GRASS to MIN_LAND_ELEVATION and isWater becomes false', () => {
    // One-cell sea inlet: center (1,1) at elev 0; surrounding cells at elev 1.
    const world = new World(3, 3, { regenerate: false });
    world.getTerrain().unsafeSetElevation(1, 1, 0);
    expect(world.isWater(1, 1)).toBe(true);

    const result = executeClick(Tool.PAINT_GRASS, { x: 1, y: 1 }, world);

    expect(world.getTerrain().getTileElevation(1, 1)).toBe(1); // MIN_LAND_ELEVATION
    expect(world.isWater(1, 1)).toBe(false);
    expect(result.changedTiles).toContainEqual({ x: 1, y: 1 });
  });

  it('PAINT_GRASS slope-blocked: steep-coast water stays at elev 0 (slope safety — silent no-op)', () => {
    // Center (1,1) at elev 0; at least one neighbor at elev 4 (steep coast).
    // Raising 0→1 blocked because neighbor at 4 vs proposed 1 = delta 3 > 1.
    // Steep-coast water is not recoverable in this PR — see model commitment / PAINT_GRASS slope safety.
    const world = new World(3, 3, { regenerate: false });
    world.getTerrain().unsafeSetElevation(1, 1, 0);
    world.getTerrain().unsafeSetElevation(0, 0, 4);

    const result = executeClick(Tool.PAINT_GRASS, { x: 1, y: 1 }, world);

    expect(world.getTerrain().getTileElevation(1, 1)).toBe(0);
    expect(world.isWater(1, 1)).toBe(true);
    expect(result.changedTiles.some(c => c.x === 1 && c.y === 1)).toBe(false);
  });

  it('PAINT_GRASS on DIRT (dispatch): tile becomes GRASS after executeClick', () => {
    // Verifies the tile-write branch is unaffected by the new elevation branch
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));
    world.getTerrain().unsafeSetElevation(2, 2, 5);

    const result = executeClick(Tool.PAINT_GRASS, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
  });

  it('PAINT_WATER on DIRT (dispatch): tile becomes GRASS, elevation drops to SEA_LEVEL, isWater true', () => {
    // 5x5 world, all cells at MIN_LAND_ELEVATION (1). DIRT at (2,2) with slope-safe neighbors.
    // Paired commands: tile DIRT→GRASS first, then elevation → SEA_LEVEL.
    const world = makeWorld(5);
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));

    const result = executeClick(Tool.PAINT_WATER, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toContainEqual({ x: 2, y: 2 });
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.GRASS);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(0); // SEA_LEVEL
    expect(world.isWater(2, 2)).toBe(true);
  });

  it('PAINT_WATER on DIRT at high plateau (dispatch, slope-blocked) → tile stays DIRT, elevation unchanged', () => {
    // All tiles at elev 5; DIRT at (2,2). Preflight blocks both commands — no partial mutation.
    const world = makeWorld(5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        world.getTerrain().unsafeSetElevation(x, y, 5);
      }
    }
    world.getMap().setTile(2, 2, createTile(2, 2, TileType.DIRT));

    const result = executeClick(Tool.PAINT_WATER, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([]);
    expect(world.getMap().getTile(2, 2)?.type).toBe(TileType.DIRT);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(5);
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

  it('UP slope-blocked: neighbor too far below blocks the raise', () => {
    // Center at 1, neighbor (1,2) at 4; raising center to 2 would give delta |4-2|=2 > 1
    // Wait — the slope check is on the proposed new elevation vs neighbors.
    // Center would go from 1→2. Neighbor (1,2) is at 4. delta |4-2|=2 > 1 → blocked.
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(1, 2, 4);

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
    // Center at 5, neighbor (1,2) at 2. Proposed next = 4. |2-4|=2 > 1 → blocked.
    const world = makeWorld(5);
    // First raise all neighbors and center to 5 to avoid slope issues, then set specific values
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.getTerrain().unsafeSetElevation(2 + dx, 2 + dy, 5);
      }
    }
    world.getTerrain().unsafeSetElevation(1, 2, 2);

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
    const world = makeWorld(5);
    // Raise neighbor (1,2) to 3 so lowering center from 1→0 would give |3-0|=3 > 1 → blocked
    world.getTerrain().unsafeSetElevation(1, 2, 3);
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
    // 5×5 world. Drag DOWN over (1,1)→(2,2). Seed outside cell (3,3) to elevation 3 so that
    // only cell (2,2) (proposed: 1→0) sees |3-0|=3 > 1 → slope-blocked (diagonal neighbor).
    // Cells (1,1), (2,1), (1,2) are safe — (3,3) is not within 1-step of any of them.
    const world = makeWorld(5);
    world.getTerrain().unsafeSetElevation(3, 3, 3);

    const result = executeDrag(Tool.TERRAIN_DOWN, { x: 1, y: 1 }, { x: 2, y: 2 }, world);

    // Three safe GRASS cells → 3 elevation changes; (2,2) skipped; no DIRT so no paired writes
    expect(result.changedTiles.length).toBe(3);
    expect(world.getTerrain().getTileElevation(1, 1)).toBe(SEA_LEVEL);
    expect(world.getTerrain().getTileElevation(2, 1)).toBe(SEA_LEVEL);
    expect(world.getTerrain().getTileElevation(1, 2)).toBe(SEA_LEVEL);
    expect(world.getTerrain().getTileElevation(2, 2)).toBe(1); // unchanged
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
