/**
 * TerrainTileVisual that draws the standard 64×32 isometric diamond.
 * Each tile owns its own Graphics object — no shared batch.
 */

import { Graphics, Container } from 'pixi.js';
import { projectTileCornerScreen } from '@/game/render/IsoTransform';
import { tileFillColor } from '../palette';
import { computeTerrainZIndex } from '../../terrain/terrainZIndex';
import type { TerrainTileVisual, TileVisualInput } from '../TileVisual';

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8)  & 0xff) * factor);
  const b = Math.round( (color        & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function drawDiamond(gfx: Graphics, input: TileVisualInput): void {
  const h = input.renderHeight ?? 0;
  const c = input.cornerHeights ?? { topH: h, rightH: h, bottomH: h, leftH: h };
  const color = tileFillColor(input.type, input.level);
  // rough = ambiguous slope; geometry remains smooth, only base fill darkens.
  const fillColor = input.shape === 'rough' ? darken(color, 0.85) : color;

  // Geometry from tileCornerHeights via projectTileCornerScreen. In-bounds
  // adjacencies are continuous — no wall renderer. Per-triangle shading
  // provides depth cue for cardinal/diagonal slopes.
  const tile = { x: input.x, y: input.y };
  const top    = projectTileCornerScreen(tile, 'top',    c.topH);
  const right  = projectTileCornerScreen(tile, 'right',  c.rightH);
  const bottom = projectTileCornerScreen(tile, 'bottom', c.bottomH);
  const left   = projectTileCornerScreen(tile, 'left',   c.leftH);

  // Filled deformed top
  gfx.beginPath();
  gfx.moveTo(top.x, top.y);
  gfx.lineTo(right.x, right.y);
  gfx.lineTo(bottom.x, bottom.y);
  gfx.lineTo(left.x, left.y);
  gfx.closePath();
  gfx.fill({ color: fillColor });

  // Per-triangle shading (depth cue for slopes; uses ORIGINAL color, not fillColor)
  const maxH = Math.max(c.topH, c.rightH, c.bottomH, c.leftH);
  const southMean = (c.bottomH + c.leftH + c.topH) / 3;
  const eastMean  = (c.bottomH + c.rightH + c.topH) / 3;
  if (southMean < maxH) {
    gfx.beginPath();
    gfx.moveTo(bottom.x, bottom.y);
    gfx.lineTo(left.x, left.y);
    gfx.lineTo(top.x, top.y);
    gfx.closePath();
    gfx.fill({ color: darken(color, 0.78), alpha: 0.55 });
  }
  if (eastMean < maxH) {
    gfx.beginPath();
    gfx.moveTo(bottom.x, bottom.y);
    gfx.lineTo(right.x, right.y);
    gfx.lineTo(top.x, top.y);
    gfx.closePath();
    gfx.fill({ color: darken(color, 0.65), alpha: 0.55 });
  }

  // Per-tile outline — drawn after fill in same Graphics object so the
  // renderer's z-sort interleaves this tile's outline with neighbor fills.
  // alignment: 1 keeps the stroke fully INSIDE the deformed quad so adjacent
  // tiles (mounted later in row-major order) cannot overdraw it with their fill.
  gfx.beginPath();
  gfx.moveTo(top.x, top.y);
  gfx.lineTo(right.x, right.y);
  gfx.lineTo(bottom.x, bottom.y);
  gfx.lineTo(left.x, left.y);
  gfx.closePath();
  gfx.stroke({ color: 0x000000, width: 1, alpha: 0.35, alignment: 1 });
}

export const DiamondTileVisual: TerrainTileVisual = {
  layer: 'terrain',

  mount(input: TileVisualInput, parent: Container): Container {
    const gfx = new Graphics();
    drawDiamond(gfx, input);
    gfx.zIndex = computeTerrainZIndex(input.renderHeight ?? 0, input.x, input.y);
    parent.addChild(gfx);
    return gfx;
  },

  update(input: TileVisualInput, displayObject: Container): void {
    const gfx = displayObject as Graphics;
    gfx.clear();
    drawDiamond(gfx, input);
    gfx.zIndex = computeTerrainZIndex(input.renderHeight ?? 0, input.x, input.y);
  },

  unmount(displayObject: Container): void {
    displayObject.destroy();
  },
};
