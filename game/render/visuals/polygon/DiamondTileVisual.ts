/**
 * TerrainTileVisual that draws the standard 64×32 isometric diamond.
 * Each tile owns its own Graphics object — no shared batch.
 */

import { Graphics, Container } from 'pixi.js';
import { tileToScreenWithHeight, ISO_CONFIG } from '@/game/render/IsoTransform';
import { tileFillColor } from '../palette';
import type { TerrainTileVisual, TileVisualInput } from '../TileVisual';
// tileSideWalls helpers will be re-wired in Task 3 (slope rendering).
// import { shouldDrawFace, wallSteps } from './tileSideWalls';

// Elevation-aware depth sort key.
//   primary   = renderHeight     — taller cells (and their south/east walls) draw on top of lower neighbors.
//   secondary = x + y            — standard iso back-to-front diagonal within one elevation band.
//   tertiary  = y                — same-diagonal tiebreaker (matches CubeBuildingVisual.computeZIndex convention).
// Scales: MAX_ELEVATION = 8, map dim ≲ few hundred → no collisions.
function computeTerrainZIndex(input: TileVisualInput): number {
  const h = input.renderHeight ?? 0;
  return h * 1_000_000 + (input.x + input.y) * 1_000 + input.y;
}

function drawDiamond(gfx: Graphics, input: TileVisualInput): void {
  const h = input.renderHeight ?? 0;
  const screen = tileToScreenWithHeight({ x: input.x, y: input.y }, h);
  const hw = ISO_CONFIG.TILE_WIDTH / 2;
  const hh = ISO_CONFIG.TILE_HEIGHT / 2;
  const color = tileFillColor(input.type, input.level);

  // Side-wall drawing removed here; Task 3 will re-implement using cornerHeights + shape.

  // Filled diamond (top)
  gfx.beginPath();
  gfx.moveTo(screen.x, screen.y);
  gfx.lineTo(screen.x + hw, screen.y + hh);
  gfx.lineTo(screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT);
  gfx.lineTo(screen.x - hw, screen.y + hh);
  gfx.closePath();
  gfx.fill({ color });

  // Per-tile outline — drawn after the fill in the same Graphics object so
  // iso draw order correctly interleaves this tile's outline with neighbor fills.
  // alignment: 1 keeps the stroke fully INSIDE the diamond so adjacent tiles
  // (mounted later in row-major order) cannot overdraw it with their fill.
  gfx.beginPath();
  gfx.moveTo(screen.x, screen.y);
  gfx.lineTo(screen.x + hw, screen.y + hh);
  gfx.lineTo(screen.x, screen.y + ISO_CONFIG.TILE_HEIGHT);
  gfx.lineTo(screen.x - hw, screen.y + hh);
  gfx.closePath();
  gfx.stroke({ color: 0x000000, width: 1, alpha: 0.35, alignment: 1 });
}

export const DiamondTileVisual: TerrainTileVisual = {
  layer: 'terrain',

  mount(input: TileVisualInput, parent: Container): Container {
    const gfx = new Graphics();
    drawDiamond(gfx, input);
    gfx.zIndex = computeTerrainZIndex(input);
    parent.addChild(gfx);
    return gfx;
  },

  update(input: TileVisualInput, displayObject: Container): void {
    const gfx = displayObject as Graphics;
    gfx.clear();
    drawDiamond(gfx, input);
    gfx.zIndex = computeTerrainZIndex(input);
  },

  unmount(displayObject: Container): void {
    displayObject.destroy();
  },
};
