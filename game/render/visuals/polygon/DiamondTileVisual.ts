/**
 * TerrainTileVisual that draws the standard 64×32 isometric diamond.
 * Each tile owns its own Graphics object — no shared batch.
 */

import { Graphics, Container } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { projectTileCornerScreen } from '@/game/render/IsoTransform';
import type { ScreenCoord } from '@/game/types/coordinates';
import { tileFillColor, WATER_COLOR, cornersRenderAsWater } from '../palette';
import { computeTerrainZIndex } from '../../terrain/terrainZIndex';
import type { TerrainTileVisual, TileVisualInput } from '../TileVisual';
import { southSkirtVertices, eastSkirtVertices } from './DiamondOOBSkirt';
import { planDiamondShading } from './diamondShading';
import { terrainTriFillMatrix, type Uv } from './terrainTriFillMatrix';
import { getGrassTexture, getWaterTexture } from './faceTexture';

// Terrain texture pixels per grid cell (shared by grass + water). A 384px tile
// then repeats roughly every 1.5 cells (UV is fed in texture-px; Pixi divides by
// source size for UVs).
const TERRAIN_TEXTURE_PX_PER_CELL = 256;

// UV of a corner from its shared integer grid-vertex coord. Neighbouring tiles
// feed identical coords for a shared corner, so the texture is seamless across
// tile boundaries.
function terrainCornerUv(vx: number, vy: number): Uv {
  return { u: vx * TERRAIN_TEXTURE_PX_PER_CELL, v: vy * TERRAIN_TEXTURE_PX_PER_CELL };
}

// Extra darken applied to rough (ambiguous-slope) tiles on top of Lambert
// shading, as a readability cue. Baked into the flat fill colour AND carried
// into the textured-grass tint so textured rough tiles keep the same cue.
const ROUGH_SHAPE_DARKEN = 0.85;

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

// Same triangle path as fillTri, but filled with a texture skewed onto the
// triangle (textureSpace 'global' so the matrix maps texture-px -> local-px) and
// tinted — for grass, tint = white × Lambert factor so the texture shows dimmed.
function fillTexturedTri(
  gfx: Graphics,
  a: ScreenCoord,
  b: ScreenCoord,
  c: ScreenCoord,
  uvA: Uv,
  uvB: Uv,
  uvC: Uv,
  texture: Texture,
  tint: number,
): void {
  gfx.beginPath();
  gfx.moveTo(a.x, a.y);
  gfx.lineTo(b.x, b.y);
  gfx.lineTo(c.x, c.y);
  gfx.closePath();
  gfx.fill({
    texture,
    matrix: terrainTriFillMatrix(a, b, c, uvA, uvB, uvC),
    color: tint,
    textureSpace: 'global',
  });
}

// One shaded surface triangle. Land grass triangles draw the grass texture and
// water triangles draw the water texture (both dimmed by the Lambert factor);
// everything else — non-grass land tiles and the headless / load-failure
// fallback (texture === null) — keeps the existing flat Lambert-shaded colour
// fill, byte-identical to before. UVs come from the shared tile-vertex grid, so
// both textures are seamless across tile boundaries.
function shadeTri(
  gfx: Graphics,
  a: ScreenCoord,
  b: ScreenCoord,
  c: ScreenCoord,
  uvA: Uv,
  uvB: Uv,
  uvC: Uv,
  brightness: number,
  isWater: boolean,
  flatColor: number,
  grassTex: Texture | null,
  waterTex: Texture | null,
  roughFactor: number,
): void {
  if (isWater) {
    if (waterTex) {
      fillTexturedTri(gfx, a, b, c, uvA, uvB, uvC, waterTex, darken(0xffffff, brightness));
    } else {
      fillTri(gfx, a, b, c, darken(WATER_COLOR, brightness), 1.0);
    }
  } else if (grassTex) {
    // flatColor already bakes the rough darken; the textured tint starts from
    // white, so apply roughFactor here to keep the rough cue on textured grass.
    fillTexturedTri(gfx, a, b, c, uvA, uvB, uvC, grassTex, darken(0xffffff, brightness * roughFactor));
  } else {
    fillTri(gfx, a, b, c, darken(flatColor, brightness), 1.0);
  }
}

function drawDiamond(gfx: Graphics, input: TileVisualInput): void {
  const h = input.renderHeight ?? 0;
  const c = input.cornerHeights ?? { topH: h, rightH: h, bottomH: h, leftH: h };
  const color = tileFillColor(input.type, input.level, input.tileElevation);
  // rough = ambiguous slope shape; the 0.85 base-fill darken is an EXTRA visual cue
  // on top of Lambert shading. But cornerHeights = MIN-of-4-neighbors can collapse a
  // "rough" tile (e.g. an isolated peak with all 4 cardinals lower → slopeMask=15)
  // to a flat-rendered diamond — every corner at the same lower elevation. In that
  // case the tile shows as a flat patch but the unconditional 0.85 darken made it
  // visibly darker than its (truly flat) neighbors. Skip the darken when the rendered
  // surface is itself flat (all 4 corner heights equal) — Lambert is already 1.0 there.
  const renderedFlat = c.topH === c.rightH && c.rightH === c.bottomH && c.bottomH === c.leftH;
  const isRough = input.shape === 'rough' && !renderedFlat;
  const fillColor = isRough ? darken(color, ROUGH_SHAPE_DARKEN) : color;
  // Same rough cue, as a multiplier — carried into the textured-grass tint
  // (which starts from white) so textured rough tiles match the flat path.
  const roughFactor = isRough ? ROUGH_SHAPE_DARKEN : 1;

  // Per-triangle "all-3 corners submerged" check: a triangle whose 3 corners
  // are all at or below SEA_LEVEL renders as water, even when the tile's own
  // elevation puts it above sea level. The MIN-of-4 corner rule can drop one
  // or two corners of a coastal land tile to sea level; this prevents the
  // resulting triangles from appearing as land "cliffs" diving into water.
  // `cornersRenderAsWater` gates on `type === 'grass'` (palette contract),
  // so non-grass tiles (roads, zones, dirt) keep their own color regardless
  // of how their corners drop.
  const tbWestWater  = cornersRenderAsWater(input.type, [c.bottomH, c.leftH,  c.topH]);
  const tbEastWater  = cornersRenderAsWater(input.type, [c.bottomH, c.rightH, c.topH]);
  const lrNorthWater = cornersRenderAsWater(input.type, [c.leftH,   c.topH,   c.rightH]);
  const lrSouthWater = cornersRenderAsWater(input.type, [c.leftH,   c.bottomH, c.rightH]);
  // All 4 corners submerged ⟹ both triangles are water. Swap the base diamond
  // fill to WATER_COLOR so the sub-pixel seam between the two overlaid water
  // triangles doesn't leak the land color.
  const allCornersSubmerged = cornersRenderAsWater(input.type, [c.topH, c.rightH, c.bottomH, c.leftH]);
  const baseFillColor = allCornersSubmerged ? WATER_COLOR : fillColor;

  // Geometry from tileCornerHeights via projectTileCornerScreen. In-bounds
  // adjacencies are continuous — no wall renderer. Per-triangle shading
  // provides depth cue for cardinal/diagonal slopes.
  const tile = { x: input.x, y: input.y };
  const top    = projectTileCornerScreen(tile, 'top',    c.topH);
  const right  = projectTileCornerScreen(tile, 'right',  c.rightH);
  const bottom = projectTileCornerScreen(tile, 'bottom', c.bottomH);
  const left   = projectTileCornerScreen(tile, 'left',   c.leftH);

  // Terrain textures (null until loaded / headless / load-failure). `grassFill`
  // is non-null only for grass tiles; `waterFill` applies to any submerged
  // triangle (coastal grass tiles drop corners to sea level) so it is not
  // type-gated — the per-triangle `isWater` flag gates it. Corner UVs come from
  // the shared integer grid-vertex coords (top=(x,y), right=(x+1,y),
  // bottom=(x+1,y+1), left=(x,y+1)) so both textures are seamless across tiles.
  const grassFill: Texture | null = input.type === 'grass' ? getGrassTexture() : null;
  const waterFill: Texture | null = getWaterTexture();
  const uvTop    = terrainCornerUv(input.x,     input.y);
  const uvRight  = terrainCornerUv(input.x + 1, input.y);
  const uvBottom = terrainCornerUv(input.x + 1, input.y + 1);
  const uvLeft   = terrainCornerUv(input.x,     input.y + 1);

  // Filled deformed top
  gfx.beginPath();
  gfx.moveTo(top.x, top.y);
  gfx.lineTo(right.x, right.y);
  gfx.lineTo(bottom.x, bottom.y);
  gfx.lineTo(left.x, left.y);
  gfx.closePath();
  gfx.fill({ color: baseFillColor });

  // Per-triangle brightness + fold-line stroke from the shading plan helper.
  // See diamondShading.ts for the diagonal/brightness/stroke rules.
  // Triangles draw OVER the base fill at alpha 1.0 to fully cover it where the
  // brightness factor differs from 1.0 (the base fill stays visible only as the
  // seam-safety bleed; for brightness === 1.0 the overdraw is bit-identical).
  const plan = planDiamondShading(c);
  if (plan.diagonal === 'tb') {
    shadeTri(gfx, bottom, left,  top, uvBottom, uvLeft,  uvTop, plan.brightnessWest, tbWestWater, fillColor, grassFill, waterFill, roughFactor);
    shadeTri(gfx, bottom, right, top, uvBottom, uvRight, uvTop, plan.brightnessEast, tbEastWater, fillColor, grassFill, waterFill, roughFactor);
    if (plan.strokeFold) {
      gfx.beginPath();
      gfx.moveTo(top.x, top.y);
      gfx.lineTo(bottom.x, bottom.y);
      gfx.stroke({ color: 0x000000, width: 1, alpha: 0.18 });
    }
  } else {
    shadeTri(gfx, left, top,    right, uvLeft, uvTop,    uvRight, plan.brightnessNorth, lrNorthWater, fillColor, grassFill, waterFill, roughFactor);
    shadeTri(gfx, left, bottom, right, uvLeft, uvBottom, uvRight, plan.brightnessSouth, lrSouthWater, fillColor, grassFill, waterFill, roughFactor);
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
