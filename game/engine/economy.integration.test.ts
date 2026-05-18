/**
 * Economy integration test — no React, no DOM, no localStorage.
 *
 * Exercises the already-gated World + CommandDispatcher + mapSerialization
 * stack in a full end-to-end slice:
 *   build → spend money
 *   tick with road-adjacent zones → earn tax
 *   serializeWorld → deserializeWorldInto → exact restore
 */

import { describe, it, expect } from 'vitest';
import { World, STARTING_FUNDS, ROAD_COST, ZONE_COST, BULLDOZE_COST, ZONE_GROWTH_INTERVAL, TAX_PER_POP } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import { Tool } from '../tools/Tool';
import { executeClick, executeDrag } from './CommandDispatcher';
import { serializeWorld, deserializeWorldInto } from '../core/mapSerialization';

describe('build spend — executeClick', () => {
  it('placing a road via executeClick deducts ROAD_COST', () => {
    const world = new World(10, 10);
    const before = world.getMoney();

    const result = executeClick(Tool.ROAD, { x: 3, y: 3 }, world);

    expect(result.changedTiles).toEqual([{ x: 3, y: 3 }]);
    expect(world.getMap().getTile(3, 3)?.type).toBe(TileType.ROAD);
    expect(world.getMoney()).toBe(before - ROAD_COST);
  });

  it('placing a zone tile via executeClick deducts ZONE_COST', () => {
    const world = new World(10, 10);
    const before = world.getMoney();

    const result = executeClick(Tool.ZONE_RESIDENTIAL, { x: 2, y: 2 }, world);

    expect(result.changedTiles).toEqual([{ x: 2, y: 2 }]);
    expect(world.getMoney()).toBe(before - ZONE_COST);
  });

  it('bulldozing a non-grass tile via executeClick deducts BULLDOZE_COST', () => {
    const world = new World(10, 10);
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
    const world = new World(10, 10);
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

describe('tax accrual across ticks with road-adjacent zones', () => {
  it('tax accumulates correctly over several growth ticks', () => {
    const world = new World(10, 10);

    // Layout: road at (1,0); zone at (0,0) adjacent to the road.
    // Set up tiles directly to avoid spending money on them.
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ROAD));
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ZONE_RESIDENTIAL, 0));

    // Reset money to a known amount for deterministic accounting.
    world.setMoney(STARTING_FUNDS);
    const startMoney = world.getMoney();

    // Run enough ticks to trigger two growth events.
    // Growth fires every ZONE_GROWTH_INTERVAL ticks (1-indexed: tick 8, 16, …).
    // Each non-growth tick earns floor(pop * TAX_PER_POP); growth ticks earn
    // tax on the population BEFORE the level-up (tick increments first, then
    // DIRT heals, then zone grows, then tax is charged — tax uses post-grow pop).
    //
    // We run 2 * ZONE_GROWTH_INTERVAL ticks and track expected money manually.
    let expectedMoney = startMoney;
    let currentLevel = 0; // zone starts at level 0

    for (let t = 1; t <= 2 * ZONE_GROWTH_INTERVAL; t++) {
      if (t % ZONE_GROWTH_INTERVAL === 0 && currentLevel < 5) {
        // Growth fires this tick, THEN tax is computed on updated population.
        currentLevel++;
      }
      const pop = currentLevel * 10; // POPULATION_PER_LEVEL = 10
      expectedMoney += Math.floor(pop * TAX_PER_POP);
      world.tick();
    }

    expect(world.getMoney()).toBe(expectedMoney);
    // Zone should have grown twice.
    expect(world.getMap().getTile(0, 0)?.level).toBe(2);
  });
});

describe('serializeWorld / deserializeWorldInto round-trip — end-to-end', () => {
  it('restores exact money and map state via serialize → fresh World → deserialize', () => {
    const world = new World(8, 8);

    // Place some tiles and spend money deterministically via direct map writes
    // (bypass cost accounting for setup — the important thing is the money value).
    world.getMap().setTile(0, 0, createTile(0, 0, TileType.ROAD));
    world.getMap().setTile(1, 0, createTile(1, 0, TileType.ZONE_COMMERCIAL, 2));
    world.getMap().setTile(2, 0, createTile(2, 0, TileType.ZONE_INDUSTRIAL, 0));
    world.getMap().setTile(3, 0, createTile(3, 0, TileType.WATER));

    // Set a specific non-default money value.
    world.setMoney(7654);
    const expectedMoney = world.getMoney();

    const json = serializeWorld(world);

    const fresh = new World(8, 8);
    const ok = deserializeWorldInto(fresh, json);

    expect(ok).toBe(true);
    expect(fresh.getMoney()).toBe(expectedMoney);
    expect(fresh.getMap().getTile(0, 0)?.type).toBe(TileType.ROAD);
    expect(fresh.getMap().getTile(1, 0)?.type).toBe(TileType.ZONE_COMMERCIAL);
    expect(fresh.getMap().getTile(1, 0)?.level).toBe(2);
    expect(fresh.getMap().getTile(2, 0)?.type).toBe(TileType.ZONE_INDUSTRIAL);
    expect(fresh.getMap().getTile(2, 0)?.level).toBe(0);
    expect(fresh.getMap().getTile(3, 0)?.type).toBe(TileType.WATER);
    // Untouched tiles remain GRASS.
    expect(fresh.getMap().getTile(7, 7)?.type).toBe(TileType.GRASS);
  });

  it('build → tick → serialize → deserialize preserves the money earned from tax', () => {
    const world = new World(6, 6);

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
    const dst = new World(6, 6);
    expect(deserializeWorldInto(dst, json)).toBe(true);

    expect(dst.getMoney()).toBe(moneyAfterTicks);
    expect(dst.getMap().getTile(0, 0)?.level).toBe(zoneLevel);
    expect(dst.getMap().getTile(1, 0)?.type).toBe(TileType.ROAD);
  });
});
