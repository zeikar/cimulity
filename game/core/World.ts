/**
 * Central world state container
 * Holds all game state but doesn't manage rendering
 */

import { GameMap } from './Map';
import { TileType, createTile, isZoneType } from './Tile';
import type { BuildingType } from './Building';
import { LandValueMap } from './LandValueMap';
import { Terrain, SEA_LEVEL } from './Terrain';
import * as terrainGenerator from './terrainGenerator';

export const DEFAULT_NEWCITY_SEED = terrainGenerator.DEFAULT_NEWCITY_SEED;

/** Ticks between each zone growth step. tickCount is post-increment (≥1), so first growth fires at tick === ZONE_GROWTH_INTERVAL, not 0. */
export const ZONE_GROWTH_INTERVAL = 8;
/**
 * Periodic force-recompute cadence for land value.
 * Future-proof conservative cadence: today the dirty-mark covers every input
 * that changes the influence map (roads/zones via CommandDispatcher). A periodic
 * force-recompute is a defense-in-depth catch for any future influence input we
 * forget to dirty-mark.
 */
export const LAND_VALUE_INTERVAL = 16;
/** Maximum zone growth level a tile may reach. */
export const ZONE_MAX_LEVEL = 5;
/**
 * Land-value thresholds for level-up gating. Index 0 is reserved/unused —
 * level-0 building creation is unconditional. Indices 1–5 gate upgrade from
 * level (i-1) to level i.
 */
export const LEVEL_THRESHOLDS = [0, 0.1, 0.25, 0.45, 0.65, 0.85] as const;
/** Land-value threshold required to advance density (0→1 or 1→2). */
export const HIGH_DENSITY_THRESHOLD = 0.7;
/**
 * Minimum growth-opportunity count (age) before a building may level up.
 * Unit: growth opportunities (Branch B increments). Stagger adds 0–6 on top.
 */
export const GROWTH_COOLDOWN_INTERVALS = 8;
/**
 * Minimum growth-opportunity count (age) before a building may gain density.
 * Unit: growth opportunities (same as GROWTH_COOLDOWN_INTERVALS).
 */
export const DENSITY_COOLDOWN_INTERVALS = 24;
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

/**
 * Deterministic per-building stagger: Knuth multiplicative hash producing a
 * value in [0, 6]. Yields 0–6 extra growth-opportunity intervals of cooldown
 * jitter so buildings of the same type don't all level up in lockstep.
 * Deterministic by id — save/replay safe.
 */
export function stagger(id: number): number {
  return ((id ^ (id >>> 16)) * 2654435761 >>> 0) % 7;
}

/**
 * Result returned by World.tick().
 *
 * Invariant: `changed === changedTiles.length` — always. `changed` is derived at
 * construction as `changedTiles.length`; it is never independently assigned.
 *
 * Every state mutation (tile write, building create, building level-up, building
 * density bump) MUST push at least one entry into `changedTiles` so that
 * save-scheduling and render-invalidation stay correct. `changed` is a count-only
 * convenience; `changedTiles` is the canonical delta.
 *
 * Corollary: if `changedBuildingIds.length > 0` then `changedTiles.length > 0`.
 * `changedBuildingIds` is an additional channel for building-keyed render lookup —
 * it is NEVER the sole signal of change.
 */
export interface WorldTickResult {
  /** Canonical per-tile delta: one entry per tile mutated this tick (DIRT→GRASS heals + zone level-ups + density bumps). */
  changedTiles: ReadonlyArray<{ x: number; y: number }>;
  /** Count-only convenience — always equals `changedTiles.length`. */
  changed: number;
  /** IDs of buildings created, levelled-up, or density-bumped this tick (from the zone growth pass). */
  changedBuildingIds: ReadonlyArray<number>;
}

export interface WorldDate {
  year: number;
  month: number;
  day: number;
}

export class World {
  private map: GameMap;
  private terrain!: Terrain;
  private terrainRev: number = 0;
  private tickCount: number = 0;
  private money: number = STARTING_FUNDS;
  /** 0-based elapsed days; incremented once per tick() (1 tick = 1 day). */
  private day: number = 0;
  /** Lazily allocated on first getLandValue() call. */
  private landValue: LandValueMap | null = null;
  /** True when the influence map inputs have changed since last recompute. */
  private landValueDirty: boolean = false;

  constructor(mapWidth: number, mapHeight: number, opts?: { regenerate?: boolean }) {
    this.map = new GameMap(mapWidth, mapHeight);
    // Step 1: install a flat terrain so the field is never null.
    // installTerrain must come AFTER this.map is set so map.getWidth/Height() are available.
    this.installTerrain(new Terrain(this.map.getWidth(), this.map.getHeight()));
    // Step 2: if regenerate (default true), run procedural generation via reset().
    const regenerate = opts?.regenerate ?? true;
    if (regenerate) {
      this.reset({ regenerate: true });
    }
  }

  getMap(): GameMap {
    return this.map;
  }

  getTerrain(): Terrain {
    return this.terrain;
  }

  getTerrainRevision(): number {
    return this.terrainRev;
  }

  /**
   * Atomically swap in a new Terrain instance and wire the mutation callback.
   *
   * EXACT ordering — do NOT reorder these steps:
   *   1. Dimension validation FIRST (throws before any state change on mismatch).
   *   2. Clear the previous terrain's callback (if a previous terrain exists).
   *   3. Assign the new terrain.
   *   4. Wire the new terrain's onMutate callback to bump terrainRev.
   *   5. Bump terrainRev once for the install itself.
   *
   * Callers: constructor (initial install), World.reset(), save deserialization.
   */
  installTerrain(t: Terrain): void {
    // Step 1: validate dimensions BEFORE any state mutation.
    if (t.getWidth() !== this.map.getWidth() || t.getHeight() !== this.map.getHeight()) {
      throw new Error(
        `installTerrain: dimension mismatch — terrain (${t.getWidth()}×${t.getHeight()}) does not match map (${this.map.getWidth()}×${this.map.getHeight()})`
      );
    }
    // Step 2: clear the previous instance's callback (only if one exists — during the
    // constructor's first call, this.terrain is undefined).
    if (this.terrain !== undefined) {
      this.terrain.setOnMutate(null);
    }
    // Step 3: assign.
    this.terrain = t;
    // Step 4: wire.
    t.setOnMutate(() => { this.terrainRev++; });
    // Step 5: bump for the install itself.
    this.terrainRev++;
  }

  /**
   * Water is derived: a cell is water iff in-bounds and elevation <= SEA_LEVEL.
   * Out-of-bounds coordinates return false.
   */
  isWater(x: number, y: number): boolean {
    if (this.map.getTile(x, y) === null) return false;
    return this.terrain.getTileElevation(x, y) <= SEA_LEVEL;
  }

  /**
   * True iff the w×h footprint at (x,y) is buildable.
   * Delegates to Terrain, injecting this.isWater as the water predicate.
   */
  canBuildAt(x: number, y: number, w: number, h: number): boolean {
    return this.terrain.canBuildAt(x, y, w, h, (xx, yy) => this.isWater(xx, yy));
  }

  /**
   * True iff a road can be placed at (x,y).
   * Delegates to Terrain, injecting this.isWater as the water predicate.
   */
  canBuildRoadAt(x: number, y: number): boolean {
    return this.terrain.canBuildRoadAt(x, y, (xx, yy) => this.isWater(xx, yy));
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

  /** Lazy-allocate and return the LandValueMap instance. */
  getLandValue(): LandValueMap {
    if (this.landValue === null) {
      this.landValue = new LandValueMap(this.map.getWidth(), this.map.getHeight());
    }
    return this.landValue;
  }

  /** Recompute land value only if dirty; clears the flag. */
  recomputeLandValueIfDirty(): void {
    if (!this.landValueDirty) return;
    this.recomputeLandValue();
  }

  /** Unconditional force-recompute; also clears the dirty flag. */
  recomputeLandValue(): void {
    const lv = this.getLandValue();
    lv.recompute(this.map, this.map.getBuildings());
    this.landValueDirty = false;
  }

  /** Mark land value as needing recomputation on the next recomputeLandValueIfDirty() call. */
  markLandValueDirty(): void {
    this.landValueDirty = true;
  }

  /** Count DIRT tiles currently on the map. */
  countDirt(): number {
    let count = 0;
    for (const tile of this.map.iterateTiles()) {
      if (tile.type === TileType.DIRT) count++;
    }
    return count;
  }

  /** Sum of (building.level × POPULATION_PER_LEVEL) across all buildings. Population now lives on buildings, not tiles. */
  getPopulation(): number {
    let sum = 0;
    for (const building of this.map.getBuildings().iterBuildings()) {
      sum += building.level;
    }
    return sum * POPULATION_PER_LEVEL;
  }

  /**
   * Reset to a blank city: clear the map, the tick counter, the calendar, and the treasury.
   * installTerrain creates a fresh Terrain and bumps terrainRev — SelectionRenderer's
   * lastRev will differ from the world rev on the next frame and forceRedraw() fires once.
   *
   * @param opts.regenerate - When true (default), runs procedural terrain generation.
   *   Pass `{ regenerate: false }` to restore a flat all-zero terrain (used by
   *   deserialization hydration paths so loaded terrain is not overwritten).
   * @param opts.seed - Seed for procedural generation (only used when regenerate is true).
   *   Defaults to DEFAULT_NEWCITY_SEED.
   */
  reset(opts?: { regenerate?: boolean; seed?: number }): void {
    const regenerate = opts?.regenerate ?? true;
    const seed = opts?.seed ?? terrainGenerator.DEFAULT_NEWCITY_SEED;

    this.map.reset();
    this.tickCount = 0;
    this.day = 0;
    this.money = STARTING_FUNDS;
    this.landValueDirty = false;

    if (!regenerate) {
      // Flat default terrain — used by deserialization paths.
      this.installTerrain(new Terrain(this.map.getWidth(), this.map.getHeight()));
      return;
    }

    // Procedural terrain generation.
    const W = this.map.getWidth();
    const H = this.map.getHeight();
    const { elevations } = terrainGenerator.generateTerrain(W, H, seed);
    const terrain = new Terrain(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        terrain.unsafeSetElevation(x, y, elevations[y][x]);
      }
    }
    this.installTerrain(terrain);
  }

  /**
   * Re-run procedural terrain generation with the given seed, replacing the entire world state.
   *
   * @remarks This RESETS the entire world (map, buildings, treasury, calendar).
   * @param seed - RNG seed; defaults to DEFAULT_NEWCITY_SEED.
   */
  regenerateTerrain(seed?: number): void {
    this.reset({ regenerate: true, seed: seed ?? terrainGenerator.DEFAULT_NEWCITY_SEED });
  }

  /**
   * Advance simulation by one tick.
   * Rules:
   *   1. tickCount is incremented first (post-increment means first growth fires at tick === ZONE_GROWTH_INTERVAL, not 0).
   *   2. day is incremented too (1 tick = 1 day).
   *   3. Land value is recomputed if dirty (or on LAND_VALUE_INTERVAL cadence) BEFORE growth.
   *   4. DIRT heals to GRASS; each heal contributes to `changed`.
   *   5. Monthly tax settlement: on a month-boundary day (day % DAYS_PER_MONTH === 0),
   *      tax is settled pre-growth, so a tick that is both a growth tick and a month
   *      boundary taxes the pre-level-up population (that level-up is taxed next month).
   *   6. Zone growth: gated on tickCount % ZONE_GROWTH_INTERVAL === 0.
   *      Growth reads `landValue` as a frozen snapshot recomputed at the start of this
   *      tick (when dirty or on cadence). The growth pass mutates Building.level/density/age
   *      but NOT `landValue` or any influence input. If a future rule mutates influence
   *      inputs (roads/zones) MID-TICK, this invariant breaks — recompute or split into
   *      two passes.
   */
  tick(): WorldTickResult {
    this.tickCount++;
    this.day++; // 1 tick = 1 day
    const changedTiles: { x: number; y: number }[] = [];
    const changedBuildingIds: number[] = [];

    // Land value: recompute if dirty, or force on periodic cadence (defense-in-depth).
    if (this.tickCount % LAND_VALUE_INTERVAL === 0) {
      this.recomputeLandValue();
    } else {
      this.recomputeLandValueIfDirty();
    }

    // Pass 1: DIRT→GRASS heal (unchanged behavior).
    for (const tile of this.map.iterateTiles()) {
      if (tile.type === TileType.DIRT) {
        this.map.setTile(tile.x, tile.y, createTile(tile.x, tile.y, TileType.GRASS));
        changedTiles.push({ x: tile.x, y: tile.y });
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
      // processedBuildingIds guards multi-tile footprints so each building is
      // processed at most once per tick even if the loop visits multiple of its tiles.
      const processedBuildingIds = new Set<number>();
      const buildings = this.map.getBuildings();
      const lv = this.getLandValue();

      for (const tile of this.map.iterateTiles()) {
        if (!isZoneType(tile.type)) continue;
        const { x, y } = tile;

        // Grow only if at least one orthogonal neighbor is a ROAD tile.
        const neighbors = [
          this.map.getTile(x + 1, y),
          this.map.getTile(x - 1, y),
          this.map.getTile(x, y + 1),
          this.map.getTile(x, y - 1),
        ];
        const hasRoad = neighbors.some(n => n !== null && n.type === TileType.ROAD);
        if (!hasRoad) continue;

        const existing = buildings.getBuildingAt(x, y);

        if (existing === null) {
          // Branch A: no building yet — create a level-0 building at this single tile.
          // landValue/cooldown gating applies only to existing buildings — a tile with
          // no building yet always creates one (subject to road-adjacency only).
          // Skip slope/water tiles for growth — best-effort, no notification.
          if (!this.canBuildAt(x, y, 1, 1)) continue;
          const bType = tile.type.replace('zone_', '') as BuildingType;
          const created = buildings.addBuilding({
            type: bType,
            footprint: [{ x, y }],
            anchor: { x, y },
            level: 0,
            density: 0,
            age: 0,
          });
          if (created !== null) {
            changedBuildingIds.push(created.id);
            changedTiles.push({ x, y });
          }
          continue;
        }

        // Branch B: building exists — de-duplicate multi-tile footprints.
        if (processedBuildingIds.has(existing.id)) continue;
        processedBuildingIds.add(existing.id);

        // Age every building once per growth-opportunity (this tick).
        existing.age += 1;

        const anchorLandValue = lv.getValue(existing.anchor.x, existing.anchor.y);

        if (existing.level < ZONE_MAX_LEVEL) {
          // Level-up branch: gated on land value threshold + age cooldown.
          const threshold = LEVEL_THRESHOLDS[existing.level + 1];
          const cooldown = GROWTH_COOLDOWN_INTERVALS + stagger(existing.id);
          if (anchorLandValue >= threshold && existing.age >= cooldown) {
            existing.level += 1;
            existing.age = 0;
            changedBuildingIds.push(existing.id);
            for (const coord of existing.footprint) {
              changedTiles.push({ x: coord.x, y: coord.y });
            }
          }
        } else {
          // Density-bump branch: building is at max level; advance density tier.
          if (
            anchorLandValue >= HIGH_DENSITY_THRESHOLD &&
            existing.age >= DENSITY_COOLDOWN_INTERVALS &&
            existing.density < 2
          ) {
            existing.density += 1 as 0 | 1 | 2;
            existing.age = 0;
            changedBuildingIds.push(existing.id);
            for (const coord of existing.footprint) {
              changedTiles.push({ x: coord.x, y: coord.y });
            }
          }
        }
      }
    }

    return { changedTiles, changed: changedTiles.length, changedBuildingIds };
  }
}
