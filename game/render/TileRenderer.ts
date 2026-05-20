/**
 * Tile rendering system — per-tile DisplayObject lifecycle via VisualRegistry.
 *
 * Two parallel lifecycle maps:
 *   - `tiles` (terrain)  keyed by tileIndex  (y * width + x)
 *   - `buildingById`     keyed by building id
 *
 * Terrain visual is NOT unmounted when a building is created on that tile —
 * both layers coexist.  For level 0 buildings, CubeBuildingVisual returns an
 * empty Graphics, so the terrain diamond is the sole visible element.  As the
 * building levels up the cube graphics context is swapped in-place via update().
 */

import { Container } from 'pixi.js';
import { VisualRegistry } from './visuals/visualRegistry';
import { DiamondTileVisual } from './visuals/polygon/DiamondTileVisual';
import { CubeBuildingVisual } from './visuals/polygon/CubeBuildingVisual';
import { TileType } from '../core/Tile';
import { BuildingType } from '../core/Building';
import type { World } from '../core/World';
import type { Building } from '../core/Building';

function buildRegistry(): VisualRegistry {
  const registry = new VisualRegistry();
  const allTypes: TileType[] = [
    TileType.WATER,
    TileType.DIRT,
    TileType.GRASS,
    TileType.ROAD,
    TileType.ZONE_RESIDENTIAL,
    TileType.ZONE_COMMERCIAL,
    TileType.ZONE_INDUSTRIAL,
  ];
  for (const type of allTypes) {
    registry.registerTerrain(type, DiamondTileVisual);
  }

  // Single shared CubeBuildingVisual instance for all building types
  // (cache is keyed by type, so three types share one cache map).
  const cube = new CubeBuildingVisual();
  const buildingTypes: BuildingType[] = ['residential', 'commercial', 'industrial'];
  for (const type of buildingTypes) {
    registry.registerBuilding(type, cube);
  }

  return registry;
}

interface TileEntry {
  type: TileType;
  displayObject: Container;
}

interface BuildingEntry {
  displayObject: Container;
}

export class TileRenderer {
  private terrainContainer: Container;
  private buildingContainer: Container;
  private registry: VisualRegistry;
  /** tileIndex → mounted terrain entry */
  private tiles: Map<number, TileEntry> = new Map();
  /** building id → mounted building entry */
  private buildingById: Map<number, BuildingEntry> = new Map();
  /** Set by markDirty() — triggers a full redraw of all tiles on next render(). */
  private fullDirty: boolean = true;
  /** Incremental queue populated by markTilesChanged(); drained when fullDirty is false. */
  private pendingTileChanges: { x: number; y: number }[] = [];
  /** Incremental queue populated by markBuildingsChanged(); drained when fullDirty is false. */
  private pendingBuildingChanges: number[] = [];

  constructor(terrainContainer: Container, buildingContainer: Container, registry?: VisualRegistry) {
    this.terrainContainer = terrainContainer;
    this.buildingContainer = buildingContainer;
    this.registry = registry ?? buildRegistry();
  }

  render(world: World): void {
    const map = world.getMap();
    if (this.fullDirty) {
      // ---- Terrain pass ----
      const mapWidth = map.getWidth();
      for (const tile of map.iterateTiles()) {
        const index = tile.y * mapWidth + tile.x;
        this.syncTile(index, tile.x, tile.y, tile.type, tile.level);
      }

      // ---- Building pass (full) ----
      const seenIds = new Set<number>();
      for (const building of map.getBuildings().iterBuildings()) {
        seenIds.add(building.id);
        this.syncBuilding(building);
      }
      // Unmount buildings no longer present.
      for (const [id, entry] of this.buildingById) {
        if (!seenIds.has(id)) {
          this.unmountBuilding(id, entry);
        }
      }

      this.fullDirty = false;
      // Clear pending queues: full redraw already covered those changes.
      this.pendingTileChanges = [];
      this.pendingBuildingChanges = [];
      return;
    }

    // ---- Incremental tile pass ----
    if (this.pendingTileChanges.length > 0) {
      const mapWidth = map.getWidth();
      for (const { x, y } of this.pendingTileChanges) {
        const tile = map.getTile(x, y);
        if (!tile) continue;
        const index = y * mapWidth + x;
        this.syncTile(index, tile.x, tile.y, tile.type, tile.level);
      }
      this.pendingTileChanges = [];
    }

    // ---- Incremental building pass ----
    if (this.pendingBuildingChanges.length > 0) {
      const buildings = map.getBuildings();
      for (const id of this.pendingBuildingChanges) {
        const building = buildings.getBuilding(id);
        if (building === null) {
          // Building was removed — unmount if we have it.
          const entry = this.buildingById.get(id);
          if (entry) this.unmountBuilding(id, entry);
        } else {
          this.syncBuilding(building);
        }
      }
      this.pendingBuildingChanges = [];
    }
  }

  /**
   * Enqueue building ids that changed this tick.
   * Drained on the next render() call (incremental path).
   * No-op when fullDirty is pending (full pass covers everything).
   */
  markBuildingsChanged(ids: ReadonlyArray<number>): void {
    if (ids.length === 0 || this.fullDirty) return;
    for (const id of ids) this.pendingBuildingChanges.push(id);
  }

  /**
   * Mount, update, or unmount-and-remount a single tile based on current state.
   * Terrain visual is never unmounted when a building is created on that tile —
   * both layers coexist (see file-level comment).
   */
  private syncTile(index: number, x: number, y: number, type: TileType, level: number): void {
    const existing = this.tiles.get(index);
    const visual = this.registry.getTerrain(type);
    const input = { x, y, type, level };

    if (!existing) {
      const displayObject = visual.mount(input, this.terrainContainer);
      this.tiles.set(index, { type, displayObject });
    } else if (existing.type !== type) {
      // Type changed: unmount old, mount new
      const oldVisual = this.registry.getTerrain(existing.type);
      oldVisual.unmount(existing.displayObject);
      const displayObject = visual.mount(input, this.terrainContainer);
      this.tiles.set(index, { type, displayObject });
    } else {
      visual.update(input, existing.displayObject);
    }
  }

  /** Mount or update a building's visual. */
  private syncBuilding(building: Building): void {
    const visual = this.registry.getBuilding(building.type);
    const input = {
      buildingId: building.id,
      type: building.type,
      anchor: building.anchor,
      footprint: building.footprint,
      level: building.level,
      density: building.density,
    };

    const existing = this.buildingById.get(building.id);
    if (!existing) {
      const displayObject = visual.mount(input, this.buildingContainer);
      this.buildingById.set(building.id, { displayObject });
    } else {
      visual.update(input, existing.displayObject);
    }
  }

  /** Unmount a building by id and remove from the map. */
  private unmountBuilding(id: number, entry: BuildingEntry): void {
    // We don't know the type here, but all building types share the same
    // CubeBuildingVisual instance, so any registered visual will do.
    // We can get the type from the registry if needed, but unmount only
    // calls destroy() on the displayObject — type is irrelevant.
    entry.displayObject.destroy();
    this.buildingById.delete(id);
  }

  markDirty(): void {
    this.fullDirty = true;
  }

  /** Accumulate tick-driven per-tile changes for incremental rendering. No-op when coords is empty or fullDirty is already pending. */
  markTilesChanged(coords: ReadonlyArray<{ x: number; y: number }>): void {
    if (coords.length === 0 || this.fullDirty) return;
    for (const c of coords) this.pendingTileChanges.push(c);
  }

  destroy(): void {
    // Destroy each tile's DisplayObject directly — TileRenderer owns the instances,
    // not the visual. visual.unmount() is for in-flight type-changes, not teardown.
    for (const { displayObject } of this.tiles.values()) {
      displayObject.destroy({ children: true });
    }
    this.tiles.clear();

    // Destroy building display objects.
    for (const { displayObject } of this.buildingById.values()) {
      displayObject.destroy({ children: true });
    }
    this.buildingById.clear();

    // Let each registered visual destroy its own internal cache (e.g. shared
    // Graphics objects, texture atlases). TileRenderer must not reach into
    // visual internals — that is the registry contract.
    this.registry.disposeAll();
    // Containers are owned by PixiApp — destroyed via app.destroy() cascade.
  }
}
