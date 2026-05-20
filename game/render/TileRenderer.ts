/**
 * Tile rendering system — per-tile DisplayObject lifecycle via VisualRegistry.
 *
 * Each tile owns its own Graphics (mounted via DiamondTileVisual).
 * On dirty render: mount new tiles, update existing ones, unmount tiles whose
 * type changed (so a type-change = unmount old + mount new).
 */

import { Container } from 'pixi.js';
import { VisualRegistry } from './visuals/visualRegistry';
import { DiamondTileVisual } from './visuals/polygon/DiamondTileVisual';
import { TileType } from '../core/Tile';
import type { GameMap } from '../core/Map';

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
  return registry;
}

interface TileEntry {
  type: TileType;
  displayObject: Container;
}

export class TileRenderer {
  private terrainContainer: Container;
  private buildingContainer: Container;
  private registry: VisualRegistry;
  /** tileIndex → mounted entry */
  private tiles: Map<number, TileEntry> = new Map();
  /** Set by markDirty() — triggers a full redraw of all tiles on next render(). */
  private fullDirty: boolean = true;
  /** Incremental queue populated by markTilesChanged(); drained when fullDirty is false. */
  private pendingTileChanges: { x: number; y: number }[] = [];

  constructor(terrainContainer: Container, buildingContainer: Container, registry?: VisualRegistry) {
    this.terrainContainer = terrainContainer;
    this.buildingContainer = buildingContainer;
    this.registry = registry ?? buildRegistry();
  }

  render(map: GameMap): void {
    if (this.fullDirty) {
      const mapWidth = map.getWidth();
      for (const tile of map.iterateTiles()) {
        const index = tile.y * mapWidth + tile.x;
        this.syncTile(index, tile.x, tile.y, tile.type, tile.level);
      }
      this.fullDirty = false;
      // Clear the pending queue: full redraw already covered those coords.
      this.pendingTileChanges = [];
      return;
    }

    if (this.pendingTileChanges.length === 0) return;

    const mapWidth = map.getWidth();
    for (const { x, y } of this.pendingTileChanges) {
      const tile = map.getTile(x, y);
      if (!tile) continue;
      const index = y * mapWidth + x;
      this.syncTile(index, tile.x, tile.y, tile.type, tile.level);
    }
    this.pendingTileChanges = [];
  }

  /**
   * Mount, update, or unmount-and-remount a single tile based on current state.
   * Single point of layer routing — Task 12 will branch terrain vs building visuals here.
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

  markDirty(): void {
    this.fullDirty = true;
  }

  /** Accumulate tick-driven per-tile changes for incremental rendering. No-op when coords is empty or fullDirty is already pending. */
  markTilesChanged(coords: ReadonlyArray<{ x: number; y: number }>): void {
    if (coords.length === 0 || this.fullDirty) return;
    for (const c of coords) this.pendingTileChanges.push(c);
  }

  destroy(): void {
    for (const { type, displayObject } of this.tiles.values()) {
      this.registry.getTerrain(type).unmount(displayObject);
    }
    this.tiles.clear();
    // Containers are owned by PixiApp — destroyed via app.destroy() cascade.
  }
}
