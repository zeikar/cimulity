import { describe, it, expect, beforeEach } from 'vitest';
import { buildToolPreview } from './ToolActions';
import { Tool } from './Tool';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { SEA_LEVEL } from '../core/Terrain';
import type { Building } from '../core/Building';
import { lotBboxOf } from '../core/buildingFootprint';

let world: World;

beforeEach(() => {
  world = new World(8, 8, { regenerate: false });
});

describe('buildToolPreview - ROAD', () => {
  it('valid 3-tile horizontal road drag on flat grass → pathTiles=input, rejected=[], allOrNothingBlocked=false', () => {
    const tiles = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }];
    const preview = buildToolPreview(Tool.ROAD, tiles, world);
    expect(preview.pathTiles).toEqual(tiles);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('road drag where last tile has water corner → rejected=[last tile], allOrNothingBlocked=true', () => {
    // Vertex (4,1)=0 gives tile (3,1) a water corner
    world.getTerrain().unsafeSetVertexHeight(4, 1, SEA_LEVEL);
    const tiles = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }];
    const preview = buildToolPreview(Tool.ROAD, tiles, world);
    expect(preview.pathTiles).toEqual(tiles);
    expect(preview.rejected).toEqual([{ x: 3, y: 1 }]);
    expect(preview.allOrNothingBlocked).toBe(true);
  });

  it('single-tile road preview on triangle wedge → pathTiles=[tile], rejected=[tile], allOrNothingBlocked=true', () => {
    // Vertex (3,3)=2: tile (2,2) corners topH=1, rightH=1, bottomH=2, leftH=1 → not coplanar
    world.getTerrain().unsafeSetVertexHeight(3, 3, 2);
    const tiles = [{ x: 2, y: 2 }];
    const preview = buildToolPreview(Tool.ROAD, tiles, world);
    expect(preview.pathTiles).toEqual(tiles);
    expect(preview.rejected).toEqual([{ x: 2, y: 2 }]);
    expect(preview.allOrNothingBlocked).toBe(true);
  });

  it('road drag including one existing-ROAD tile → ROAD tile in pathTiles but not rejected, allOrNothingBlocked=false', () => {
    world.getMap().setTile(2, 1, createTile(2, 1, TileType.ROAD));
    const tiles = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }];
    const preview = buildToolPreview(Tool.ROAD, tiles, world);
    expect(preview.pathTiles).toEqual(tiles);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });
});

describe('buildToolPreview - ZONE', () => {
  it('valid zone drag on flat grass → pathTiles=input, rejected=[], allOrNothingBlocked=false', () => {
    const tiles = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }];
    const preview = buildToolPreview(Tool.ZONE_RESIDENTIAL, tiles, world);
    expect(preview.pathTiles).toEqual(tiles);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('mixed zone drag (water + flat) → rejected=[water tile], allOrNothingBlocked=false', () => {
    // Vertex (2,1)=0 makes tile (1,1) have a water corner
    world.getTerrain().unsafeSetVertexHeight(2, 1, SEA_LEVEL);
    const tiles = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }];
    const preview = buildToolPreview(Tool.ZONE_RESIDENTIAL, tiles, world);
    expect(preview.pathTiles).toEqual(tiles);
    expect(preview.rejected).toEqual([{ x: 1, y: 1 }]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });
});

describe('buildToolPreview - other tools', () => {
  it('BULLDOZE preview on 2×2 rect → pathTiles=input, rejected=[], allOrNothingBlocked=false, affectedBuildingIds empty', () => {
    const tiles = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }];
    const preview = buildToolPreview(Tool.BULLDOZE, tiles, world);
    expect(preview.pathTiles).toEqual(tiles);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
    expect(preview.affectedBuildingIds.size).toBe(0);
  });

  it('TERRAIN_UP preview on 2×2 rect → pathTiles=input, rejected=[], allOrNothingBlocked=false', () => {
    const tiles = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }];
    const preview = buildToolPreview(Tool.TERRAIN_UP, tiles, world);
    expect(preview.pathTiles).toEqual(tiles);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });
});
describe('buildToolPreview - BULLDOZE multi-tile affected', () => {
  function seedBuilding(
    w: World,
    footprint: { x: number; y: number }[],
    anchor: { x: number; y: number },
    opts: { type?: 'residential' | 'commercial' | 'industrial'; tileType?: TileType; level?: number; density?: 0 | 1 | 2; frontage?: 'N' | 'S' | 'E' | 'W' } = {}
  ): Building {
    const tileType = opts.tileType ?? TileType.ZONE_RESIDENTIAL;
    for (const c of footprint) {
      w.getMap().setTile(c.x, c.y, createTile(c.x, c.y, tileType));
    }
    const lot = lotBboxOf(footprint);
    const b = w.getMap().getBuildings().addBuilding({
      type: opts.type ?? 'residential',
      footprint,
      anchor,
      level: opts.level ?? 3,
      density: opts.density ?? 1,
      age: 0,
      frontage: opts.frontage ?? 'S',
      structureRect: { x: lot.x, y: lot.y, w: lot.w, h: lot.h },
    });
    if (b === null) throw new Error('seedBuilding: addBuilding returned null — fixture broken');
    return b;
  }

  it('4×2 mid-building: bulldoze one interior cell → affectedBuildingIds contains building id', () => {
    // Seed 4×2 residential at anchor (2,2), footprint rows y=2 and y=3, cols x=2..5
    const footprint = [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 },
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
    ];
    const building = seedBuilding(world, footprint, { x: 2, y: 2 });
    const preview = buildToolPreview(Tool.BULLDOZE, [{ x: 3, y: 3 }], world);
    expect(preview.affectedBuildingIds.has(building.id)).toBe(true);
    expect(preview.affectedBuildingIds.size).toBe(1);
    expect(preview.pathTiles).toEqual([{ x: 3, y: 3 }]);
    expect(preview.rejected).toEqual([]);
    expect(preview.allOrNothingBlocked).toBe(false);
  });

  it('2 adjacent buildings: bulldoze rect covering both → affectedBuildingIds contains both ids', () => {
    // 4×2 residential at anchor (2,2)
    const fp1 = [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 },
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
    ];
    const b1 = seedBuilding(world, fp1, { x: 2, y: 2 });
    // 1×1 commercial at (5,5) — use a different zone type
    const b2 = seedBuilding(world, [{ x: 5, y: 5 }], { x: 5, y: 5 }, {
      type: 'commercial',
      tileType: TileType.ZONE_COMMERCIAL,
    });
    // Drag rect covering at least one cell of each building
    const tiles = [
      { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
      { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 },
      { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 },
    ];
    const preview = buildToolPreview(Tool.BULLDOZE, tiles, world);
    expect(preview.affectedBuildingIds.size).toBe(2);
    expect(preview.affectedBuildingIds.has(b1.id)).toBe(true);
    expect(preview.affectedBuildingIds.has(b2.id)).toBe(true);
  });

  it('same building hit from multiple cells → set dedupes to size 1', () => {
    const footprint = [
      { x: 1, y: 1 }, { x: 2, y: 1 },
      { x: 1, y: 2 }, { x: 2, y: 2 },
    ];
    const building = seedBuilding(world, footprint, { x: 1, y: 1 });
    // Drag covers all 4 cells of the same building
    const preview = buildToolPreview(Tool.BULLDOZE, footprint, world);
    expect(preview.affectedBuildingIds.size).toBe(1);
    expect(preview.affectedBuildingIds.has(building.id)).toBe(true);
  });

  it('no buildings on path: bulldoze a ROAD tile → affectedBuildingIds empty', () => {
    world.getMap().setTile(3, 3, createTile(3, 3, TileType.ROAD));
    const preview = buildToolPreview(Tool.BULLDOZE, [{ x: 3, y: 3 }], world);
    expect(preview.affectedBuildingIds.size).toBe(0);
  });

  it('zone-guard DIRT: building whose tile was overwritten to DIRT → size 0', () => {
    // Seed 1×1 building on (4,4) as ZONE_RESIDENTIAL
    seedBuilding(world, [{ x: 4, y: 4 }], { x: 4, y: 4 });
    // Overwrite the tile to DIRT — setTileAndReconcile would not remove the building here
    // because by the time bulldoze runs the tile is DIRT, not zone.
    world.getMap().setTile(4, 4, createTile(4, 4, TileType.DIRT));
    const preview = buildToolPreview(Tool.BULLDOZE, [{ x: 4, y: 4 }], world);
    // DIRT is not a zone type, so the guard skips it → size 0
    expect(preview.affectedBuildingIds.size).toBe(0);
  });

  it('zone-guard ROAD (Codex-flagged case): building whose tile was overwritten to ROAD → size 0', () => {
    // Seed 1×1 commercial building on (4,5) as ZONE_COMMERCIAL
    seedBuilding(world, [{ x: 4, y: 5 }], { x: 4, y: 5 }, {
      type: 'commercial',
      tileType: TileType.ZONE_COMMERCIAL,
    });
    // Overwrite tile to ROAD — setTileAndReconcile won't remove building since current is ROAD (not zoned)
    world.getMap().setTile(4, 5, createTile(4, 5, TileType.ROAD));
    const preview = buildToolPreview(Tool.BULLDOZE, [{ x: 4, y: 5 }], world);
    // ROAD is not a zone type, so the guard skips it → size 0
    expect(preview.affectedBuildingIds.size).toBe(0);
  });

  it('non-bulldoze tools: ROAD/ZONE_RESIDENTIAL/TERRAIN_UP previews → affectedBuildingIds empty', () => {
    // Seed a building so it would be detected if the guard were wrong
    seedBuilding(world, [{ x: 2, y: 2 }], { x: 2, y: 2 });
    const tiles = [{ x: 2, y: 2 }];

    const roadPreview = buildToolPreview(Tool.ROAD, tiles, world);
    expect(roadPreview.affectedBuildingIds.size).toBe(0);

    const zonePreview = buildToolPreview(Tool.ZONE_RESIDENTIAL, tiles, world);
    expect(zonePreview.affectedBuildingIds.size).toBe(0);

    const terrainPreview = buildToolPreview(Tool.TERRAIN_UP, tiles, world);
    expect(terrainPreview.affectedBuildingIds.size).toBe(0);
  });
});
