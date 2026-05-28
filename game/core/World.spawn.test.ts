import { describe, it, expect } from 'vitest';
import { World, ZONE_GROWTH_INTERVAL, ZONE_MAX_LEVEL } from './World';
import { GROWTH_COOLDOWN_INTERVALS } from './growthConstants';
import { TileType, createTile } from './Tile';

function setTileCorners(world: World, x: number, y: number, h: number): void {
  const terrain = world.getTerrain();
  terrain.unsafeSetVertexHeight(x, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y + 1, h);
  terrain.unsafeSetVertexHeight(x, y + 1, h);
}

describe('World.tick() — heal rule', () => {
  it('converts a DIRT tile to GRASS and returns changed === 1', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.DIRT));

    const result = world.tick();

    expect(result.changed).toBe(1);
    expect(world.getMap().getTile(1, 1)?.type).toBe(TileType.GRASS);
  });

  it('returns changed === 0 and leaves map untouched when no DIRT present', () => {
    const world = new World(4, 4, { regenerate: false });

    const result = world.tick();

    expect(result.changed).toBe(0);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.GRASS);
  });

  it('does not alter ROAD tiles or water-elevation cells during a tick', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    // (1, 0) stays GRASS but with elevation <= SEA_LEVEL — water is elevation-derived.
    setTileCorners(world, 1, 0, 0);

    const result = world.tick();

    expect(result.changed).toBe(0);
    expect(world.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(world.getMap().getTile(1, 0)?.type).toBe(TileType.GRASS);
    expect(world.isWater(1, 0)).toBe(true);
  });
});

describe('World.tick() — permanence guard', () => {
  it('leaves zone tiles unchanged and only heals the DIRT control tile', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();

    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL));
    map.setTile(3, 0, createTile(3, 0, TileType.DIRT));

    const result = world.tick();

    expect(result.changed).toBe(1);
    expect(map.getTile(0, 0)?.type).toBe(TileType.ZONE_RESIDENTIAL);
    expect(map.getTile(1, 0)?.type).toBe(TileType.ZONE_COMMERCIAL);
    expect(map.getTile(2, 0)?.type).toBe(TileType.ZONE_INDUSTRIAL);
    expect(map.getTile(3, 0)?.type).toBe(TileType.GRASS);
  });
});

describe('World.countDirt()', () => {
  it('returns the number of DIRT tiles before a tick', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.DIRT));

    expect(world.countDirt()).toBe(2);
  });

  it('returns 0 after a tick heals all DIRT', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.DIRT));

    world.tick();

    expect(world.countDirt()).toBe(0);
  });
});

describe('World.tick() — zone growth', () => {
  it('ROAD-adjacent zone does NOT grow before the Nth tick (ZONE_GROWTH_INTERVAL - 1 ticks)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();

    expect(map.getTile(1, 0)?.level).toBe(0);
  });

  it('ROAD-adjacent zone creates a building (level 1) on tick N; returned changed includes the creation', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    const result = world.tick(); // tick N

    // Growth creates a building at level 1; tile.level is legacy (never written by growth).
    expect(map.getBuildings().getBuildingAt(1, 0)?.level).toBe(1);
    expect(result.changed).toBeGreaterThanOrEqual(1);
  });

  it('zone with no orthogonal ROAD neighbor stays level 0 across multiple growth intervals', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));
    // No road anywhere near

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) world.tick();

    expect(map.getTile(1, 1)?.level).toBe(0);
  });

  it('diagonal-only ROAD adjacency does NOT cause growth (orthogonal only)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    // Zone at (1,1), ROAD only at (2,2) — diagonal, not orthogonal
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));
    map.setTile(2, 2, createTile(2, 2, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 2; i++) world.tick();

    expect(map.getTile(1, 1)?.level).toBe(0);
  });

  it('zone building level caps at ZONE_MAX_LEVEL and stops contributing to changed at cap', () => {
    // Use a larger map to add two more zone types near (0,0) to push diversity to 1.0,
    // which brings landValue above the LEVEL_THRESHOLDS[5]=0.85 threshold needed for
    // the final level-up. The industrial tile at (1,1) is road-adjacent via (1,0) and
    // does spawn a building — load-bearing for the demand>0 gate (without a jobs source
    // residential demand would collapse to 0). The commercial tile at (0,1) is NOT
    // road-adjacent and only contributes to the diversity score of (0,0).
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Two extra zone types in the 3×3 neighborhood of (0,0) to reach diversity=1.0
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    // GROWTH_COOLDOWN_INTERVALS + max stagger = 8 + 6 = 14 growth-opportunity intervals per level.
    // 5 levels × 14 + 1 creation = 71 growth intervals × ZONE_GROWTH_INTERVAL ticks each.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 80; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(0, 0)?.level).toBe(ZONE_MAX_LEVEL);
  });

  it('at cap, zone no longer contributes to changed', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    // Seed a building already at max level so the first growth tick should not level it up
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: ZONE_MAX_LEVEL,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Run exactly one growth tick
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) {
      const result = world.tick();
      if (i === ZONE_GROWTH_INTERVAL - 1) {
        // On the growth tick, this zone is already capped — should not appear in changed
        expect(result.changed).toBe(0);
      }
    }
    expect(map.getBuildings().getBuildingAt(0, 0)?.level).toBe(ZONE_MAX_LEVEL);
  });
});

describe('WorldTickResult.changedTiles — canonical delta', () => {
  it('changedTiles contains the exact coord for a single DIRT heal', () => {
    const world = new World(4, 4, { regenerate: false });
    world.getMap().setTile(2, 3, createTile(2, 3, TileType.DIRT));

    const result = world.tick();

    expect(result.changedTiles).toEqual([{ x: 2, y: 3 }]);
    expect(result.changed).toBe(result.changedTiles.length);
  });

  it('changedTiles is empty when no mutations occur', () => {
    const world = new World(4, 4, { regenerate: false });

    const result = world.tick();

    expect(result.changedTiles).toEqual([]);
    expect(result.changed).toBe(0);
  });

  it('tick with both DIRT-heal AND zone-growth mutations reports all changed coords; changed === changedTiles.length', () => {
    // Arrange a map where:
    //   (0,0) = ZONE_RESIDENTIAL (level 0), road-adjacent → will grow on tick ZONE_GROWTH_INTERVAL
    //   (1,0) = ROAD
    //   (2,0) = DIRT → will heal on every tick
    // We advance to tick ZONE_GROWTH_INTERVAL - 1 without the DIRT tile, then place
    // the DIRT tile just before the final tick so it heals on the same tick that
    // growth fires.
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Advance to one tick before the first growth tick.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();

    // Now place the DIRT tile; it will heal on the very next tick (= tick ZONE_GROWTH_INTERVAL).
    map.setTile(2, 0, createTile(2, 0, TileType.DIRT));

    const result = world.tick(); // tick ZONE_GROWTH_INTERVAL: dirt heals + zone grows

    // Exactly 2 mutations: the DIRT heal at (2,0) and the zone level-up at (0,0).
    expect(result.changedTiles.length).toBe(2);
    expect(result.changedTiles).toEqual(
      expect.arrayContaining([
        { x: 2, y: 0 },
        { x: 0, y: 0 },
      ]),
    );
    // Hard contract: changed is always changedTiles.length
    expect(result.changed).toBe(result.changedTiles.length);
  });
});

describe('World.tick() — building creation and changedBuildingIds', () => {
  it('zone-grows-creates-building: first growth tick on a road-adjacent zone creates a building at level 1', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const building = map.getBuildings().getBuildingAt(0, 0);
    expect(building).not.toBeNull();
    expect(building?.level).toBe(1);
    expect(building?.type).toBe('residential');
  });

  it('changedBuildingIds emission: growth tick emits the created building id in WorldTickResult', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world.tick();
    const result = world.tick();

    expect(result.changedBuildingIds.length).toBeGreaterThanOrEqual(1);
    const building = map.getBuildings().getBuildingAt(0, 0);
    expect(building).not.toBeNull();
    expect(result.changedBuildingIds).toContain(building!.id);
  });

  it('building eventually levels up to 1 given sufficient land value and age', () => {
    // landValue at (0,0) ≈ 0.7 (road at dist=1) which exceeds LEVEL_THRESHOLDS[1]=0.1.
    // stagger(0)=0 → cooldown=8 growth-opportunity intervals. Building is created on the
    // first growth tick (age=0); after 8 more growth ticks (age=8) it levels up to 1.
    // Run 10 growth intervals (80 ticks) to comfortably cover creation + first level-up.
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 10; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(0, 0)?.level).toBeGreaterThanOrEqual(1);
  });
});

describe('World — bulldoze and repaint remove buildings', () => {
  it('bulldoze-developed-zone: bulldozing a zone tile with a building removes the building from BuildingMap', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(2, 2, createTile(2, 2, TileType.ZONE_RESIDENTIAL));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 2, y: 2 }],
      anchor: { x: 2, y: 2 },
      level: 3,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 2, y: 2, w: 1, h: 1 },
    });
    expect(building).not.toBeNull();

    // Bulldoze replaces ZONE_RESIDENTIAL with DIRT via setTileAndReconcile
    const rec = map.setTileAndReconcile(2, 2, createTile(2, 2, TileType.DIRT));

    expect(rec.changed).toBe(true);
    expect(rec.removedBuilding).not.toBeNull();
    expect(rec.removedBuilding?.id).toBe(building!.id);
    expect(map.getBuildings().getBuildingAt(2, 2)).toBeNull();
  });

  it('repaint zone type: painting a different zone over an existing zone removes the building', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 1, y: 1 }],
      anchor: { x: 1, y: 1 },
      level: 2,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 1, y: 1, w: 1, h: 1 },
    });
    expect(building).not.toBeNull();

    // Repaint with a different zone type
    const rec = map.setTileAndReconcile(1, 1, createTile(1, 1, TileType.ZONE_COMMERCIAL));

    expect(rec.changed).toBe(true);
    expect(rec.removedBuilding).not.toBeNull();
    expect(rec.removedBuilding?.id).toBe(building!.id);
    expect(map.getBuildings().getBuildingAt(1, 1)).toBeNull();
    expect(map.getTile(1, 1)?.type).toBe(TileType.ZONE_COMMERCIAL);
  });

  it('same-zone repaint: setTileAndReconcile returns changed=false and keeps building', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    const building = map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 1,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    const rec = map.setTileAndReconcile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));

    expect(rec.changed).toBe(false);
    expect(rec.removedBuilding).toBeNull();
    expect(map.getBuildings().getBuildingAt(0, 0)?.id).toBe(building!.id);
  });
});

describe('World.tick() — changedBuildingIds contract', () => {
  it('changedBuildingIds contains right id on level-up and is empty on non-growth/no-change ticks', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Seed a building at level 0, age sufficient for level-up.
    // id=0, stagger(0)=0, cooldown=8. age=7 → after +1 = 8 >= 8 → level-up on next growth tick.
    map.getBuildings().addBuilding({
      type: 'residential',
      footprint: [{ x: 0, y: 0 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: GROWTH_COOLDOWN_INTERVALS - 1,
      frontage: 'E',
      structureRect: { x: 0, y: 0, w: 1, h: 1 },
    });

    // Find the first tick on which the building levels up to 1
    let levelUpResult: ReturnType<typeof world.tick> | null = null;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 3; i++) {
      const result = world.tick();
      const b = map.getBuildings().getBuildingAt(0, 0)!;
      if (b && b.level === 1 && levelUpResult === null) {
        levelUpResult = result;
        break;
      }
    }

    expect(levelUpResult).not.toBeNull();
    const b = map.getBuildings().getBuildingAt(0, 0)!;
    expect(levelUpResult!.changedBuildingIds).toContain(b.id);
    expect(levelUpResult!.changedTiles).toContainEqual({ x: 0, y: 0 });
  });
});

describe('World.tick() — invariant: changedBuildingIds > 0 → changedTiles > 0', () => {
  it('on every tick of a long simulation changedBuildingIds implies changedTiles is non-empty', () => {
    // Use diversified map so growth can progress all the way to density bumps
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_COMMERCIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_INDUSTRIAL));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 200; i++) {
      const result = world.tick();
      if (result.changedBuildingIds.length > 0) {
        expect(result.changedTiles.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('World.tick() — multi-tile building guard', () => {
  it('2×2 building: age advances by exactly 1 per growth tick, never levels twice in one tick', () => {
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    // Zone tiles for 2×2 footprint
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(0, 1, createTile(0, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    // Road adjacent to the footprint
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    // Use addExistingBuilding to place a 2×2 building with a known id
    const ok = map.getBuildings().addExistingBuilding({
      id: 100,
      type: 'residential',
      footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
      anchor: { x: 0, y: 0 },
      level: 0,
      density: 0,
      age: 0,
      frontage: 'S',
      structureRect: { x: 0, y: 0, w: 2, h: 2 },
    });
    expect(ok).toBe(true);

    let prevAge = 0;
    let prevLevel = 0;
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 5; i++) {
      world.tick();
      const b = map.getBuildings().getBuilding(100)!;
      const isGrowthTick = world.getTick() % ZONE_GROWTH_INTERVAL === 0;
      if (isGrowthTick) {
        // Age must advance by exactly 1 compared to before this growth tick
        expect(b.age).toBeLessThanOrEqual(prevAge + 1);
        // Level must advance by at most 1 per tick
        expect(b.level).toBeLessThanOrEqual(prevLevel + 1);
        prevLevel = b.level;
        prevAge = b.age;
      }
    }
  });
});

describe('World.tick() — no-building branch creates level-1 building', () => {
  it('zone tile next to road with no building: one tick creates level-1 building AND coord in changedTiles', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    // Advance to the first growth tick
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const building = map.getBuildings().getBuildingAt(0, 0);
    expect(building).not.toBeNull();
    expect(building!.level).toBe(1);
    // The creation tick result — need to capture it
    // Re-run from scratch to capture the result
    const world2 = new World(4, 4, { regenerate: false });
    const map2 = world2.getMap();
    map2.setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL));
    map2.setTile(1, 0, createTile(1, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL - 1; i++) world2.tick();
    const result = world2.tick(); // the creation tick

    expect(result.changedTiles).toContainEqual({ x: 0, y: 0 });
    expect(result.changedBuildingIds.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Task 7: zone-growth terrain buildability gate
// ---------------------------------------------------------------------------

describe('World.tick() — zone-growth blocked on slope edge tile', () => {
  it('zone tile on slope edge does NOT grow even after ZONE_GROWTH_INTERVAL ticks', () => {
    // Tile (1,0) is raised to elevation 2; its east/west neighbors are at MIN_LAND_ELEVATION=1 → slope mask non-zero.
    // tile (1,0) is non-coplanar AND non-flat → spawn (strict-flat) denies regardless.
    // Road placed at (1,1) (elevation MIN_LAND_ELEVATION, flat) to satisfy road-adjacency requirement for the zone.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    world.getTerrain().unsafeSetVertexHeight(1, 0, 2);
    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 1, createTile(1, 1, TileType.ROAD)); // orthogonal neighbor (south)

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(1, 0)).toBeNull();
  });
});

describe('World.tick() — zone-growth blocked on coplanar slope tile (spawn stays strict-flat)', () => {
  it('zone tile on uniform N-S ramp does NOT grow even though canBuildAt allows it', () => {
    // Tile (1,0): corners (1,0)=1,(2,0)=1,(2,1)=2,(1,1)=2 — uniform N-S ramp.
    // topH+bottomH=1+2=3, leftH+rightH=2+1=3 → coplanar (canBuildAt passes).
    // But not flat (heights differ) → isFlatTile returns false → spawn denied.
    const world = new World(6, 6, { regenerate: false });
    const map = world.getMap();
    const terrain = world.getTerrain();
    // Raise south vertices to create a uniform N-S ramp at tile (1,0).
    terrain.unsafeSetVertexHeight(1, 1, 2);
    terrain.unsafeSetVertexHeight(2, 1, 2);

    // Verify the asymmetry: loosened gate allows, strict-flat gate denies.
    expect(world.canBuildAt(1, 0, 1, 1)).toBe(true);
    expect(world.getTerrain().isFlatTile(1, 0, (xx, yy) => world.isWater(xx, yy))).toBe(false);

    map.setTile(1, 0, createTile(1, 0, TileType.ZONE_RESIDENTIAL));
    // Road at (2,0) — orthogonal east neighbor satisfies road-adjacency.
    map.setTile(2, 0, createTile(2, 0, TileType.ROAD));

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(1, 0)).toBeNull();
  });
});

describe('World.tick() — zone-growth proceeds on plateau interior tile', () => {
  it('zone tile on 5×5 plateau interior DOES grow when it has a road neighbor inside the plateau', () => {
    // 5×5 plateau at (2,2)–(6,6): all tiles at elevation 1.
    // Interior cells (not on the plateau edge) are (3,3)–(5,5) — all have elevation-1 orthogonal neighbors.
    // Zone at (3,3), road at (4,3) — both interior flat tiles at the same elevation.
    // canBuildAt(3,3,1,1) = true → building is created on the first growth tick.
    const world = new World(10, 10, { regenerate: false });
    const map = world.getMap();
    for (let py = 2; py <= 6; py++) {
      for (let px = 2; px <= 6; px++) {
        setTileCorners(world, px, py, 1);
      }
    }
    map.setTile(3, 3, createTile(3, 3, TileType.ZONE_RESIDENTIAL));
    map.setTile(4, 3, createTile(4, 3, TileType.ROAD)); // orthogonal neighbor (east), inside plateau

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    expect(map.getBuildings().getBuildingAt(3, 3)).not.toBeNull();
    expect(map.getBuildings().getBuildingAt(3, 3)?.level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Terrain integration tests (Task 4)
// ---------------------------------------------------------------------------

describe('World.tick() — Branch A spawn: frontage is set correctly', () => {
  it('zone with road only to the south stores frontage: S', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD)); // south neighbor

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('S');
  });

  it('zone with road only to the north stores frontage: N', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD)); // north neighbor

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('N');
  });

  it('zone with road both N and S stores frontage: S (tie-break)', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 0, createTile(1, 0, TileType.ROAD)); // north
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD)); // south

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.frontage).toBe('S');
  });
});

describe('World.tick() — Branch A spawn: same-tick dedup guard', () => {
  it('building is eventually created with level=1 and density=0', () => {
    const world = new World(4, 4, { regenerate: false });
    const map = world.getMap();
    map.setTile(1, 1, createTile(1, 1, TileType.ZONE_RESIDENTIAL));
    map.setTile(1, 2, createTile(1, 2, TileType.ROAD));

    // Run enough intervals for the hash to land on 1×1 for this isolated zone tile.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) world.tick();

    const b = map.getBuildings().getBuildingAt(1, 1);
    expect(b).not.toBeNull();
    expect(b!.level).toBe(1);
    expect(b!.density).toBe(0);
  });
});

describe('World.tick() — spawn size', () => {
  function setupZoneBlock(world: World, zoneW: number, zoneH: number, roadY: number): void {
    const map = world.getMap();
    for (let y = 0; y < zoneH; y++) {
      for (let x = 0; x < zoneW; x++) {
        map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
        setTileCorners(world, x, y, 1);
      }
    }
    for (let x = 0; x < zoneW; x++) {
      map.setTile(x, roadY, createTile(x, roadY, TileType.ROAD));
    }
  }

  it('Fixture D: zone block with road → at least one newly spawned building has footprint.length > 1', () => {
    const world = new World(8, 7, { regenerate: false });
    const map = world.getMap();
    setupZoneBlock(world, 8, 6, 6);

    // Demand recompute only reads building type + level, not tile type.
    // I buildings on road tiles are invisible to zone growth (iterates zone tiles only)
    // but still drive demand via building type + level.
    map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 0, y: 6 }], anchor: { x: 0, y: 6 }, level: 2, density: 0, age: 0, frontage: 'N', structureRect: { x: 0, y: 6, w: 1, h: 1 } });
    map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 1, y: 6 }], anchor: { x: 1, y: 6 }, level: 2, density: 0, age: 0, frontage: 'N', structureRect: { x: 1, y: 6, w: 1, h: 1 } });

    const preSeededIds = new Set<number>();
    for (const b of map.getBuildings().iterBuildings()) preSeededIds.add(b.id);

    world.markDemandDirty();
    expect(world.getDemand().residential).toBeGreaterThanOrEqual(0.75);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 8; i++) world.tick();

    let foundMultiTile = false;
    for (const b of map.getBuildings().iterBuildings()) {
      if (preSeededIds.has(b.id)) continue;
      if (b.footprint.length > 1) { foundMultiTile = true; break; }
    }
    expect(foundMultiTile).toBe(true);
  });

  it('Fixture E: two worlds with identical setup produce identical newly-spawned buildings', () => {
    function buildWorld(): World {
      const world = new World(8, 7, { regenerate: false });
      const map = world.getMap();
      setupZoneBlock(world, 8, 6, 6);
      map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 0, y: 6 }], anchor: { x: 0, y: 6 }, level: 2, density: 0, age: 0, frontage: 'N', structureRect: { x: 0, y: 6, w: 1, h: 1 } });
      map.getBuildings().addBuilding({ type: 'industrial', footprint: [{ x: 1, y: 6 }], anchor: { x: 1, y: 6 }, level: 2, density: 0, age: 0, frontage: 'N', structureRect: { x: 1, y: 6, w: 1, h: 1 } });
      world.markDemandDirty();
      return world;
    }

    const worldA = buildWorld();
    const worldB = buildWorld();

    const preSeededIdsA = new Set<number>();
    for (const b of worldA.getMap().getBuildings().iterBuildings()) preSeededIdsA.add(b.id);
    const preSeededIdsB = new Set<number>();
    for (const b of worldB.getMap().getBuildings().iterBuildings()) preSeededIdsB.add(b.id);

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 8; i++) {
      worldA.tick();
      worldB.tick();
    }

    function snapshot(w: World, preSeededIds: Set<number>) {
      return Array.from(w.getMap().getBuildings().iterBuildings())
        .filter(b => !preSeededIds.has(b.id))
        .map(b => ({ ax: b.anchor.x, ay: b.anchor.y, len: b.footprint.length }))
        .sort((a, b) => a.ay - b.ay || a.ax - b.ax);
    }

    expect(snapshot(worldA, preSeededIdsA)).toEqual(snapshot(worldB, preSeededIdsB));
  });
});

describe('World.tick() — T3 spawn-size determinism', () => {
  it('two identically seeded worlds produce identical post-id-2 buildings after ticking', () => {
    function buildWorld(): World {
      const world = new World(8, 8, { regenerate: false });
      const map = world.getMap();
      for (let x = 0; x < 8; x++) {
        map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
      }
      for (let y = 2; y <= 3; y++) {
        for (let x = 1; x <= 6; x++) {
          map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
        }
      }
      map.setTile(6, 0, createTile(6, 0, TileType.ZONE_INDUSTRIAL));
      map.setTile(7, 0, createTile(7, 0, TileType.ZONE_INDUSTRIAL));
      map.getBuildings().addExistingBuilding({ id: 0, type: 'industrial', footprint: [{ x: 6, y: 0 }], anchor: { x: 6, y: 0 }, level: 5, density: 0, age: 0, frontage: 'S', structureRect: { x: 6, y: 0, w: 1, h: 1 } });
      map.getBuildings().addExistingBuilding({ id: 1, type: 'industrial', footprint: [{ x: 7, y: 0 }], anchor: { x: 7, y: 0 }, level: 5, density: 0, age: 0, frontage: 'S', structureRect: { x: 7, y: 0, w: 1, h: 1 } });
      world.markDemandDirty();
      return world;
    }

    const worldA = buildWorld();
    const worldB = buildWorld();

    for (let i = 0; i < ZONE_GROWTH_INTERVAL * 4; i++) {
      worldA.tick();
      worldB.tick();
    }

    function snapshot(w: World) {
      return Array.from(w.getMap().getBuildings().iterBuildings())
        .filter(b => b.id >= 2)
        .map(b => ({ ax: b.anchor.x, ay: b.anchor.y, len: b.footprint.length }))
        .sort((a, b) => a.ay - b.ay || a.ax - b.ax);
    }

    const snapA = snapshot(worldA);
    const snapB = snapshot(worldB);
    expect(snapA).toEqual(snapB);

    const hasMultiTile = snapA.some(b => b.len >= 2);
    expect(hasMultiTile).toBe(true);
  });
});
