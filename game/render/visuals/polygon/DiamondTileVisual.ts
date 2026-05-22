/**
 * TerrainTileVisual that draws the standard 64×32 isometric diamond.
 * Each tile owns its own Graphics object — no shared batch.
 */

import { Graphics, Container } from 'pixi.js';
import { tileToScreenWithHeight, ISO_CONFIG } from '@/game/render/IsoTransform';
import { ELEVATION_HEIGHT } from '@/game/core';
import { tileFillColor } from '../palette';
import type { TerrainTileVisual, TileVisualInput } from '../TileVisual';
import { shouldDrawFace, wallSteps } from './tileSideWalls';

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

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

  const nh = input.neighborRenderHeights;
  if (nh !== undefined) {
    const drawS = shouldDrawFace('s', h, nh.s);
    const drawE = shouldDrawFace('e', h, nh.e);
    if (drawS || drawE) {
      const right = { x: screen.x + hw, y: screen.y + hh };
      const bottom = { x: screen.x, y: screen.y + ISO_CONFIG.TILE_HEIGHT };
      const left = { x: screen.x - hw, y: screen.y + hh };
      const southWallPx = drawS ? wallSteps(h, nh.s) * ELEVATION_HEIGHT : 0;
      const eastWallPx = drawE ? wallSteps(h, nh.e) * ELEVATION_HEIGHT : 0;
      if (drawS) {
        // SW face quad: bottom → left → left+down → bottom+down, darken 0.72
        gfx.beginPath();
        gfx.moveTo(bottom.x, bottom.y);
        gfx.lineTo(left.x, left.y);
        gfx.lineTo(left.x, left.y + southWallPx);
        gfx.lineTo(bottom.x, bottom.y + southWallPx);
        gfx.closePath();
        gfx.fill({ color: darken(color, 0.72) });
      }
      if (drawE) {
        // SE face quad: right → bottom → bottom+down → right+down, darken 0.55
        gfx.beginPath();
        gfx.moveTo(right.x, right.y);
        gfx.lineTo(bottom.x, bottom.y);
        gfx.lineTo(bottom.x, bottom.y + eastWallPx);
        gfx.lineTo(right.x, right.y + eastWallPx);
        gfx.closePath();
        gfx.fill({ color: darken(color, 0.55) });
      }
      const seamPx = drawS && drawE ? Math.min(southWallPx, eastWallPx) : (drawS ? southWallPx : eastWallPx);
      if (seamPx > 0) {
        gfx.beginPath();
        gfx.moveTo(bottom.x, bottom.y);
        gfx.lineTo(bottom.x, bottom.y + seamPx);
        gfx.stroke({ color: 0x000000, width: 1, alpha: 0.25 });
      }
    }
  }

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
