/**
 * Integration acceptance tests for the T6 lot-structure-merge feature.
 *
 * Scenario: 5×5 world. Rows y=0..3 are a 4-column wide R-zone (x=0..3).
 * Row y=4 is a road spanning the full width. Column x=4 is left as GRASS.
 * After one growth tick, exactly 4 buildings should exist — one per x column
 * in 0..3 — each with a 1×4 footprint, frontage S, and a 1×1 structureRect
 * at the south row.
 */

import { describe, it, expect } from 'vitest';
import { World, ZONE_GROWTH_INTERVAL } from './World';
import { TileType, createTile } from './Tile';
import { serializeWorld, deserializeWorldInto } from './mapSerialization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical acceptance world:
 *   6×6, regenerate: false (flat terrain at MIN_LAND_ELEVATION=1)
 *   x=0..3, y=0..3 → ZONE_RESIDENTIAL
 *   x=0..3, y=4    → ROAD
 *   x=4..5, y=0..3 → GRASS (default; no zone, no spawn)
 *   power plant at (4,3)–(5,4): footprint cells set to POWER_PLANT.
 *   Plant cell (4,4) is orthogonally adjacent to road at (3,4) → entire road row powered.
 */
function buildAcceptanceWorld(): World {
  const world = new World(6, 6, { regenerate: false });
  const map = world.getMap();

  // Road row at y=4, x=0..3 (zone columns only; x=4 is plant footprint).
  for (let x = 0; x <= 3; x++) {
    map.setTile(x, 4, createTile(x, 4, TileType.ROAD));
  }

  // 4-wide R-zone block at x=0..3, y=0..3.
  for (let x = 0; x <= 3; x++) {
    for (let y = 0; y <= 3; y++) {
      map.setTile(x, y, createTile(x, y, TileType.ZONE_RESIDENTIAL));
    }
  }

  // Power plant at (4,3)-(5,4): set tiles to POWER_PLANT then register.
  map.setTile(4, 3, createTile(4, 3, TileType.POWER_PLANT));
  map.setTile(5, 3, createTile(5, 3, TileType.POWER_PLANT));
  map.setTile(4, 4, createTile(4, 4, TileType.POWER_PLANT));
  map.setTile(5, 4, createTile(5, 4, TileType.POWER_PLANT));
  world.getStructureMap().addStructure({
    type: 'power_plant',
    anchor: { x: 4, y: 3 },
    footprint: [
      { x: 4, y: 3 }, { x: 5, y: 3 },
      { x: 4, y: 4 }, { x: 5, y: 4 },
    ],
  });
  world.markPowerDirty();
  world.recomputePower();

  return world;
}

// ---------------------------------------------------------------------------
// Acceptance: first growth tick spawns 4 buildings with correct geometry
// ---------------------------------------------------------------------------

describe('integration — acceptance: 4×4 R-zone next to road row', () => {
  it('exactly 4 residential buildings exist after one growth tick', () => {
    const world = buildAcceptanceWorld();

    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const buildings = [...world.getMap().getBuildings().iterBuildings()];
    expect(buildings.length).toBe(4);
    expect(buildings.every((b) => b.type === 'residential')).toBe(true);
  });

  it('each building has a 1×4 footprint (4 cells)', () => {
    const world = buildAcceptanceWorld();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const buildings = [...world.getMap().getBuildings().iterBuildings()];
    for (const b of buildings) {
      expect(b.footprint.length).toBe(4);
    }
  });

  it('each building has frontage S', () => {
    const world = buildAcceptanceWorld();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const buildings = [...world.getMap().getBuildings().iterBuildings()];
    for (const b of buildings) {
      expect(b.frontage).toBe('S');
    }
  });

  it('each building has a 1×1 structureRect at the south row (y=3)', () => {
    const world = buildAcceptanceWorld();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const buildings = [...world.getMap().getBuildings().iterBuildings()];
    for (const b of buildings) {
      expect(b.structureRect.w).toBe(1);
      expect(b.structureRect.h).toBe(1);
      expect(b.structureRect.y).toBe(3);
    }
  });

  it('anchors are at {x:0,y:0} through {x:3,y:0} — one per column', () => {
    const world = buildAcceptanceWorld();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const buildings = [...world.getMap().getBuildings().iterBuildings()];
    const anchorXSet = new Set(buildings.map((b) => b.anchor.x));
    expect(anchorXSet).toEqual(new Set([0, 1, 2, 3]));
    for (const b of buildings) {
      expect(b.anchor.y).toBe(0);
    }
  });

  it('no R-zone cell in the 4×4 block is left unowned', () => {
    const world = buildAcceptanceWorld();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const buildingMap = world.getMap().getBuildings();
    for (let x = 0; x <= 3; x++) {
      for (let y = 0; y <= 3; y++) {
        expect(buildingMap.getBuildingAt(x, y)).not.toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Save round-trip smoke: structureRect survives serialize → deserialize
// ---------------------------------------------------------------------------

describe('integration — save round-trip smoke', () => {
  it('deserializeWorldInto returns true on a valid serialized world', () => {
    const world = buildAcceptanceWorld();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    const json = serializeWorld(world);
    const fresh = new World(6, 6, { regenerate: false });
    expect(deserializeWorldInto(fresh, json)).toBe(true);
  });

  it('each building structureRect is bit-exact after round-trip', () => {
    const world = buildAcceptanceWorld();
    for (let i = 0; i < ZONE_GROWTH_INTERVAL; i++) world.tick();

    // Snapshot building structureRects before serialization.
    const beforeMap = new Map(
      [...world.getMap().getBuildings().iterBuildings()].map((b) => [
        b.id,
        { ...b.structureRect },
      ]),
    );

    const json = serializeWorld(world);
    const fresh = new World(6, 6, { regenerate: false });
    deserializeWorldInto(fresh, json);

    const afterBuildings = [...fresh.getMap().getBuildings().iterBuildings()];
    expect(afterBuildings.length).toBe(beforeMap.size);

    for (const b of afterBuildings) {
      const before = beforeMap.get(b.id);
      expect(before).toBeDefined();
      expect(b.structureRect).toEqual(before);
    }
  });
});
