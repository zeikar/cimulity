/**
 * Hover and selection highlight renderer
 */

import { Container, Graphics } from 'pixi.js';
import { tileToScreen, ISO_CONFIG } from './IsoTransform';
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

  private renderHover(): void {
    this.hoverGraphics.clear();
    if (!this.currentHover) return;

    const screen = tileToScreen(this.currentHover);
    this.drawHighlight(this.hoverGraphics, screen, 0xffffff, 0.3);
  }

  private renderSelected(): void {
    this.selectedGraphics.clear();
    if (!this.currentSelected) return;

    const screen = tileToScreen(this.currentSelected);
    this.drawHighlight(this.selectedGraphics, screen, 0xffff00, 0.5);
  }

  private renderDragPreview(): void {
    this.dragPreviewGraphics.clear();
    if (this.currentDragPreview.length === 0) return;

    for (const tile of this.currentDragPreview) {
      const screen = tileToScreen(tile);
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
