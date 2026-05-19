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
/** Tax revenue per population point per day. */
export const TAX_PER_POP = 1;
/** Cost to place one ROAD tile. */
export const ROAD_COST = 10;
/** Cost to place one zone (R/C/I) tile. */
export const ZONE_COST = 5;
/** Cost to bulldoze one tile. */
export const BULLDOZE_COST = 2;
/** Days per calendar month. */
export const DAYS_PER_MONTH = 30;
/** Months per calendar year. */
export const MONTHS_PER_YEAR = 12;

export interface WorldTickResult {
  /** Number of tiles changed this tick (DIRT→GRASS heals + zone level-ups). */
  changed: number;
}

export interface WorldDate {
  year: number;
  month: number;
  day: number;
}

export class World {
  private map: GameMap;
  private tickCount: number = 0;
  private money: number = STARTING_FUNDS;
  /** 0-based elapsed days; incremented once per tick() (1 tick = 1 day). */
  private day: number = 0;

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

  /** 1-based calendar date derived from elapsed days; day index 0 ⇒ {year:1,month:1,day:1}. */
  getDate(): WorldDate {
    const daysPerYear = DAYS_PER_MONTH * MONTHS_PER_YEAR;
    return {
      year: Math.floor(this.day / daysPerYear) + 1,
      month: Math.floor((this.day % daysPerYear) / DAYS_PER_MONTH) + 1,
      day: (this.day % DAYS_PER_MONTH) + 1,
    };
  }

  getElapsedDays(): number {
    return this.day;
  }

  /**
   * Restore elapsed days to a specific count. For serialization use only —
   * do not call this in normal gameplay logic; tick() advances the calendar.
   */
  setElapsedDays(n: number): boolean {
    // Deliberately the same whole-non-negative guard as money (isValidMoneyAmount).
    if (!(Number.isInteger(n) && n >= 0)) return false;
    // 1 tick = 1 day: set both so getTick()/getDate() stay consistent by construction.
    this.day = n;
    this.tickCount = n;
    return true;
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
   * Reset to a blank city: clear the map, the tick counter, the calendar, and the treasury.
   */
  reset(): void {
    this.map.reset();
    this.tickCount = 0;
    this.day = 0;
    this.money = STARTING_FUNDS;
  }

  /**
   * Advance simulation by one tick.
   * Rules:
   *   1. tickCount is incremented first (post-increment means first growth fires at tick === ZONE_GROWTH_INTERVAL, not 0).
   *   2. day is incremented too (1 tick = 1 day).
   *   3. DIRT heals to GRASS; each heal contributes to `changed`.
   *   4. Monthly tax settlement: on a month-boundary day (day % DAYS_PER_MONTH === 0),
   *      tax is settled pre-growth, so a tick that is both a growth tick and a month
   *      boundary taxes the pre-level-up population (that level-up is taxed next month).
   *   5. Zone growth: gated on tickCount % ZONE_GROWTH_INTERVAL === 0.
   *      No snapshot needed — growth reads only ROAD type; heal never produces/removes ROAD
   *      and growth only writes `level`, so ROAD adjacency is invariant within the tick,
   *      making the pass order-independent.
   */
  tick(): WorldTickResult {
    this.tickCount++;
    this.day++; // 1 tick = 1 day
    let changed = 0;

    // Pass 1: DIRT→GRASS heal (unchanged behavior).
    for (const tile of this.map.iterateTiles()) {
      if (tile.type === TileType.DIRT) {
        this.map.setTile(tile.x, tile.y, createTile(tile.x, tile.y, TileType.GRASS));
        changed++;
      }
    }

    // Monthly tax settlement (no per-day bucket): on a month-boundary day, settle
    // a whole month at the pre-growth population. Settled before zone growth so a
    // coincident growth+boundary tick's level-up is taxed next month. Intra-month
    // population changes are not prorated — accepted MVP tolerance.
    if (this.day % DAYS_PER_MONTH === 0) {
      this.money += Math.floor(this.getPopulation() * TAX_PER_POP) * DAYS_PER_MONTH;
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

    return { changed };
  }
}
