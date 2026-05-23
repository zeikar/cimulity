/**
 * Economy integration test — no React, no DOM, no localStorage.
 *
 * Exercises the already-gated World + CommandDispatcher + mapSerialization
 * stack in a full end-to-end slice:
 *   build → spend money
 *   tick with road-adjacent zones → earn monthly tax
 *   serializeWorld → deserializeWorldInto → exact restore
 */

import { describe, it, expect } from 'vitest';
import { World, STARTING_FUNDS, ROAD_COST, ZONE_COST, BULLDOZE_COST, ZONE_GROWTH_INTERVAL, TAX_PER_POP, DAYS_PER_MONTH } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { Tool } from '../tools/Tool';
import { executeClick, executeDrag } from './CommandDispatcher';
import { serializeWorld, deserializeWorldInto } from '../core/mapSerialization';

describe('build spend — executeClick', () => {
  it('placing a road via executeClick deducts ROAD_COST', () => {
    const world = new World(10, 10, { regenerate: false });
    const before = world.getMoney();

    const result = executeClick(Tool.ROAD, { x: 3, y: 3 }, world);

    expect(result.changedTiles).toEqual([{ x: 3, y: 3 }]);
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.ROAD);
    expect(world.getMoney()).toBe(before - ROAD_COST);
  });

  it('placing a zone tile via executeClick deducts ZONE_COST', () => {
    const world = new World(10, 10, { regenerate: false });
    const before = world.getMoney();

    const result = executeClick(Tool.ZONE_RESIDENTIAL, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
    expect(world.getMoney()).toBe(before - ZONE_COST);
  });

  it('bulldozing a non-grass tile via executeClick deducts BULLDOZE_COST', () => {
    const world = new World(10, 10, { regenerate: false });
    world.getMap().setTile(4, 4, createTile(4, 4, TileType.ROAD));
    const before = world.getMoney();

    const result = executeClick(Tool.BULLDOZE, { x: 4, y: 4 }, world);

    expect(result.changedTiles).toEqual([{ x: 4, y: 4 }]);
    expect(world.getMap().getTile(4, 4)?.type).toBe(TileType.DIRT);
    expect(world.getMoney()).toBe(before - BULLDOZE_COST);
  });
});

describe('build spend — executeDrag', () => {
  it('dragging road over N tiles deducts N × ROAD_COST and places tiles', () => {
    const world = new World(10, 10, { regenerate: false });
    const before = world.getMoney();

    // horizontal drag x=0..4, y=0 → 5 tiles
    const result = executeDrag(Tool.ROAD, { x: 0, y: 0 }, { x: 4, y: 0 }, world);

    expect(result.changedTiles).toHaveLength(5);
    expect(world.getMoney()).toBe(before - 5 * ROAD_COST);
    for (let x = 0; x <= 4; x++) {
      expect(world.getMap().getTile(x, 0)?.type).toBe(TileType.ROAD);
    }
  });
});

describe('monthly tax settlement with road-adjacent zones', () => {
  it('money is unchanged on every non-boundary tick and increases exactly once at the DAYS_PER_MONTH-th tick', () => {
    const world = new World(10, 10, { regenerate: false });

    // Layout: road at (1,0); zone at (0,0) adjacent to the road.
    // Set up tiles directly to avoid spending money on them.
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 1));

    // Reset money to a known amount for deterministic accounting.
    world.setMoney(STARTING_FUNDS);

    // Run exactly DAYS_PER_MONTH ticks (M1→M2 boundary lands on the last one).
    // Settlement is pre-growth, so the month is taxed at the population measured
    // just before the boundary tick — capture it on the tick before the boundary.
    let popJustBeforeThatTick = 0;
    for (let t = 1; t <= DAYS_PER_MONTH; t++) {
      const before = world.getMoney();
      if (t === DAYS_PER_MONTH) popJustBeforeThatTick = world.getPopulation();
      world.tick();
      if (t < DAYS_PER_MONTH) {
        // No completed month yet — money must not move.
        expect(world.getMoney()).toBe(before);
      } else {
        expect(world.getElapsedDays()).toBe(DAYS_PER_MONTH);
        expect(world.getMoney()).toBe(
          before + Math.floor(popJustBeforeThatTick * TAX_PER_POP) * DAYS_PER_MONTH,
        );
      }
    }
  });

  it('setElapsedDays(DAYS_PER_MONTH - 1) then one tick() settles exactly one month at the pre-growth population', () => {
    const world = new World(10, 10, { regenerate: false });

    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 1));
    world.setMoney(STARTING_FUNDS);

    world.setElapsedDays(DAYS_PER_MONTH - 1);
    expect(world.getTick()).toBe(DAYS_PER_MONTH - 1);

    const before = world.getMoney();
    const popBefore = world.getPopulation(); // pre-growth population
    world.tick();

    expect(world.getElapsedDays()).toBe(DAYS_PER_MONTH);
    expect(world.getTick()).toBe(DAYS_PER_MONTH);
    expect(world.getMoney()).toBe(
      before + Math.floor(popBefore * TAX_PER_POP) * DAYS_PER_MONTH,
    );
  });
});

describe('serializeWorld / deserializeWorldInto round-trip — end-to-end', () => {
  it('restores exact money and map state via serialize → fresh World → deserialize', () => {
    const world = new World(8, 8, { regenerate: false });

    // Place some tiles and spend money deterministically via direct map writes
    // (bypass cost accounting for setup — the important thing is the money value).
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    // Level is intentionally 0: tile.level without a backing building is not preserved
    // (the building record is the source of truth for zone level).
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL, 0));
    world.getMap().setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL, 0));
    // Water is now elevation-derived; drop (3, 0) to SEA_LEVEL with tile staying GRASS.
    world.getTerrain().unsafeSetElevation(3, 0, 0);

    // Set a specific non-default money value.
    world.setMoney(7654);
    const expectedMoney = world.getMoney();

    const json = serializeWorld(world);

    const fresh = new World(8, 8, { regenerate: false });
    const ok = deserializeWorldInto(fresh, json);

    expect(ok).toBe(true);
    expect(fresh.getMoney()).toBe(expectedMoney);
    expect(fresh.getElapsedDays()).toBe(world.getElapsedDays());
    expect(fresh.getTick()).toBe(world.getTick());
    expect(fresh.getDate()).toEqual(world.getDate());
    expect(fresh.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(fresh.getMap().getTile(1, 0)?.type).toBe(TileType.ZONE_COMMERCIAL);
    expect(fresh.getMap().getTile(1, 0)?.level).toBe(0);
    expect(fresh.getMap().getTile(2, 0)?.type).toBe(TileType.ZONE_INDUSTRIAL);
    expect(fresh.getMap().getTile(2, 0)?.level).toBe(0);
    // Water-elevation cell round-trips: tile stays GRASS, elevation stays 0.
    expect(fresh.getMap().getTile(3, 0)?.type).toBe(TileType.GRASS);
    expect(fresh.getTerrain().getTileElevation(3, 0)).toBe(0);
    expect(fresh.isWater(3, 0)).toBe(true);
    // Untouched tiles remain GRASS.
    expect(fresh.getMap().getTile(7, 7)?.type).toBe(TileType.GRASS);
  });

  it('build → tick → serialize → deserialize preserves the money earned from tax', () => {
    const world = new World(6, 6, { regenerate: false });

    // Set up: road at (1,0), zone at (0,0).
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 0));
    world.setMoney(5000);

    // Advance to first growth tick and a bit beyond.
    for (let i = 0; i < ZONE_GROWTH_INTERVAL + 2; i++) {
      world.tick();
    }

    const moneyAfterTicks = world.getMoney();
    const zoneLevel = world.getMap().getTile(0, 0)?.level;

    const json = serializeWorld(world);
    const dst = new World(6, 6, { regenerate: false });
    expect(deserializeWorldInto(dst, json)).toBe(true);

    expect(dst.getMoney()).toBe(moneyAfterTicks);
    expect(dst.getElapsedDays()).toBe(world.getElapsedDays());
    expect(dst.getTick()).toBe(world.getTick());
    expect(dst.getDate()).toEqual(world.getDate());
    expect(dst.getMap().getTile(0, 0)?.level).toBe(zoneLevel);
    expect(dst.getMap().getTile(1, 0)?.type).toBe(TileType.ROAD);
  });
});
