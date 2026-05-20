/**
 * TerrainTileVisual that draws the standard 64×32 isometric diamond.
 * Each tile owns its own Graphics object — no shared batch.
 */

import { Graphics, Container } from 'pixi.js';
import { tileToScreen, ISO_CONFIG } from '@/game/render/IsoTransform';
import { tileFillColor } from '../palette';
import type { TerrainTileVisual, TileVisualInput } from '../TileVisual';

function drawDiamond(gfx: Graphics, input: TileVisualInput): void {
  const screen = tileToScreen({ x: input.x, y: input.y });
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;
  const color = tileFillColor(input.type, input.level);

  // Filled diamond
  gfx.beginPath();
  gfx.moveTo(screen.x, screen.y);
  gfx.lineTo(screen.x + hw, screen.y + hh);
  gfx.lineTo(screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT);
  gfx.lineTo(screen.x - hw, screen.y + hh);
  gfx.closePath();
  gfx.fill({ color });

  // Outline
  gfx.beginPath();
  gfx.moveTo(screen.x, screen.y);
  gfx.lineTo(screen.x + hw, screen.y + hh);
  gfx.lineTo(screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT);
  gfx.lineTo(screen.x - hw, screen.y + hh);
  gfx.closePath();
  gfx.stroke({ color: 0x000000, width: 1, alpha: 0.3 });
}

export const DiamondTileVisual: TerrainTileVisual = {
  layer: 'terrain',

  mount(input: TileVisualInput, parent: Container): Container {
    const gfx = new Graphics();
    drawDiamond(gfx, input);
    parent.addChild(gfx);
    return gfx;
  },

  update(input: TileVisualInput, displayObject: Container): void {
    const gfx = displayObject as Graphics;
    gfx.clear();
    drawDiamond(gfx, input);
  },

  unmount(displayObject: Container): void {
    displayObject.destroy();
  },
};
