/**
 * Central world state container
 * Holds all game state but doesn't manage rendering
 */

import { GameMap } from './Map';
import { TileType, createTile, isZoneType } from './Tile';

/** Ticks between each zone growth step. tickCount is post-increment (≥1), so first growth fires at tick === ZONE_GROWTH_INTERVAL, not 0. */
export const ZONE_GROWTH_INTERVAL = 8;
/** Maximum zone growth level a tile may reach. */
export const ZONE_MAX_LEVEL = 5;
/** Population contribution per zone level point. */
export const POPULATION_PER_LEVEL = 10;
/** Initial city treasury balance. */
export const STARTING_FUNDS = 10000;
/** Tax revenue per population point per tick. */
export const TAX_PER_POP = 1;
/** Cost to place one ROAD tile. */
export const ROAD_COST = 10;
/** Cost to place one zone (R/C/I) tile. */
export const ZONE_COST = 5;
/** Cost to bulldoze one tile. */
export const BULLDOZE_COST = 2;

export interface WorldTickResult {
  /** Number of tiles changed this tick (DIRT→GRASS heals + zone level-ups). */
  changed: number;
}

export class World {
  private map: GameMap;
  private tickCount: number = 0;
  private money: number = STARTING_FUNDS;

  constructor(mapWidth: number, mapHeight: number) {
    this.map = new GameMap(mapWidth, mapHeight);
  }

  getMap(): GameMap {
    return this.map;
  }

  getTick(): number {
    return this.tickCount;
  }

  getMoney(): number {
    return this.money;
  }

  /** Money is always whole non-negative units; this guard enforces that invariant for all mutators. */
  private isValidMoneyAmount(n: number): boolean {
    return Number.isInteger(n) && n >= 0;
  }

  trySpend(amount: number): boolean {
    if (!this.isValidMoneyAmount(amount) || this.money < amount) return false;
    this.money -= amount;
    return true;
  }

  earn(amount: number): void {
    if (!this.isValidMoneyAmount(amount)) return;
    this.money += amount;
  }

  /**
   * Restore the treasury to a specific amount. For serialization use only —
   * do not call this in normal gameplay logic; use trySpend/earn instead.
   */
  setMoney(amount: number): boolean {
    if (!this.isValidMoneyAmount(amount)) return false;
    this.money = amount;
    return true;
  }

  /** Count DIRT tiles currently on the map. */
  countDirt(): number {
    let count = 0;
    for (const tile of this.map.iterateTiles()) {
      if (tile.type === TileType.DIRT) count++;
    }
    return count;
  }

  /** Sum of (level × POPULATION_PER_LEVEL) across all zone tiles. Defensive ?? 0 for HMR singletons that may predate the level field. */
  getPopulation(): number {
    let sum = 0;
    for (const tile of this.map.iterateTiles()) {
      if (isZoneType(tile.type)) {
        sum += (tile.level ?? 0);
      }
    }
    return sum * POPULATION_PER_LEVEL;
  }

  /**
   * Reset to a blank city: clear the map, the tick counter, and the treasury.
   */
  reset(): void {
    this.map.reset();
    this.tickCount = 0;
    this.money = STARTING_FUNDS;
  }

  /**
   * Advance simulation by one tick.
   * Rules:
   *   1. tickCount is incremented first (post-increment means first growth fires at tick === ZONE_GROWTH_INTERVAL, not 0).
   *   2. DIRT heals to GRASS; each heal contributes to `changed`.
   *   3. Zone growth: gated on tickCount % ZONE_GROWTH_INTERVAL === 0.
   *      No snapshot needed — growth reads only ROAD type; heal never produces/removes ROAD
   *      and growth only writes `level`, so ROAD adjacency is invariant within the tick,
   *      making the pass order-independent.
   */
  tick(): WorldTickResult {
    this.tickCount++;
    let changed = 0;

    // Pass 1: DIRT→GRASS heal (unchanged behavior).
    for (const tile of this.map.iterateTiles()) {
      if (tile.type === TileType.DIRT) {
        this.map.setTile(tile.x, tile.y, createTile(tile.x, tile.y, TileType.GRASS));
        changed++;
      }
    }

    // Pass 2: Zone growth — only on growth ticks.
    if (this.tickCount % ZONE_GROWTH_INTERVAL === 0) {
      for (const tile of this.map.iterateTiles()) {
        if (!isZoneType(tile.type)) continue;
        const currentLevel = tile.level ?? 0;
        if (currentLevel >= ZONE_MAX_LEVEL) continue;
        // Grow only if at least one orthogonal neighbor is a ROAD tile.
        const { x, y } = tile;
        const neighbors = [
          this.map.getTile(x + 1, y),
          this.map.getTile(x - 1, y),
          this.map.getTile(x, y + 1),
          this.map.getTile(x, y - 1),
        ];
        const hasRoad = neighbors.some(n => n !== null && n.type === TileType.ROAD);
        if (hasRoad) {
          this.map.setTile(x, y, createTile(x, y, tile.type, currentLevel + 1));
          changed++;
        }
      }
    }

    // Tax accrues every tick from current population (no upkeep — out of scope).
    this.money += Math.floor(this.getPopulation() * TAX_PER_POP);

    return { changed };
  }
}
