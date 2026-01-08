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
  private currentHover: TileCoord | null = null;
  private currentSelected: TileCoord | null = null;

  constructor(container: Container) {
    this.container = container;

    this.hoverGraphics = new Graphics();
    this.selectedGraphics = new Graphics();

    this.container.addChild(this.selectedGraphics);
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
  }
}
