/**
 * Central world state container
 * Holds all game state but doesn't manage rendering
 */

import { GameMap } from './Map';
import { TileType, createTile, isZoneType } from './Tile';
import type { BuildingType } from './Building';
import { LandValueMap } from './LandValueMap';
import { Demand, DENSITY_DEMAND_THRESHOLD } from './Demand';
import type { DemandVector } from './Demand';
import { Terrain, SEA_LEVEL, projectTileHeightsToVertexHeights } from './Terrain';
import * as terrainGenerator from './terrainGenerator';
import { PowerMap, isBuildingPowered } from './PowerMap';
import { WaterMap, isBuildingWatered } from './WaterMap';
import { ServiceCoverageMap, isAnchorCovered } from './ServiceCoverageMap';
import { FireCoverageMap, isFireAnchorCovered } from './FireCoverageMap';
import { HospitalCoverageMap, isHospitalAnchorCovered } from './HospitalCoverageMap';
import { SchoolCoverageMap, isSchoolAnchorCovered } from './SchoolCoverageMap';
import { TrafficMap } from './TrafficMap';
import { LaborMarketMap } from './LaborMarketMap';
import { StructureMap } from './StructureMap';
import {
  pickSeedFrontage,
  greedyDepthLot,
  initialStructureRect,
  footprintCells,
  hasFrontageRoadAccess,
  canExtendStructure,
  extendStructureToward,
  isUnderSupported,
} from './zoneGrowth';
import { lotBboxOf } from './buildingFootprint';
import { GROWTH_COOLDOWN_INTERVALS, stagger, LEVEL_THRESHOLDS, ZONE_MAX_LEVEL } from './growthConstants';
import { canMerge, mergedBuildingShape } from './mergePolicy';
export { GROWTH_COOLDOWN_INTERVALS, stagger, LEVEL_THRESHOLDS, ZONE_MAX_LEVEL } from './growthConstants';

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
/**
 * Defense-in-depth periodic force-recompute cadence for power, mirrors LAND_VALUE_INTERVAL.
 */
export const POWER_INTERVAL = 16;
/**
 * Defense-in-depth periodic force-recompute cadence for water, mirrors POWER_INTERVAL.
 */
export const WATER_INTERVAL = 16;
/**
 * Defense-in-depth periodic force-recompute cadence for service coverage, mirrors POWER_INTERVAL.
 */
export const SERVICE_INTERVAL = 16;
/**
 * Defense-in-depth periodic force-recompute cadence for traffic, mirrors SERVICE_INTERVAL.
 */
export const TRAFFIC_INTERVAL = 16;
/**
 * Minimum growth-opportunity count (age) before a building may gain density.
 * Unit: growth opportunities (same as GROWTH_COOLDOWN_INTERVALS).
 */
export const DENSITY_COOLDOWN_INTERVALS = 24;
/** Population contribution per zone level point. */
export const POPULATION_PER_LEVEL = 10;
/** Initial city treasury balance. */
export const STARTING_FUNDS = 10000;
/** Land-value contribution weight for city happiness (W_LAND + W_JOBS + W_BUDGET = 1.0). */
export const HAPPINESS_W_LAND = 0.5;
/** Jobs-balance contribution weight for city happiness. */
export const HAPPINESS_W_JOBS = 0.3;
/** Budget-health contribution weight for city happiness. */
export const HAPPINESS_W_BUDGET = 0.2;
/** Initial/empty-city happiness value returned when no residential or jobs buildings exist. */
export const EMPTY_CITY_HAPPINESS = 0.5;
/** Tax revenue per population point per day. */
export const TAX_PER_POP = 1;
/** Cost to place one ROAD tile. */
export const ROAD_COST = 10;
/** Cost to place one zone (R/C/I) tile. */
export const ZONE_COST = 5;
/** Cost to bulldoze one tile. */
export const BULLDOZE_COST = 2;
/**
 * Cost to place a power plant (2×2 footprint). 10% of STARTING_FUNDS by design.
 */
export const POWER_PLANT_COST = 1000;
/**
 * Cost to place a water tower (2×2). Slightly cheaper than POWER_PLANT_COST=1000
 * so "place power + water before zoning" is affordable from STARTING_FUNDS=10000.
 */
export const WATER_TOWER_COST = 800;
/**
 * Cost to place a police station (2×2). Matches WATER_TOWER_COST=800 so "place
 * power + water + police before zoning" stays affordable from STARTING_FUNDS=10000.
 */
export const POLICE_STATION_COST = 800;
/**
 * Cost to place a fire station (2×2). Matches POLICE_STATION_COST=800 so "place
 * power + water + police + fire before zoning" stays affordable from STARTING_FUNDS=10000.
 */
export const FIRE_STATION_COST = 800;
/**
 * Cost to place a hospital (2×2). Mirrors FIRE_STATION_COST=800 / POLICE_STATION_COST=800 so
 * "place power + water + police + fire + hospital before zoning" stays affordable from
 * STARTING_FUNDS=10000. Tunable independently as balance requires.
 */
export const HOSPITAL_COST = 800;
/**
 * Cost to place a school (2×2). Mirrors HOSPITAL_COST=800 / FIRE_STATION_COST=800 so
 * "place power + water + police + fire + hospital + school before zoning" stays affordable from
 * STARTING_FUNDS=10000. Tunable independently as balance requires.
 */
export const SCHOOL_COST = 800;
/** Cost to place a 1×1 park — cheaper than the 800 service blocks; a small amenity; tunable. */
export const PARK_COST = 100;
/** Days per calendar month. */
export const DAYS_PER_MONTH = 30;
/** Months per calendar year. */
export const MONTHS_PER_YEAR = 12;

/**
 * Result returned by World.tick().
 *
 * Invariant: `changed === changedTiles.length` — always. `changed` is derived at
 * construction as `changedTiles.length`; it is never independently assigned.
 *
 * Every state mutation (tile write, building create, building level-up, building
 * density bump, abandonment-state flip) MUST push at least one entry into
 * `changedTiles` so that save-scheduling and render-invalidation stay correct.
 * `changed` is a count-only convenience; `changedTiles` is the canonical delta.
 *
 * Corollary: if `changedBuildingIds.length > 0` then `changedTiles.length > 0`.
 * `changedBuildingIds` is an additional channel for building-keyed render lookup —
 * it is NEVER the sole signal of change.
 *
 * Power, water, and land value are all recomputed (if dirty or on their periodic
 * cadence) as frozen snapshots before the growth pass. The growth pass reads but
 * does not mutate any of those maps.
 */
export interface WorldTickResult {
  /** Canonical per-tile delta: one entry per tile mutated this tick (DIRT→GRASS heals + zone level-ups + density bumps + abandonment-state flips). */
  changedTiles: ReadonlyArray<{ x: number; y: number }>;
  /** Count-only convenience — always equals `changedTiles.length`. */
  changed: number;
  /** IDs of buildings created, levelled-up, density-bumped, or abandonment-flipped this tick (from the zone growth pass). */
  changedBuildingIds: ReadonlyArray<number>;
}

export interface WorldDate {
  year: number;
  month: number;
  day: number;
}

/** Clamp x to [0, 1]. Mirrors the Demand.ts idiom. */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
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
  /** Derived display-only KPI; dirty/lazy like land value. NOT persisted. Read only by the HUD/tests — never feeds growth/demand/level-up. */
  private happiness: number = EMPTY_CITY_HAPPINESS;
  private happinessDirty: boolean = false;
  private demand: Demand | null = null;
  private demandDirty: boolean = true;
  private structures!: StructureMap;
  private power: PowerMap | null = null;
  private powerDirty: boolean = false;
  private water: WaterMap | null = null;
  private waterDirty: boolean = false;
  private service: ServiceCoverageMap | null = null;
  private serviceDirty: boolean = false;
  private fire: FireCoverageMap | null = null;
  private fireDirty: boolean = false;
  private hospital: HospitalCoverageMap | null = null;
  private hospitalDirty: boolean = false;
  private school: SchoolCoverageMap | null = null;
  private schoolDirty: boolean = false;
  private traffic: TrafficMap | null = null;
  private trafficDirty: boolean = false;
  private labor: LaborMarketMap | null = null;
  private laborDirty: boolean = false;

  constructor(mapWidth: number, mapHeight: number, opts?: { regenerate?: boolean }) {
    this.map = new GameMap(mapWidth, mapHeight);
    this.structures = new StructureMap(this.map.getWidth(), this.map.getHeight());
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
   * Water is derived: a cell is water iff in-bounds and any corner is at/below SEA_LEVEL.
   * Out-of-bounds coordinates return false.
   */
  isWater(x: number, y: number): boolean {
    if (this.map.getTile(x, y) === null) return false;
    return this.terrain.getTileMinCornerHeight(x, y) <= SEA_LEVEL;
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
    this.markHappinessDirty();
    return true;
  }

  earn(amount: number): void {
    if (!this.isValidMoneyAmount(amount)) return;
    this.money += amount;
    this.markHappinessDirty();
  }

  /**
   * Restore the treasury to a specific amount. For serialization use only —
   * do not call this in normal gameplay logic; use trySpend/earn instead.
   */
  setMoney(amount: number): boolean {
    if (!this.isValidMoneyAmount(amount)) return false;
    this.money = amount;
    this.markHappinessDirty();
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
    // B2 — freshness drain: land value now reads the four coverage maps, so drain
    // each coverage's dirty flag FIRST. This guarantees land value always reads
    // FRESH coverage regardless of caller.
    this.recomputeServiceIfDirty();
    this.recomputeFireIfDirty();
    this.recomputeHospitalIfDirty();
    this.recomputeSchoolIfDirty();
    const lv = this.getLandValue();
    lv.recompute(this.map, this.structures, {
      police: this.getServiceCoverageMap(),
      fire: this.getFireCoverageMap(),
      hospital: this.getHospitalCoverageMap(),
      school: this.getSchoolCoverageMap(),
    });
    this.landValueDirty = false;
    // Happiness reads land value; refreshing land value invalidates the derived happiness cache.
    this.happinessDirty = true;
  }

  /** Mark land value as needing recomputation on the next recomputeLandValueIfDirty() call. */
  markLandValueDirty(): void {
    this.dirtyLandValueAndHappiness();
  }

  /** ONE place the land-value→happiness cascade lives. Set both dirty flags together so no mutation can dirty land value without also dirtying happiness. */
  private dirtyLandValueAndHappiness(): void {
    this.landValueDirty = true;
    this.happinessDirty = true;
  }

  private markHappinessDirty(): void {
    this.happinessDirty = true;
  }

  getStructureMap(): StructureMap {
    return this.structures;
  }

  /** Lazy-allocate and return the PowerMap instance. */
  getPowerMap(): PowerMap {
    if (this.power === null) this.power = new PowerMap(this.map.getWidth(), this.map.getHeight());
    return this.power;
  }

  markPowerDirty(): void {
    this.powerDirty = true;
  }

  /** Recompute power only if dirty; clears the flag. */
  recomputePowerIfDirty(): void {
    if (!this.powerDirty) return;
    this.recomputePower();
  }

  /** Unconditional force-recompute; also clears the dirty flag. */
  recomputePower(): void {
    const pm = this.getPowerMap();
    pm.recompute(this.map, this.structures);
    this.powerDirty = false;
  }

  /** Lazy-allocate and return the WaterMap instance. */
  getWaterMap(): WaterMap {
    if (this.water === null) this.water = new WaterMap(this.map.getWidth(), this.map.getHeight());
    return this.water;
  }

  markWaterDirty(): void {
    this.waterDirty = true;
  }

  /** Recompute water only if dirty; clears the flag. */
  recomputeWaterIfDirty(): void {
    if (!this.waterDirty) return;
    this.recomputeWater();
  }

  /** Unconditional force-recompute; also clears the dirty flag. */
  recomputeWater(): void {
    const wm = this.getWaterMap();
    wm.recompute(this.map, this.structures);
    this.waterDirty = false;
  }

  /** Lazy-allocate and return the ServiceCoverageMap instance. */
  getServiceCoverageMap(): ServiceCoverageMap {
    if (this.service === null) this.service = new ServiceCoverageMap(this.map.getWidth(), this.map.getHeight());
    return this.service;
  }

  markServiceDirty(): void {
    this.serviceDirty = true;
    // B1 — dirty cascade: land value reads the four coverage maps, so any coverage
    // change must also dirty land value and happiness. Route through the shared helper.
    this.dirtyLandValueAndHappiness();
  }

  /** Recompute service coverage only if dirty; clears the flag. */
  recomputeServiceIfDirty(): void {
    if (!this.serviceDirty) return;
    this.recomputeService();
  }

  /** Unconditional force-recompute; also clears the dirty flag. */
  recomputeService(): void {
    const svc = this.getServiceCoverageMap();
    svc.recompute(this.map, this.structures);
    this.serviceDirty = false;
  }

  /** Lazy-allocate and return the FireCoverageMap instance. */
  getFireCoverageMap(): FireCoverageMap {
    if (this.fire === null) this.fire = new FireCoverageMap(this.map.getWidth(), this.map.getHeight());
    return this.fire;
  }

  markFireDirty(): void {
    this.fireDirty = true;
    this.dirtyLandValueAndHappiness(); // B1 cascade — see markServiceDirty.
  }

  /** Recompute fire coverage only if dirty; clears the flag. */
  recomputeFireIfDirty(): void {
    if (!this.fireDirty) return;
    this.recomputeFire();
  }

  /** Unconditional force-recompute; also clears the dirty flag. */
  recomputeFire(): void {
    const fireSvc = this.getFireCoverageMap();
    fireSvc.recompute(this.map, this.structures);
    this.fireDirty = false;
  }

  /** Lazy-allocate and return the HospitalCoverageMap instance. */
  getHospitalCoverageMap(): HospitalCoverageMap {
    if (this.hospital === null) this.hospital = new HospitalCoverageMap(this.map.getWidth(), this.map.getHeight());
    return this.hospital;
  }

  markHospitalDirty(): void {
    this.hospitalDirty = true;
    this.dirtyLandValueAndHappiness(); // B1 cascade — see markServiceDirty.
  }

  /** Recompute hospital coverage only if dirty; clears the flag. */
  recomputeHospitalIfDirty(): void {
    if (!this.hospitalDirty) return;
    this.recomputeHospital();
  }

  /** Unconditional force-recompute; also clears the dirty flag. */
  recomputeHospital(): void {
    const hospitalSvc = this.getHospitalCoverageMap();
    hospitalSvc.recompute(this.map, this.structures);
    this.hospitalDirty = false;
  }

  /** Lazy-allocate and return the SchoolCoverageMap instance. */
  getSchoolCoverageMap(): SchoolCoverageMap {
    if (this.school === null) this.school = new SchoolCoverageMap(this.map.getWidth(), this.map.getHeight());
    return this.school;
  }

  markSchoolDirty(): void {
    this.schoolDirty = true;
    this.dirtyLandValueAndHappiness(); // B1 cascade — see markServiceDirty.
  }

  /** Recompute school coverage only if dirty; clears the flag. */
  recomputeSchoolIfDirty(): void {
    if (!this.schoolDirty) return;
    this.recomputeSchool();
  }

  /** Unconditional force-recompute; also clears the dirty flag. */
  recomputeSchool(): void {
    const schoolSvc = this.getSchoolCoverageMap();
    schoolSvc.recompute(this.map, this.structures);
    this.schoolDirty = false;
  }

  /**
   * Lazy-allocate and return the TrafficMap instance, draining dirtiness before returning.
   *
   * NOTE: this getter DRAINS (calls recomputeTrafficIfDirty) — unlike the non-draining
   * coverage getters (e.g. getFireCoverageMap). This is the stale-free read contract:
   * callers always get a fresh snapshot without needing to manually recompute first.
   */
  getTrafficMap(): TrafficMap {
    if (this.traffic === null) this.traffic = new TrafficMap(this.map.getWidth(), this.map.getHeight());
    // Drain-on-read: coverage getters do NOT drain; traffic inverts this contract.
    this.recomputeTrafficIfDirty();
    return this.traffic;
  }

  /**
   * Mark traffic as needing recomputation on the next recomputeTrafficIfDirty() or getTrafficMap() call.
   * NO land-value/happiness cascade — traffic is DATA-ONLY and feeds nothing (unlike markServiceDirty).
   */
  markTrafficDirty(): void {
    this.trafficDirty = true;
  }

  /** Recompute traffic only if dirty; clears the flag. */
  recomputeTrafficIfDirty(): void {
    if (!this.trafficDirty) return;
    this.recomputeTraffic();
  }

  /**
   * Unconditional force-recompute; also clears the dirty flag.
   *
   * IMPORTANT: must NOT call getTrafficMap() — that drains (calls recomputeTrafficIfDirty →
   * recomputeTraffic) and would cause infinite recursion. Allocate the field directly here.
   */
  recomputeTraffic(): void {
    // Force-refresh labor FIRST (not the IfDirty variant): recompute always reflects
    // current buildings, and the cadence force-recompute path must never feed stale or
    // empty flows. recomputeLabor never calls back into traffic, so no cycle.
    this.recomputeLabor();
    // Allocate directly — never via getTrafficMap() to avoid re-entering recomputeTrafficIfDirty.
    if (this.traffic === null) this.traffic = new TrafficMap(this.map.getWidth(), this.map.getHeight());
    this.traffic.recompute(this.map, this.structures, this.getLaborMarket().getFlows());
    this.trafficDirty = false;
  }

  /**
   * Lazy-allocate and return the LaborMarketMap instance, draining dirtiness before returning.
   *
   * Mirrors getTrafficMap's drain-on-read contract: callers always get a fresh snapshot
   * without needing to manually recompute first.
   */
  getLaborMarket(): LaborMarketMap {
    if (this.labor === null) this.labor = new LaborMarketMap();
    // Drain-on-read.
    this.recomputeLaborIfDirty();
    return this.labor;
  }

  /**
   * Mark the labor market as needing recomputation on the next recomputeLaborIfDirty()
   * or getLaborMarket() call. Cascades to traffic (traffic consumes labor flows) and
   * demand (demand blends labor-market feedback scalars).
   */
  markLaborDirty(): void {
    this.laborDirty = true;
    // Traffic consumes labor flows (recomputeTraffic calls getLaborMarket().getFlows()),
    // so stale labor means stale traffic — cascade the invalidation down-dependency.
    this.trafficDirty = true;
    // Demand blends labor-market feedback — stale labor means stale demand.
    this.markDemandDirty();
  }

  /** Recompute the labor market only if dirty; clears the flag. */
  recomputeLaborIfDirty(): void {
    if (!this.laborDirty) return;
    this.recomputeLabor();
  }

  /**
   * Unconditional force-recompute; also clears the dirty flag.
   *
   * IMPORTANT: must NOT call getLaborMarket() — that drains (calls recomputeLaborIfDirty →
   * recomputeLabor) and would cause infinite recursion. Allocate the field directly here.
   */
  recomputeLabor(): void {
    // Allocate directly — never via getLaborMarket() to avoid re-entering recomputeLaborIfDirty.
    if (this.labor === null) this.labor = new LaborMarketMap();
    this.labor.recompute(this.map, this.structures, this.map.getBuildings());
    this.laborDirty = false;
  }

  /** Workers that found a job (drains labor on read). */
  getEmployed(): number {
    return this.getLaborMarket().getEmployed();
  }

  /** Workers with no job (drains labor on read). */
  getUnemployed(): number {
    return this.getLaborMarket().getUnemployed();
  }

  /** Total jobs that exist (drains labor on read). */
  getJobsCapacity(): number {
    return this.getLaborMarket().getJobsCapacity();
  }

  markDemandDirty(): void {
    this.demandDirty = true;
  }

  getDemand(): DemandVector {
    if (this.demand === null) {
      this.demand = new Demand();
    }
    if (this.demandDirty) {
      // Force-refresh labor before reading scalars — mirrors recomputeTraffic's force-refresh
      // pattern; no cycle since recomputeLabor never calls getDemand.
      this.recomputeLabor();
      const labor = this.getLaborMarket();
      this.demand.recompute(this.map.getBuildings(), {
        employed: labor.getEmployed(),
        unemployed: labor.getUnemployed(),
        reachableUnfilledJobs: labor.getReachableUnfilledJobs(),
      });
      this.demandDirty = false;
    }
    return this.demand.get();
  }

  /** Count DIRT tiles currently on the map. */
  countDirt(): number {
    let count = 0;
    for (const tile of this.map.iterateTiles()) {
      if (tile.type === TileType.DIRT) count++;
    }
    return count;
  }

  /**
   * City-wide happiness scalar in [0, 1]. Display-only KPI — never feeds growth/demand/level-up.
   * Lazy: recomputes only when inputs (land value, money, buildings) have changed since last read.
   */
  getHappiness(): number {
    this.recomputeHappinessIfDirty();
    return this.happiness;
  }

  private recomputeHappinessIfDirty(): void {
    if (!this.happinessDirty) return;
    this.recomputeHappiness();
  }

  private recomputeHappiness(): void {
    // Drain land value FIRST so anchor reads are fresh — mirrors recomputeLandValue draining coverage.
    this.recomputeLandValueIfDirty();

    let levelSumR = 0;
    let levelSumC = 0;
    let levelSumI = 0;
    let residentialCount = 0;
    let residentialLandValueSum = 0;

    for (const b of this.map.getBuildings().iterBuildings()) {
      if (b.abandoned) continue;
      if (b.type === 'residential') {
        levelSumR += b.level;
        residentialCount++;
        residentialLandValueSum += this.getLandValue().getValue(b.anchor.x, b.anchor.y);
      } else if (b.type === 'commercial') {
        levelSumC += b.level;
      } else {
        levelSumI += b.level;
      }
    }

    const jobsLevels = levelSumC + levelSumI;

    if (residentialCount === 0 && jobsLevels === 0) {
      this.happiness = EMPTY_CITY_HAPPINESS;
      this.happinessDirty = false;
      return;
    }

    const landScore = residentialCount > 0 ? clamp01(residentialLandValueSum / residentialCount) : 0;
    const jobsBalance = clamp01(1 - Math.abs(jobsLevels - levelSumR) / Math.max(jobsLevels + levelSumR, 1));
    const budgetHealth = clamp01(this.money / STARTING_FUNDS);

    this.happiness = clamp01(HAPPINESS_W_LAND * landScore + HAPPINESS_W_JOBS * jobsBalance + HAPPINESS_W_BUDGET * budgetHealth);
    this.happinessDirty = false;
  }

  /** Sum of (building.level × POPULATION_PER_LEVEL) across all buildings. Population now lives on buildings, not tiles. */
  getPopulation(): number {
    let sum = 0;
    for (const building of this.map.getBuildings().iterBuildings()) {
      if (building.abandoned) continue;
      sum += building.level;
    }
    return sum * POPULATION_PER_LEVEL;
  }

  /**
   * Reset to a blank city: clear the map, the tick counter, the calendar, and the treasury.
   * Also clears the StructureMap and zeroes the PowerMap backing array so subsequent
   * `isPowered` reads start clean.
   * installTerrain creates a fresh Terrain and bumps terrainRev — SelectionRenderer's
   * lastRev will differ from the world rev on the next frame and forceRedraw() fires once.
   *
   * @param opts.regenerate - When true (default), runs procedural terrain generation.
   *   Pass `{ regenerate: false }` to restore a flat all-MIN_LAND_ELEVATION terrain (used by
   *   deserialization hydration paths so loaded terrain is not overwritten).
   *   Water is derived from elevation — no flat canvas contains water by default.
   *   Power and water maps are both cleared and their dirty flags reset.
   * @param opts.seed - Seed for procedural generation (only used when regenerate is true).
   *   Defaults to DEFAULT_NEWCITY_SEED.
   */
  reset(opts?: { regenerate?: boolean; seed?: number }): void {
    const regenerate = opts?.regenerate ?? true;
    const seed = opts?.seed ?? terrainGenerator.DEFAULT_NEWCITY_SEED;

    this.demandDirty = true;
    this.map.reset();
    this.structures.clear();
    if (this.power !== null) this.power.clear();
    this.powerDirty = false;
    if (this.water !== null) this.water.clear();
    this.waterDirty = false;
    if (this.service !== null) this.service.clear();
    this.serviceDirty = false;
    if (this.fire !== null) this.fire.clear();
    this.fireDirty = false;
    if (this.hospital !== null) this.hospital.clear();
    this.hospitalDirty = false;
    if (this.school !== null) this.school.clear();
    this.schoolDirty = false;
    if (this.traffic !== null) this.traffic.clear();
    this.trafficDirty = false;
    if (this.labor !== null) this.labor.clear();
    this.laborDirty = false;
    this.tickCount = 0;
    this.day = 0;
    this.money = STARTING_FUNDS;
    this.landValueDirty = false;

    if (!regenerate) {
      // Flat default terrain — used by deserialization paths.
      this.installTerrain(new Terrain(this.map.getWidth(), this.map.getHeight()));
      this.recomputePowerIfDirty();
      this.recomputeWaterIfDirty();
      this.recomputeServiceIfDirty();
      this.recomputeFireIfDirty();
      this.recomputeHospitalIfDirty();
      this.recomputeSchoolIfDirty();
      // B1' — land value depends on coverage, which is now cleared/zero. Recompute
      // last so the already-allocated LandValueMap drops any stale pre-reset values.
      this.recomputeLandValue();
      // Mark happiness dirty so the next read re-derives from the fresh reset state.
      this.markHappinessDirty();
      return;
    }

    // Procedural terrain generation.
    const W = this.map.getWidth();
    const H = this.map.getHeight();
    const { elevations } = terrainGenerator.generateTerrain(W, H, seed);
    const terrain = new Terrain(W, H);
    const vertexHeights = projectTileHeightsToVertexHeights(elevations);
    for (let vy = 0; vy <= H; vy++) {
      for (let vx = 0; vx <= W; vx++) {
        terrain.unsafeSetVertexHeight(vx, vy, vertexHeights[vy][vx]);
      }
    }
    this.installTerrain(terrain);
    this.recomputePowerIfDirty();
    this.recomputeWaterIfDirty();
    this.recomputeServiceIfDirty();
    this.recomputeFireIfDirty();
    this.recomputeHospitalIfDirty();
    this.recomputeSchoolIfDirty();
    // B1' — land value depends on coverage, which is now cleared/zero. Recompute
    // last so the already-allocated LandValueMap drops any stale pre-reset values.
    this.recomputeLandValue();
    // Mark happiness dirty so the next read re-derives from the fresh reset state.
    this.markHappinessDirty();
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

    // Power: recompute if dirty, or force on periodic cadence (defense-in-depth).
    if (this.tickCount % POWER_INTERVAL === 0) {
      this.recomputePower();
    } else {
      this.recomputePowerIfDirty();
    }

    // Water: recompute if dirty, or force on periodic cadence (defense-in-depth).
    if (this.tickCount % WATER_INTERVAL === 0) {
      this.recomputeWater();
    } else {
      this.recomputeWaterIfDirty();
    }

    // Service coverage: recompute if dirty, or force on periodic cadence (defense-in-depth).
    if (this.tickCount % SERVICE_INTERVAL === 0) {
      this.recomputeService();
    } else {
      this.recomputeServiceIfDirty();
    }

    // Fire coverage: recompute if dirty, or force on periodic cadence (defense-in-depth).
    if (this.tickCount % SERVICE_INTERVAL === 0) {
      this.recomputeFire();
    } else {
      this.recomputeFireIfDirty();
    }

    // Hospital coverage: recompute if dirty, or force on periodic cadence (defense-in-depth).
    if (this.tickCount % SERVICE_INTERVAL === 0) {
      this.recomputeHospital();
    } else {
      this.recomputeHospitalIfDirty();
    }

    // School coverage: recompute if dirty, or force on periodic cadence (defense-in-depth).
    if (this.tickCount % SERVICE_INTERVAL === 0) {
      this.recomputeSchool();
    } else {
      this.recomputeSchoolIfDirty();
    }

    // Traffic: recompute if dirty, or force on periodic cadence (defense-in-depth).
    // Guard: skip the periodic force-recompute when traffic has never been allocated —
    // avoids pointless BFS allocation for an unread data-only view.
    if (this.tickCount % TRAFFIC_INTERVAL === 0 && this.traffic !== null) {
      this.recomputeTraffic();
    } else {
      this.recomputeTrafficIfDirty();
    }

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
      const pw = this.getPowerMap();
      const wm = this.getWaterMap();
      const svc = this.getServiceCoverageMap();
      const fireSvc = this.getFireCoverageMap();
      const hospitalSvc = this.getHospitalCoverageMap();
      const schoolSvc = this.getSchoolCoverageMap();

      // Abandonment sweep: runs BEFORE demand/growth so the same-tick growth reads
      // demand that already excludes the just-derelict, and so a building that
      // recovers this tick is frozen from also growing this tick. `frozenThisTick`
      // captures every building that is abandoned at sweep entry (so a re-occupied
      // building — abandoned === false after the flip — is still skipped by the
      // growth and merge loops, which a plain `abandoned` check would miss).
      const frozenThisTick = new Set<number>();
      for (const b of buildings.iterBuildings()) {
        const lvAt = lv.getValue(b.anchor.x, b.anchor.y);
        const under = isUnderSupported(b.level, lvAt);
        if (b.abandoned) {
          // Frozen regardless of whether it re-occupies this tick.
          frozenThisTick.add(b.id);
          if (!under) {
            // Was abandoned, land value now supports the level → recover.
            b.abandoned = false;
            changedBuildingIds.push(b.id);
            for (const cell of b.footprint) {
              changedTiles.push({ x: cell.x, y: cell.y });
            }
          }
        } else if (under) {
          // Land value no longer supports the level → abandon.
          b.abandoned = true;
          frozenThisTick.add(b.id);
          changedBuildingIds.push(b.id);
          for (const cell of b.footprint) {
            changedTiles.push({ x: cell.x, y: cell.y });
          }
        }
      }

      this.markDemandDirty();
      const demandVec = this.getDemand();

      for (const tile of this.map.iterateTiles()) {
        if (!isZoneType(tile.type)) continue;
        const { x, y } = tile;

        const existing = buildings.getBuildingAt(x, y);

        if (existing === null) {
          // Branch A: spawn — frontage-first greedy-depth lot selection.
          const bType = tile.type.replace('zone_', '') as BuildingType;
          // No demand for this type → no spawn. Demand at 0 means the city is
          // fully saturated for this type; let zones sit empty until pressure returns.
          if (demandVec[bType] <= 0) continue;
          // Spawn uses the seed tile directly — lot/footprint do not exist yet.
          if (!pw.isPowered(x, y)) continue;
          const frontage = pickSeedFrontage({ x, y }, this);
          if (frontage === null) continue;
          const lot = greedyDepthLot({ x, y }, frontage, tile.type, this);
          if (lot === null) continue;
          const structureRect = initialStructureRect(lot, frontage);
          const created = buildings.addBuilding({
            type: bType,
            footprint: footprintCells(lot),
            anchor: { x: lot.x, y: lot.y },
            level: 1,
            density: 0,
            age: 0,
            abandoned: false,
            frontage,
            structureRect,
          });
          if (created !== null) {
            processedBuildingIds.add(created.id);
            changedBuildingIds.push(created.id);
            for (const cell of created.footprint) {
              changedTiles.push({ x: cell.x, y: cell.y });
            }
          }
          continue;
        }

        // Branch B: building exists — de-duplicate multi-tile footprints.
        if (processedBuildingIds.has(existing.id)) continue;
        processedBuildingIds.add(existing.id);

        // Abandonment freeze: a derelict (or just-re-occupied) building does not age
        // or grow this tick. `frozenThisTick` (not `existing.abandoned`) is required —
        // a building re-occupied THIS tick is `abandoned === false` but must still be skipped.
        if (frozenThisTick.has(existing.id)) continue;

        // Road-access gate: buildings that lose frontage road access do not age or grow.
        if (!hasFrontageRoadAccess(existing, this)) continue;
        if (!isBuildingPowered(existing, pw)) continue;

        // Age every building once per growth-opportunity (this tick).
        existing.age += 1;

        const anchorLandValue = lv.getValue(existing.anchor.x, existing.anchor.y);

        if (existing.level < ZONE_MAX_LEVEL) {
          // Level-up branch: gated on demand, land value threshold, and age cooldown.
          // Demand at 0 → saturated for this type → no structure-grow, no level-up.
          const threshold = LEVEL_THRESHOLDS[existing.level + 1];
          const cooldown = GROWTH_COOLDOWN_INTERVALS + stagger(existing.id);
          // Power gates spawn AND existing-building aging/growth (the isBuildingPowered check above
          // runs before age++). Water gates the level-up / structure-grow / density / merge
          // MUTATIONS — an unwatered but powered building still ages, it just can't grow
          // (SimCity 2000/4 'city starts, density limited'). Police AND fire AND hospital AND school
          // coverage gate this gated branch's mutations ONLY (the level-up bump AND the nested Branch B'
          // structure-grow); not spawn, density, or merge.
          // Graded fields (land value, coverage) gate at the ANCHOR; binary fields (power, water)
          // scan the FOOTPRINT — any powered/watered cell satisfies the gate. This is the intended split.
          if (demandVec[existing.type] > 0 && anchorLandValue >= threshold && existing.age >= cooldown && isBuildingWatered(existing, wm) && isAnchorCovered(existing.anchor, svc) && isFireAnchorCovered(existing.anchor, fireSvc) && isHospitalAnchorCovered(existing.anchor, hospitalSvc) && isSchoolAnchorCovered(existing.anchor, schoolSvc)) {
            const lot = lotBboxOf(existing.footprint);
            if (canExtendStructure(existing.structureRect, lot, existing.frontage)) {
              // Branch B' — structure-grow before level-up.
              const grown = extendStructureToward(existing.structureRect, lot, existing.frontage);
              if (grown !== null) {
                existing.structureRect = grown;
                existing.age = 0;
                changedBuildingIds.push(existing.id);
                for (const coord of existing.footprint) {
                  changedTiles.push({ x: coord.x, y: coord.y });
                }
              }
            } else {
              // Branch B — structure cannot grow further (lot filled or cap hit); level up.
              existing.level += 1;
              existing.age = 0;
              changedBuildingIds.push(existing.id);
              for (const coord of existing.footprint) {
                changedTiles.push({ x: coord.x, y: coord.y });
              }
            }
          }
        } else {
          // Density-bump branch: building is at max level; advance density tier.
          if (
            demandVec[existing.type] >= DENSITY_DEMAND_THRESHOLD &&
            existing.age >= DENSITY_COOLDOWN_INTERVALS &&
            existing.density < 2 &&
            isBuildingWatered(existing, wm)
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

      // Branch B'' (merge): pairwise width-axis lot consolidation.
      // Multiple disjoint pairs may merge in a single growth tick — `usedThisTick`
      // ensures each building participates in at most one merge.
      const candidates = [...buildings.iterBuildings()];
      const usedThisTick = new Set<number>();
      for (let i = 0; i < candidates.length; i++) {
        const a = candidates[i];
        if (usedThisTick.has(a.id)) continue;
        if (frozenThisTick.has(a.id)) continue; // derelict / just-re-occupied — no merge this tick
        if (!hasFrontageRoadAccess(a, this)) continue;
        if (!isBuildingPowered(a, pw)) continue;
        if (!isBuildingWatered(a, wm)) continue;
        for (let j = i + 1; j < candidates.length; j++) {
          const b = candidates[j];
          if (usedThisTick.has(b.id)) continue;
          if (frozenThisTick.has(b.id)) continue; // derelict / just-re-occupied — no merge this tick
          if (!hasFrontageRoadAccess(b, this)) continue;
          if (!isBuildingPowered(b, pw)) continue;
          if (!isBuildingWatered(b, wm)) continue;
          if (!canMerge(a, b, demandVec)) continue;

          const shape = mergedBuildingShape(a, b);
          buildings.removeBuilding(a.id);
          buildings.removeBuilding(b.id);
          const merged = buildings.addBuilding(shape);
          if (merged === null) {
            throw new Error(
              `merge invariant violated: addBuilding(merged) returned null for ` +
              `a=${a.id} b=${b.id}`,
            );
          }

          usedThisTick.add(a.id);
          usedThisTick.add(b.id);
          changedBuildingIds.push(a.id, b.id, merged.id);
          for (const c of merged.footprint) changedTiles.push({ x: c.x, y: c.y });
          break; // a is used; move to next i
        }
      }

      if (changedBuildingIds.length > 0) {
        // markLaborDirty cascades to trafficDirty and markDemandDirty — single call is sufficient.
        this.markLaborDirty();
      }
    }

    // Mark happiness dirty at the END of the tick — after tax settlement (money changed) and
    // after growth/merge (building levels changed). Happiness is a display OUTPUT read lazily
    // after the tick; land value is a growth INPUT recomputed fresh before the growth pass above.
    this.markHappinessDirty();

    return { changedTiles, changed: changedTiles.length, changedBuildingIds };
  }
}
