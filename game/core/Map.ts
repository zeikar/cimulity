/**
 * 2D grid map structure with efficient access patterns
 */

import { type Tile, createTile, isZoneType } from './Tile';
import { BuildingMap, type Building } from './Building';

export class GameMap {
  private readonly width: number;
  private readonly height: number;
  private readonly tiles: Tile[];
  private readonly buildingMap: BuildingMap;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Array(width * height);
    this.buildingMap = new BuildingMap(width, height);

    // Initialize all tiles
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.tiles[y * width + x] = createTile(x, y);
      }
    }
  }

  /**
   * Get tile at grid coordinates (bounds-checked)
   */
  getTile(x: number, y: number): Tile | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.tiles[y * this.width + x];
  }

  /**
   * Get tile by flat index (for iteration)
   */
  getTileByIndex(index: number): Tile {
    return this.tiles[index];
  }

  /**
   * Set tile at grid coordinates (bounds-checked)
   * Returns true on write, false when out-of-bounds
   */
  setTile(x: number, y: number, tile: Tile): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    // For MVP-0, mutations are acceptable since no history needed
    // For MVP-1+, implement immutable updates
    this.tiles[y * this.width + x] = tile;
    return true;
  }

  /**
   * Atomic tile write + building reconciliation.
   *
   * If the incoming tile type matches the current type, returns { changed: false, removedBuilding: null } — no write, no cost.
   * If the current tile is zoned AND the new type differs, snapshots the owning Building (if any) BEFORE
   * removing it, then writes the new tile. Returns the snapshot so callers can emit the removed id + footprint.
   * For non-zoned → non-zoned rewrites (e.g. ROAD→DIRT bulldoze) no building removal occurs.
   *
   * POWER_PLANT and WATER_TOWER tile rewrites at this layer do NOT auto-remove the owning StructureMap entry
   * — that is the dispatcher's responsibility via the `remove-structure` command path.
   */
  setTileAndReconcile(x: number, y: number, tile: Tile): { changed: boolean; removedBuilding: Building | null } {
    const current = this.getTile(x, y);
    if (!current) return { changed: false, removedBuilding: null };
    // Same-type: no write needed
    if (current.type === tile.type) return { changed: false, removedBuilding: null };

    let removedBuilding: Building | null = null;
    // If current tile is zoned and the type is changing, remove any owning building first
    if (isZoneType(current.type)) {
      const existing = this.buildingMap.getBuildingAt(x, y);
      if (existing !== null) {
        // Snapshot before removal so caller gets the full footprint + id
        removedBuilding = existing;
        this.buildingMap.removeBuilding(existing.id);
      }
    }

    this.tiles[y * this.width + x] = tile;
    return { changed: true, removedBuilding };
  }

  /**
   * Reset every cell back to a fresh grass tile (used by "New City").
   */
  reset(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.tiles[y * this.width + x] = createTile(x, y);
      }
    }
    this.buildingMap.clear();
  }

  getBuildings(): BuildingMap {
    return this.buildingMap;
  }

  get totalTiles(): number {
    return this.tiles.length;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  // Iterator support for efficient rendering
  *iterateTiles(): Generator<Tile> {
    for (const tile of this.tiles) {
      yield tile;
    }
  }
}
