/**
 * 2D grid map structure with efficient access patterns
 */

import { type Tile, createTile } from './Tile';

export class GameMap {
  private readonly width: number;
  private readonly height: number;
  private readonly tiles: Tile[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Array(width * height);

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
   * Reset every cell back to a fresh grass tile (used by "New City").
   */
  reset(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.tiles[y * this.width + x] = createTile(x, y);
      }
    }
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
