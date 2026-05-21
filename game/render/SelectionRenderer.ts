/**
 * Hover and selection highlight renderer
 */

import { Container, Graphics } from 'pixi.js';
import { tileToScreenWithHeight, ISO_CONFIG } from './IsoTransform';
import type { TileCoord, ScreenCoord } from '../types/coordinates';

export class SelectionRenderer {
  private container: Container;
  private hoverGraphics: Graphics;
  private selectedGraphics: Graphics;
  private dragPreviewGraphics: Graphics;
  private currentHover: TileCoord | null = null;
  private currentSelected: TileCoord | null = null;
  private currentDragPreview: TileCoord[] = [];
  private dragPreviewColor = 0x4a4a4a;
  /** Latest height callback injected by refreshIfDirty. Null until first call — falls back to height=0. */
  private cachedGetHeight: ((x: number, y: number) => number) | null = null;
  /** Last terrain revision seen; -1 means never synced. */
  private lastRev: number = -1;

  constructor(container: Container) {
    this.container = container;

    this.hoverGraphics = new Graphics();
    this.selectedGraphics = new Graphics();
    this.dragPreviewGraphics = new Graphics();

    this.container.addChild(this.selectedGraphics);
    this.container.addChild(this.dragPreviewGraphics); // Drag preview below hover
    this.container.addChild(this.hoverGraphics); // Hover on top
  }

  /**
   * Update hover highlight
   */
  setHover(tile: TileCoord | null): void {
    if (this.coordsEqual(this.currentHover, tile)) return;

    this.currentHover = tile;
    this.renderHover();
  }

  /**
   * Update selection highlight
   */
  setSelected(tile: TileCoord | null): void {
    if (this.coordsEqual(this.currentSelected, tile)) return;

    this.currentSelected = tile;
    this.renderSelected();
  }

  /**
   * Update drag preview (show tiles that will be affected). The caller
   * passes a tint so the preview reads as the acting tool — e.g. road
   * gray vs. a destructive red for bulldoze.
   */
  setDragPreview(tiles: TileCoord[], color = 0x4a4a4a): void {
    this.currentDragPreview = tiles;
    this.dragPreviewColor = color;
    this.renderDragPreview();
  }

  /**
   * Clear drag preview
   */
  clearDragPreview(): void {
    this.currentDragPreview = [];
    this.dragPreviewGraphics.clear();
  }

  /**
   * Unconditionally re-renders all three highlight layers.
   * Bypasses equality guards — use when terrain revision changes.
   */
  forceRedraw(): void {
    this.renderSelected();
    this.renderDragPreview();
    this.renderHover();
  }

  /**
   * Update the cached height callback on every call; redraw only when revision changes.
   * Keeps selection highlights aligned with terrain elevation each frame.
   */
  refreshIfDirty(rev: number, getHeight: (x: number, y: number) => number): void {
    this.cachedGetHeight = getHeight;
    if (rev !== this.lastRev) {
      this.lastRev = rev;
      this.forceRedraw();
    }
  }

  private renderHover(): void {
    this.hoverGraphics.clear();
    if (!this.currentHover) return;

    const h = this.cachedGetHeight?.(this.currentHover.x, this.currentHover.y) ?? 0;
    const screen = tileToScreenWithHeight(this.currentHover, h);
    this.drawHighlight(this.hoverGraphics, screen, 0xffffff, 0.3);
  }

  private renderSelected(): void {
    this.selectedGraphics.clear();
    if (!this.currentSelected) return;

    const h = this.cachedGetHeight?.(this.currentSelected.x, this.currentSelected.y) ?? 0;
    const screen = tileToScreenWithHeight(this.currentSelected, h);
    this.drawHighlight(this.selectedGraphics, screen, 0xffff00, 0.5);
  }

  private renderDragPreview(): void {
    this.dragPreviewGraphics.clear();
    if (this.currentDragPreview.length === 0) return;

    for (const tile of this.currentDragPreview) {
      const h = this.cachedGetHeight?.(tile.x, tile.y) ?? 0;
      const screen = tileToScreenWithHeight(tile, h);
      // Draw filled semi-transparent tile
      this.dragPreviewGraphics.beginPath();
      this.dragPreviewGraphics.moveTo(screen.x, screen.y);
      this.dragPreviewGraphics.lineTo(screen.x + ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2);
      this.dragPreviewGraphics.lineTo(screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT);
      this.dragPreviewGraphics.lineTo(screen.x - ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2);
      this.dragPreviewGraphics.closePath();
      this.dragPreviewGraphics.fill({ color: this.dragPreviewColor, alpha: 0.4 });
    }
  }

  private drawHighlight(graphics: Graphics, screen: ScreenCoord, color: number, alpha: number): void {
    graphics.beginPath();
    graphics.moveTo(screen.x, screen.y);
    graphics.lineTo(screen.x + ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2);
    graphics.lineTo(screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT);
    graphics.lineTo(screen.x - ISO_CONFIG.TILE_WIDTH / 2, screen.y + ISO_CONFIG.TILE_HEIGHT / 2);
    graphics.closePath();
    graphics.stroke({ color, width: 2, alpha });
  }

  private coordsEqual(a: TileCoord | null, b: TileCoord | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.x === b.x && a.y === b.y;
  }

  destroy(): void {
    this.hoverGraphics.destroy();
    this.selectedGraphics.destroy();
    this.dragPreviewGraphics.destroy();
  }
}
