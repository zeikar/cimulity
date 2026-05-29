/**
 * Tile inspector for the SELECT-tool info panel.
 *
 * Gathers a one-shot snapshot of everything the UI shows about a tile by
 * reading core maps. Lives in engine because it reads across several core
 * maps (tiles, power, land value, buildings, structures) — the same downward
 * read direction the dispatcher uses.
 *
 * Land value is recomputed lazily (dirtied on edits, drained on the next
 * tick), so a fresh edit while paused would otherwise read a stale value.
 * We drain the dirty cache before snapshotting so the panel always reflects
 * the current map — power is already drained eagerly by the dispatcher.
 */

import type { World } from '../core/World';
import type { TileCoord } from '../types/coordinates';
import type { TileType } from '../core/Tile';
import type { BuildingType } from '../core/Building';
import type { StructureType } from '../core/StructureMap';
import { isBuildingPowered } from '../core/PowerMap';

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

  // Report power at the entity level, not the raw cell, to match how the
  // simulation reasons about it:
  //  - A power plant is a SOURCE; its footprint cells are never marked powered,
  //    but reporting "No Power" on the plant itself is nonsensical — show powered.
  //  - A building counts as powered if ANY footprint cell is (isBuildingPowered),
  //    which is the predicate growth uses; per-cell would falsely show interior
  //    tiles as unpowered even though the building is served.
  //  - A bare tile reports its own cell.
  const powered = structure
    ? true
    : building
      ? isBuildingPowered(building, power)
      : power.isPowered(coord.x, coord.y);

  return {
    x: coord.x,
    y: coord.y,
    type: tile.type,
    level: tile.level,
    powered,
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
