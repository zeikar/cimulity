/**
 * TerrainTileVisual that draws the standard 64×32 isometric diamond.
 * Each tile owns its own Graphics object — no shared batch.
 */

import { Graphics, Container } from 'pixi.js';
import { projectTileCornerScreen } from '@/game/render/IsoTransform';
import type { ScreenCoord } from '@/game/types/coordinates';
import { tileFillColor } from '../palette';
import { computeTerrainZIndex } from '../../terrain/terrainZIndex';
import type { TerrainTileVisual, TileVisualInput } from '../TileVisual';
import { southSkirtVertices, eastSkirtVertices } from './DiamondOOBSkirt';
import { planDiamondShading } from './diamondShading';

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8)  & 0xff) * factor);
  const b = Math.round( (color        & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function fillTri(
  gfx: Graphics,
  a: ScreenCoord,
  b: ScreenCoord,
  c: ScreenCoord,
  color: number,
  alpha: number,
): void {
  gfx.beginPath();
  gfx.moveTo(a.x, a.y);
  gfx.lineTo(b.x, b.y);
  gfx.lineTo(c.x, c.y);
  gfx.closePath();
  gfx.fill({ color, alpha });
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

  // Per-triangle brightness + fold-line stroke from the shading plan helper.
  // See diamondShading.ts for the diagonal/brightness/stroke rules.
  // Triangles draw OVER the base fill at alpha 1.0 to fully cover it where the
  // brightness factor differs from 1.0 (the base fill stays visible only as the
  // seam-safety bleed; for brightness === 1.0 the overdraw is bit-identical).
  const plan = planDiamondShading(c);
  const shadeColor = (factor: number) => darken(fillColor, factor);
  if (plan.diagonal === 'tb') {
    fillTri(gfx, bottom, left,  top, shadeColor(plan.brightnessWest), 1.0);
    fillTri(gfx, bottom, right, top, shadeColor(plan.brightnessEast), 1.0);
    if (plan.strokeFold) {
      gfx.beginPath();
      gfx.moveTo(top.x, top.y);
      gfx.lineTo(bottom.x, bottom.y);
      gfx.stroke({ color: 0x000000, width: 1, alpha: 0.18 });
    }
  } else {
    fillTri(gfx, left, top,    right, shadeColor(plan.brightnessNorth), 1.0);
    fillTri(gfx, left, bottom, right, shadeColor(plan.brightnessSouth), 1.0);
    if (plan.strokeFold) {
      gfx.beginPath();
      gfx.moveTo(left.x, left.y);
      gfx.lineTo(right.x, right.y);
      gfx.stroke({ color: 0x000000, width: 1, alpha: 0.18 });
    }
  }

  // OOB skirt — drop a vertical quad from south/east deformed corners to a
  // floor below the world for map-edge tiles. Skip when mapBounds is unknown.
  if (input.mapBounds) {
    const southOOB = input.y === input.mapBounds.height - 1;
    const eastOOB  = input.x === input.mapBounds.width  - 1;
    if (southOOB) {
      const verts = southSkirtVertices(tile, bottom, left);
      gfx.beginPath();
      gfx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) gfx.lineTo(verts[i].x, verts[i].y);
      gfx.closePath();
      gfx.fill({ color: darken(color, 0.72) });
    }
    if (eastOOB) {
      const verts = eastSkirtVertices(tile, right, bottom);
      gfx.beginPath();
      gfx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) gfx.lineTo(verts[i].x, verts[i].y);
      gfx.closePath();
      gfx.fill({ color: darken(color, 0.55) });
    }
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
    // Geometry lemma: deformed polygon's lower bound is the flat-unlifted-at-elevation-0
    // diamond at this tile (every cornerH ≥ 0, so projected Y ≤ gridCornerY). NOT
    // sufficient for z-order globally — same-height non-adjacent tiles CAN area-overlap
    // when one tile's drops extend through another's lifted polygon. computeTerrainZIndex's
    // secondary keys (x+y) then y resolve those cases; see slopeOcclusion.test.ts.
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
