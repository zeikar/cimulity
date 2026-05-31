/**
 * Tile inspector for the SELECT-tool info panel.
 *
 * Gathers a one-shot snapshot of everything the UI shows about a tile by
 * reading core maps. Lives in engine because it reads across several core
 * maps (tiles, power, water, service coverage, fire coverage, hospital coverage,
 * land value, buildings, structures) — the same downward read direction the
 * dispatcher uses.
 *
 * Land value is recomputed lazily (dirtied on edits, drained on the next
 * tick), so a fresh edit while paused would otherwise read a stale value.
 * We drain the dirty cache before snapshotting so the panel always reflects
 * the current map — power, water, and service coverage are already drained
 * eagerly by the dispatcher.
 */

import type { World } from '../core/World';
import type { TileCoord } from '../types/coordinates';
import type { TileType } from '../core/Tile';
import type { BuildingType } from '../core/Building';
import type { StructureType } from '../core/StructureMap';
import { isBuildingPowered } from '../core/PowerMap';
import { isBuildingWatered } from '../core/WaterMap';
import { SERVICE_COVERAGE_THRESHOLD_RAW } from '../core/ServiceCoverageMap';

export interface TileBuildingInfo {
  readonly type: BuildingType;
  readonly level: number;
  readonly density: 0 | 1 | 2;
  readonly age: number;
}

export interface TileInfo {
  readonly x: number;
  readonly y: number;
  readonly type: TileType;
  /** Zone growth level for zone tiles; 0 otherwise. */
  readonly level: number;
  readonly powered: boolean;
  readonly watered: boolean;
  /** Police-service coverage in [0, 1]. */
  readonly coverage: number;
  /** True when the raw coverage meets the simulation gate threshold (same gate as growth). */
  readonly serviceCovered: boolean;
  /** True when this tile's structure is a police station (the coverage source). */
  readonly isServiceSource: boolean;
  /** Fire-service coverage in [0, 1]. */
  readonly fireCoverage: number;
  /** True when the raw fire coverage meets the simulation gate threshold (same gate as growth). */
  readonly fireServiceCovered: boolean;
  /** True when this tile's structure is a fire station (the fire coverage source). */
  readonly isFireSource: boolean;
  /** Hospital-service coverage in [0, 1]. */
  readonly hospitalCoverage: number;
  /** True when the raw hospital coverage meets the simulation gate threshold (same gate as growth). */
  readonly hospitalServiceCovered: boolean;
  /** True when this tile's structure is a hospital (the hospital coverage source). */
  readonly isHospitalSource: boolean;
  /** Land value in [0, 1]. */
  readonly landValue: number;
  /** Grown building occupying this tile, if any. */
  readonly building: TileBuildingInfo | null;
  /** Player-placed structure (e.g. power plant) occupying this tile, if any. */
  readonly structure: { readonly type: StructureType } | null;
}

/**
 * Snapshot the inspectable state of a single tile. Returns null for
 * out-of-bounds coordinates (no tile exists there).
 */
export function inspectTile(world: World, coord: TileCoord): TileInfo | null {
  const tile = world.getMap().getTile(coord.x, coord.y);
  if (tile === null) return null;

  // Drain the lazily-recomputed land-value cache so an edit made while paused
  // is reflected immediately instead of showing the pre-edit value.
  world.recomputeLandValueIfDirty();

  const building = world.getMap().getBuildings().getBuildingAt(coord.x, coord.y);
  const structure = world.getStructureMap().getStructureAt(coord.x, coord.y);
  const power = world.getPowerMap();
  const water = world.getWaterMap();
  const svc = world.getServiceCoverageMap();
  const fire = world.getFireCoverageMap();
  const hospital = world.getHospitalCoverageMap();

  // Report each utility at the entity level, not the raw cell, to match how the
  // simulation reasons about it:
  //  - A structure is a SOURCE for exactly one utility (a power plant for power, a
  //    water tower for water). Its footprint cells are never marked served on EITHER
  //    network, but reporting "No Power" on the plant / "No Water" on the tower is
  //    nonsensical — show the source utility active, and the OTHER inactive (the
  //    structure does not sit on that network).
  //  - A building counts as served if ANY footprint cell is (isBuildingPowered /
  //    isBuildingWatered) — the predicate growth uses; per-cell would falsely show
  //    interior tiles as unserved even though the building is served.
  //  - A bare tile reports its own cell.
  const powered = structure
    ? structure.type === 'power_plant'
    : building
      ? isBuildingPowered(building, power)
      : power.isPowered(coord.x, coord.y);
  const watered = structure
    ? structure.type === 'water_tower'
    : building
      ? isBuildingWatered(building, water)
      : water.isWatered(coord.x, coord.y);

  // Police coverage: a police_station tile is the source — its footprint cells
  // are excluded from the coverage sweep, so we report coverage 0/false for it
  // (matching the power_plant/water_tower source exclusion pattern). All other
  // tiles read the raw cell value and apply the same raw threshold as the gate.
  const isServiceSource = structure !== null && structure.type === 'police_station';
  const coverageRaw = isServiceSource ? 0 : svc.getCoverage(coord.x, coord.y);
  const coverage = coverageRaw / 255;
  const serviceCovered = isServiceSource ? false : coverageRaw >= SERVICE_COVERAGE_THRESHOLD_RAW;

  // Fire coverage: a fire_station tile is the source — same source-exclusion
  // pattern as the police readout above.
  const isFireSource = structure !== null && structure.type === 'fire_station';
  const fireRaw = isFireSource ? 0 : fire.getCoverage(coord.x, coord.y);
  const fireCoverage = fireRaw / 255;
  const fireServiceCovered = isFireSource ? false : fireRaw >= SERVICE_COVERAGE_THRESHOLD_RAW;

  // Hospital coverage: a hospital tile is the source — same source-exclusion
  // pattern as the police/fire readout above.
  const isHospitalSource = structure !== null && structure.type === 'hospital';
  const hospitalRaw = isHospitalSource ? 0 : hospital.getCoverage(coord.x, coord.y);
  const hospitalCoverage = hospitalRaw / 255;
  const hospitalServiceCovered = isHospitalSource ? false : hospitalRaw >= SERVICE_COVERAGE_THRESHOLD_RAW;

  return {
    x: coord.x,
    y: coord.y,
    type: tile.type,
    level: tile.level,
    powered,
    watered,
    coverage,
    serviceCovered,
    isServiceSource,
    fireCoverage,
    fireServiceCovered,
    isFireSource,
    hospitalCoverage,
    hospitalServiceCovered,
    isHospitalSource,
    landValue: world.getLandValue().getValue(coord.x, coord.y),
    building: building
      ? {
          type: building.type,
          level: building.level,
          density: building.density,
          age: building.age,
        }
      : null,
    structure: structure ? { type: structure.type } : null,
  };
}
