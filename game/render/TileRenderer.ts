/**
 * Tile rendering system optimized for 4096 tiles
 *
 * Performance Strategy:
 * 1. Use PixiJS Graphics object pool (not individual sprites per tile)
 * 2. Batch draw all tiles of same type together
 * 3. Only render tiles in viewport (frustum culling)
 * 4. Cache Graphics objects, redraw only on zoom/type change
 */

import { Container, Graphics } from 'pixi.js';
import { tileToScreen, ISO_CONFIG } from './IsoTransform';
import type { GameMap } from '../core/Map';
import type { TileType } from '../core/Tile';

// Color palette for tile types
const TILE_COLORS: Record<TileType, number> = {
  grass: 0x4a9e3d,
  dirt: 0x8b6f47,
  water: 0x2e6ba3,
  road: 0x4a4a4a,
};

export class TileRenderer {
  private container: Container;
  private graphics: Graphics;
  private isDirty: boolean = true;

  constructor(container: Container) {
    this.container = container;
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  /**
   * Render all tiles (called once, then cached)
   * For MVP-0: Render all tiles. For MVP-1: Add frustum culling
   */
  render(map: GameMap): void {
    if (!this.isDirty) return;

    this.graphics.clear();

    // Draw each tile individually for now (simpler, will optimize later)
    for (let y = 0; y < map.getHeight(); y++) {
      for (let x = 0; x < map.getWidth(); x++) {
        const tile = map.getTile(x, y);
        if (tile) {
          const screen = tileToScreen({ x: tile.x, y: tile.y });
          const color = TILE_COLORS[tile.type];

          // Draw filled diamond
          this.graphics.beginPath();
          this.graphics.moveTo(screen.x, screen.y);
          this.graphics.lineTo(screen.x + ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2);
          this.graphics.lineTo(screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT);
          this.graphics.lineTo(screen.x - ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2);
          this.graphics.closePath();
          this.graphics.fill({ color });

          // Draw outline
          this.graphics.beginPath();
          this.graphics.moveTo(screen.x, screen.y);
          this.graphics.lineTo(screen.x + ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2);
          this.graphics.lineTo(screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT);
          this.graphics.lineTo(screen.x - ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2);
          this.graphics.closePath();
          this.graphics.stroke({ color: 0x000000, width: 1, alpha: 0.3 });
        }
      }
    }

    this.isDirty = false;
  }

  /**
   * Get diamond points for a tile
   */
  private getTilePoints(x: number, y: number): number[] {
    const screen = tileToScreen({ x, y });
    return [
      screen.x, screen.y,                                    // Top vertex
      screen.x + ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2, // Right
      screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT,          // Bottom
      screen.x - ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2, // Left
    ];
  }

  /**
   * Mark renderer as needing redraw
   */
  markDirty(): void {
    this.isDirty = true;
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
