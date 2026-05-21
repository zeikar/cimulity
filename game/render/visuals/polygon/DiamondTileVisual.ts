/**
 * TerrainTileVisual that draws the standard 64×32 isometric diamond.
 * Each tile owns its own Graphics object — no shared batch.
 */

import { Graphics, Container } from 'pixi.js';
import { tileToScreenWithHeight, ISO_CONFIG } from '@/game/render/IsoTransform';
import { ELEVATION_HEIGHT } from '@/game/core';
import { tileFillColor } from '../palette';
import type { TerrainTileVisual, TileVisualInput } from '../TileVisual';

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function drawDiamond(gfx: Graphics, input: TileVisualInput): void {
  const h = input.renderHeight ?? 0;
  const screen = tileToScreenWithHeight({ x: input.x, y: input.y }, h);
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;
  const color = tileFillColor(input.type, input.level);
  const liftPx = h * ELEVATION_HEIGHT;

  // Side walls drawn FIRST so the top diamond paints over them.
  // We drop side quads to the ground (elevation 0) so the tile no longer "floats".
  // Adjacent equal-or-higher tiles cover whatever's redundant via iso draw order.
  if (liftPx > 0) {
    const right = { x: screen.x + hw, y: screen.y + hh };
    const bottom = { x: screen.x, y: screen.y + ISO_CONFIG.TILE_HEIGHT };
    const left = { x: screen.x - hw, y: screen.y + hh };
    const sideLeft = darken(color, 0.72);
    const sideRight = darken(color, 0.55);

    // South-west face: bottom → left → ground-left → ground-bottom.
    gfx.beginPath();
    gfx.moveTo(bottom.x, bottom.y);
    gfx.lineTo(left.x, left.y);
    gfx.lineTo(left.x, left.y + liftPx);
    gfx.lineTo(bottom.x, bottom.y + liftPx);
    gfx.closePath();
    gfx.fill({ color: sideLeft });

    // South-east face: right → bottom → ground-bottom → ground-right.
    gfx.beginPath();
    gfx.moveTo(right.x, right.y);
    gfx.lineTo(bottom.x, bottom.y);
    gfx.lineTo(bottom.x, bottom.y + liftPx);
    gfx.lineTo(right.x, right.y + liftPx);
    gfx.closePath();
    gfx.fill({ color: sideRight });

    // Front vertical edge — visual seam between the two side faces.
    gfx.beginPath();
    gfx.moveTo(bottom.x, bottom.y);
    gfx.lineTo(bottom.x, bottom.y + liftPx);
    gfx.stroke({ color: 0x000000, width: 1, alpha: 0.25 });
  }

  // Filled diamond (top)
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
