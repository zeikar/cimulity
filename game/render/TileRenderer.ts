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
  private registry: VisualRegistry;
  /** tileIndex → mounted entry */
  private tiles: Map<number, TileEntry> = new Map();
  private isDirty: boolean = true;

  constructor(stageContainer: Container) {
    this.terrainContainer = new Container();
    stageContainer.addChild(this.terrainContainer);
    this.registry = buildRegistry();
  }

  render(map: GameMap): void {
    if (!this.isDirty) return;

    const mapWidth = map.getWidth();

    for (const tile of map.iterateTiles()) {
      const index = tile.y * mapWidth + tile.x;
      const existing = this.tiles.get(index);
      const visual = this.registry.getTerrain(tile.type);
      const input = { x: tile.x, y: tile.y, type: tile.type, level: tile.level };

      if (!existing) {
        // First mount
        const displayObject = visual.mount(input, this.terrainContainer);
        this.tiles.set(index, { type: tile.type, displayObject });
      } else if (existing.type !== tile.type) {
        // Type changed: unmount old, mount new
        const oldVisual = this.registry.getTerrain(existing.type);
        oldVisual.unmount(existing.displayObject);
        const displayObject = visual.mount(input, this.terrainContainer);
        this.tiles.set(index, { type: tile.type, displayObject });
      } else {
        // Same type: update in place
        visual.update(input, existing.displayObject);
      }
    }

    this.isDirty = false;
  }

  markDirty(): void {
    this.isDirty = true;
  }

  destroy(): void {
    for (const { type, displayObject } of this.tiles.values()) {
      this.registry.getTerrain(type).unmount(displayObject);
    }
    this.tiles.clear();
    this.terrainContainer.destroy();
  }
}
