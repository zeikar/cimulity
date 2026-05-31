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
 *
 * When render() receives visibleBounds, only tiles inside visibleBounds.terrain
 * and buildings inside visibleBounds.buildings are kept mounted. Without
 * visibleBounds, mounts every in-bounds tile (fallback). Mode transitions
 * trigger a full rebuild via the signature compare.
 */

import { Container, Graphics } from 'pixi.js';
import { mountYardCell, updateYardCell } from './visuals/polygon/YardVisual';
import { VisualRegistry } from './visuals/visualRegistry';
import { DiamondTileVisual } from './visuals/polygon/DiamondTileVisual';
import { CubeBuildingVisual } from './visuals/polygon/CubeBuildingVisual';
import { TileType } from '../core/Tile';
import { BuildingType } from '../core/Building';
import type { World } from '../core/World';
import type { Building } from '../core/Building';
import type { Terrain } from '../core/Terrain';
import type { BuildingVisual, MapBounds } from './visuals/TileVisual';
import type { VisibleTileBounds } from './viewportCulling';
import { iterateVisibleTiles, isBuildingVisible } from './viewportCulling';
import { tileCornerHeights } from './terrain/tileCornerHeights';

/**
 * Build the visual registry: terrain visuals per TileType and the single
 * shared CubeBuildingVisual instance per BuildingType.
 */
export function buildPixiAppRegistry(): VisualRegistry {
  const registry = new VisualRegistry();
  const allTypes: TileType[] = [
    TileType.DIRT,
    TileType.GRASS,
    TileType.ROAD,
    TileType.ZONE_RESIDENTIAL,
    TileType.ZONE_COMMERCIAL,
    TileType.ZONE_INDUSTRIAL,
    TileType.POWER_PLANT,
    TileType.WATER_TOWER,
    TileType.POLICE_STATION,
    TileType.FIRE_STATION,
    TileType.HOSPITAL,
    TileType.SCHOOL,
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

const buildRegistry = buildPixiAppRegistry;

interface TileEntry {
  type: TileType;
  displayObject: Container;
}

interface BuildingEntry {
  displayObject: Container;
  // Tracked so unmount routes through the visual's lifecycle (cleans up shadow sibling Graphics).
  visual: BuildingVisual;
}

export class TileRenderer {
  private terrainContainer: Container;
  private buildingContainer: Container;
  private registry: VisualRegistry;
  /** tileIndex → mounted terrain entry */
  private tiles: Map<number, TileEntry> = new Map();
  /** building id → mounted building entry */
  private buildingById: Map<number, BuildingEntry> = new Map();
  /** `${buildingId}:${x}:${y}` → yard Graphics for non-structure lot cells */
  private yardByKey: Map<string, { gfx: Graphics; type: BuildingType }> = new Map();
  /** Set by markDirty() — triggers a full redraw of all tiles on next render(). */
  private fullDirty: boolean = true;
  /** Incremental queue populated by markTilesChanged(); drained when fullDirty is false. */
  private pendingTileChanges: { x: number; y: number }[] = [];
  /** Incremental queue populated by markBuildingsChanged(); drained when fullDirty is false. */
  private pendingBuildingChanges: number[] = [];
  /** Cached signature of the last visibleBounds passed to render(); null means no-bounds (full-map) mode. */
  private lastSig: string | null = null;
  /** Last observed terrain revision; triggers a full re-sync when it changes. */
  private lastTerrainRev: number = -1;

  constructor(terrainContainer: Container, buildingContainer: Container, registry?: VisualRegistry) {
    this.terrainContainer = terrainContainer;
    this.buildingContainer = buildingContainer;
    this.registry = registry ?? buildRegistry();
  }

  render(world: World, visibleBounds?: VisibleTileBounds): void {
    const map = world.getMap();
    const mapWidth = map.getWidth();
    const terrain = world.getTerrain();

    const newSig = this.sigOf(visibleBounds);
    const sigChanged = newSig !== this.lastSig;
    const currentRev = world.getTerrainRevision();
    const terrainDirty = currentRev !== this.lastTerrainRev;
    if (terrainDirty) this.lastTerrainRev = currentRev;
    const fullPass = this.fullDirty || sigChanged || terrainDirty;
    const mapBounds: MapBounds = { width: mapWidth, height: map.getHeight() };

    if (fullPass) {
      // ---- Terrain pass (full) ----
      if (visibleBounds) {
        for (const { x, y } of iterateVisibleTiles(visibleBounds.terrain)) {
          const tile = map.getTile(x, y);
          if (!tile) continue;
          const index = y * mapWidth + x;
          this.syncTile(index, tile.x, tile.y, tile.type, tile.level, terrain, mapBounds);
        }
        for (const [idx, entry] of this.tiles) {
          const x = idx % mapWidth;
          const y = Math.floor(idx / mapWidth);
          const b = visibleBounds.terrain;
          if (x < b.minX || x >= b.maxX || y < b.minY || y >= b.maxY) {
            this.unmountTile(idx, entry);
          }
        }
      } else {
        for (const tile of map.iterateTiles()) {
          const index = tile.y * mapWidth + tile.x;
          this.syncTile(index, tile.x, tile.y, tile.type, tile.level, terrain, mapBounds);
        }
      }

      // ---- Building pass (full) — single visibleIds set ----
      const visibleIds = new Set<number>();
      for (const b of map.getBuildings().iterBuildings()) {
        if (visibleBounds && !isBuildingVisible(b.footprint, visibleBounds.buildings)) continue;
        visibleIds.add(b.id);
        this.syncBuilding(b, terrain);
      }
      for (const [id, entry] of this.buildingById) {
        if (!visibleIds.has(id)) this.unmountBuilding(id, entry);
      }

      this.fullDirty = false;
      this.pendingTileChanges = [];
      this.pendingBuildingChanges = [];
    } else {
      // ---- Incremental tile pass ----
      if (this.pendingTileChanges.length > 0) {
        for (const { x, y } of this.pendingTileChanges) {
          if (visibleBounds) {
            const b = visibleBounds.terrain;
            if (x < b.minX || x >= b.maxX || y < b.minY || y >= b.maxY) continue;
          }
          const tile = map.getTile(x, y);
          if (!tile) continue;
          const index = y * mapWidth + x;
          this.syncTile(index, tile.x, tile.y, tile.type, tile.level, terrain, mapBounds);
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
          } else if (!visibleBounds || isBuildingVisible(building.footprint, visibleBounds.buildings)) {
            this.syncBuilding(building, terrain);
          } else {
            const entry = this.buildingById.get(id);
            if (entry) this.unmountBuilding(id, entry);
          }
        }
        this.pendingBuildingChanges = [];
      }
    }

    this.lastSig = newSig;
  }

  private sigOf(b: VisibleTileBounds | undefined): string | null {
    if (!b) return null;
    return `${b.terrain.minX},${b.terrain.maxX},${b.terrain.minY},${b.terrain.maxY}|${b.buildings.minX},${b.buildings.maxX},${b.buildings.minY},${b.buildings.maxY}`;
  }

  private unmountTile(index: number, entry: TileEntry): void {
    this.registry.getTerrain(entry.type).unmount(entry.displayObject);
    this.tiles.delete(index);
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
  private syncTile(index: number, x: number, y: number, type: TileType, level: number, terrain: Terrain, mapBounds: MapBounds): void {
    const existing = this.tiles.get(index);
    const visual = this.registry.getTerrain(type);
    const tileElevation = terrain.getTileElevation(x, y);
    const renderHeight = terrain.getRenderHeight(x, y);
    const cornerHeights = tileCornerHeights(terrain, x, y);
    const shape = terrain.getTerrainShape(x, y);
    const input = { x, y, type, level, tileElevation, renderHeight, cornerHeights, shape, mapBounds };

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
  private syncBuilding(building: Building, terrain: Terrain): void {
    const visual = this.registry.getBuilding(building.type);
    const input = {
      buildingId: building.id,
      type: building.type,
      anchor: building.anchor,
      footprint: building.footprint,
      level: building.level,
      density: building.density,
      frontage: building.frontage,
      structureRect: building.structureRect,
      renderHeight: terrain.getRenderHeight(building.structureRect.x, building.structureRect.y),
    };

    const existing = this.buildingById.get(building.id);
    if (!existing) {
      const displayObject = visual.mount(input, this.buildingContainer);
      this.buildingById.set(building.id, { displayObject, visual });
    } else {
      visual.update(input, existing.displayObject);
    }
    this.syncYardCellsForBuilding(building, terrain);
  }

  /** Unmount a building by id and remove from the map. */
  private unmountBuilding(id: number, entry: BuildingEntry): void {
    // Route through visual.unmount so sibling Graphics (e.g. drop-shadow) are cleaned up too.
    entry.visual.unmount(entry.displayObject);
    this.buildingById.delete(id);
    this.unmountYardsForBuilding(id);
  }

  /** Mount or update yard polygons for non-structure cells of a building. */
  private syncYardCellsForBuilding(building: Building, terrain: Terrain): void {
    const sr = building.structureRect;
    const isInsideStructure = (cell: { x: number; y: number }): boolean =>
      cell.x >= sr.x && cell.x < sr.x + sr.w && cell.y >= sr.y && cell.y < sr.y + sr.h;

    // Mount or update yards for non-structure cells.
    for (const cell of building.footprint) {
      const key = `${building.id}:${cell.x}:${cell.y}`;
      if (isInsideStructure(cell)) {
        // Cell is structure now — unmount any pre-existing yard graphic.
        const prev = this.yardByKey.get(key);
        if (prev) {
          prev.gfx.destroy();
          this.yardByKey.delete(key);
        }
        continue;
      }
      const existing = this.yardByKey.get(key);
      if (existing) {
        // Update — building may have changed type via merge etc.
        updateYardCell(existing.gfx, cell, building.type, terrain);
        existing.type = building.type;
      } else {
        const gfx = mountYardCell(this.terrainContainer, cell, building.type, terrain);
        this.yardByKey.set(key, { gfx, type: building.type });
      }
    }
  }

  /** Remove all yard Graphics for a given building id. */
  private unmountYardsForBuilding(id: number): void {
    const prefix = `${id}:`;
    const toRemove: string[] = [];
    for (const key of this.yardByKey.keys()) {
      if (key.startsWith(prefix)) toRemove.push(key);
    }
    for (const key of toRemove) {
      const entry = this.yardByKey.get(key);
      if (entry) {
        entry.gfx.destroy();
        this.yardByKey.delete(key);
      }
    }
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

    // Route through visual.unmount so sibling Graphics (e.g. drop-shadow) are cleaned up too.
    for (const { displayObject, visual } of this.buildingById.values()) {
      visual.unmount(displayObject);
    }
    this.buildingById.clear();

    for (const entry of this.yardByKey.values()) entry.gfx.destroy();
    this.yardByKey.clear();

    // Let each registered visual destroy its own internal cache (e.g. shared
    // Graphics objects, texture atlases). TileRenderer must not reach into
    // visual internals — that is the registry contract.
    this.registry.disposeAll();
    // Containers are owned by PixiApp — destroyed via app.destroy() cascade.
  }
}
