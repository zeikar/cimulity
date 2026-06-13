/**
 * TerrainTileVisual that draws the standard 64×32 isometric diamond.
 * Each tile owns its own Graphics object — no shared batch.
 */

import { Graphics, Container } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { projectTileCornerScreen, ISO_CONFIG } from '@/game/render/IsoTransform';
import type { ScreenCoord } from '@/game/types/coordinates';
import { tileFillColor, WATER_COLOR, cornersRenderAsWater, TILE_COLORS } from '../palette';
import { computeTerrainZIndex } from '../../terrain/terrainZIndex';
import { roadAutoTile, type RoadDescriptor } from '../../roadAutoTile';
import { TileType } from '@/game/core/Tile';
import type { TerrainTileVisual, TileVisualInput } from '../TileVisual';
import { southSkirtVertices, eastSkirtVertices } from './DiamondOOBSkirt';
import { planDiamondShading } from './diamondShading';
import { terrainTriFillMatrix, type Uv } from './terrainTriFillMatrix';
import { getGrassTexture, getWaterTexture, getRoadTexture, getParkTexture, getDirtTexture } from './faceTexture';
import { maxRoadHalfWidthForDiamond } from './roadHalfWidth';

// Terrain texture pixels per grid cell (shared by grass + water). UV is fed in
// texture-px; Pixi divides by source size for UVs. Lower => the tile stretches
// across more cells and magnifies more on screen (chunkier dots). At 16, a 96px
// pixel-art tile repeats every 6 cells and each texel is ~4 screen-px (zoom 1).
const TERRAIN_TEXTURE_PX_PER_CELL = 16;

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

// One shaded surface triangle. Land tiles with a terrain texture (grass or park,
// passed as `landTex`) draw it, water triangles draw the water texture (both
// dimmed by the Lambert factor); everything else — untextured land tiles and the
// headless / load-failure fallback (texture === null) — keeps the existing flat
// Lambert-shaded colour fill, byte-identical to before. UVs come from the shared
// tile-vertex grid, so the textures are seamless across tile boundaries.
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
  landTex: Texture | null,
  waterTex: Texture | null,
  roughFactor: number,
  landTintBase: number,
): void {
  if (isWater) {
    if (waterTex) {
      fillTexturedTri(gfx, a, b, c, uvA, uvB, uvC, waterTex, darken(0xffffff, brightness));
    } else {
      fillTri(gfx, a, b, c, darken(WATER_COLOR, brightness), 1.0);
    }
  } else if (landTex) {
    // flatColor already bakes the rough darken; the textured tint starts from
    // landTintBase (white for grass/park/dirt; zone hue for undeveloped zone tiles),
    // so apply roughFactor here to keep the rough cue on the textured land.
    fillTexturedTri(gfx, a, b, c, uvA, uvB, uvC, landTex, darken(landTintBase, brightness * roughFactor));
  } else {
    fillTri(gfx, a, b, c, darken(flatColor, brightness), 1.0);
  }
}

// ---------------------------------------------------------------------------
// Road auto-tile band geometry (PRIVATE to this file — render glue, not part of
// the gated pure roadAutoTile classifier).
//
// A road tile draws its diamond BASE as ordinary grass (see drawDiamond), then
// opaque asphalt BANDS on top per the autotile mask, so each kind looks
// distinct with visible grass shoulders. Band shape = geometry, not texture
// alpha (the asphalt texture is opaque).
//
// All math is in deformed tile-local SCREEN space (post-projection), so bands
// follow ramps. Geometry assumptions (flagged for the lead's visual check):
//   - perp(v) = { x: -v.y, y: v.x } (screen-space 90° CCW rotation).
//   - edgeUnit per arm runs along the shared diamond edge: N top->right,
//     E right->bottom, S bottom->left, W left->top.
//   - A band toward an arm is a quad [innerCap0, outerEdge0, outerEdge1,
//     innerCap1]; the OUTER cap sits FLUSH on the shared edge midpoint so it
//     ends exactly on the boundary and cannot bleed into the neighbour.
// ---------------------------------------------------------------------------

// Target road half-width as a fraction of TILE_HEIGHT for a FLAT tile.
// Band full width = 0.64·tile — makes curb strips in the cross-section texture
// read on screen while leaving visible grass shoulders (0.64 < 1).
// On flat tiles the axis-aligned-square half-side 0.32·32 = 10.24px fits inside
// the 64×32 diamond (maxSquareHalf ≈ 10.67 > 10.24).
// On coplanar RAMPS the deformed diamond is thinner; per-tile clamping via
// maxRoadHalfWidthForDiamond keeps bands/hub inside the actual tile boundary.
const ROAD_HALF_WIDTH = 0.32;

// Intersection-hub size as a fraction of the minimal clean coverage. 1.0 = the
// mini-diamond's inscribed circle exactly equals the arm-cap radius halfW, which
// is precisely the overlap region of two crossing bands (see drawRoadBands). Below
// 1.0 the hub shrinks inside that overlap, so a crossing road's curb can peek a
// sliver into the junction; the trade buys a daintier, less chunky junction patch.
const HUB_COVERAGE = 0.82;

type ArmDir = 'N' | 'E' | 'S' | 'W';

interface RoadDiamond {
  center: ScreenCoord;
  /** The four (possibly deformed) projected diamond corners. */
  corners: { top: ScreenCoord; right: ScreenCoord; bottom: ScreenCoord; left: ScreenCoord };
  /** Shared-edge midpoint per arm direction. */
  mid: Record<ArmDir, ScreenCoord>;
  /** Unit vector along the shared diamond edge per arm direction. */
  edgeUnit: Record<ArmDir, ScreenCoord>;
}

function mid(a: ScreenCoord, b: ScreenCoord): ScreenCoord {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function sub(a: ScreenCoord, b: ScreenCoord): ScreenCoord {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: ScreenCoord, b: ScreenCoord): ScreenCoord {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(v: ScreenCoord, s: number): ScreenCoord {
  return { x: v.x * s, y: v.y * s };
}

function normalize(v: ScreenCoord): ScreenCoord {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

/** Screen-space 90° rotation (CCW). */
function perp(v: ScreenCoord): ScreenCoord {
  return { x: -v.y, y: v.x };
}

/** Perpendicular distance from point C to the line through A and B. */
function perpDist(C: ScreenCoord, a: ScreenCoord, b: ScreenCoord): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = Math.hypot(abx, aby) || 1;
  return Math.abs(abx * (C.y - a.y) - aby * (C.x - a.x)) / len;
}

function buildRoadDiamond(
  top: ScreenCoord,
  right: ScreenCoord,
  bottom: ScreenCoord,
  left: ScreenCoord,
): RoadDiamond {
  return {
    center: {
      x: (top.x + right.x + bottom.x + left.x) / 4,
      y: (top.y + right.y + bottom.y + left.y) / 4,
    },
    corners: { top, right, bottom, left },
    mid: {
      N: mid(top, right),    // shared with (x, y-1)
      E: mid(right, bottom), // shared with (x+1, y)
      S: mid(bottom, left),  // shared with (x, y+1)
      W: mid(left, top),     // shared with (x-1, y)
    },
    edgeUnit: {
      N: normalize(sub(right, top)),
      E: normalize(sub(bottom, right)),
      S: normalize(sub(left, bottom)),
      W: normalize(sub(top, left)),
    },
  };
}

/**
 * Band quad toward `dir`: inner cap near the tile center + outer cap flush on
 * the shared edge midpoint. Wound [Ci0, E0, E1, Ci1].
 */
function bandQuad(d: RoadDiamond, dir: ArmDir, halfW: number): ScreenCoord[] {
  const C = d.center;
  const m = d.mid[dir];
  const dirVec = normalize(sub(m, C));
  const nrm = perp(dirVec);
  const eu = d.edgeUnit[dir];
  const Ci0 = add(C, scale(nrm, halfW));
  const Ci1 = sub(C, scale(nrm, halfW));
  const E0 = add(m, scale(eu, halfW));
  const E1 = sub(m, scale(eu, halfW));
  return [Ci0, E0, E1, Ci1];
}

/**
 * Diagonal (staircase elbow) chamfer band spanning the two adjacent shared
 * edges A and B. EXACT quad = [edgeA0, edgeB0, edgeB1, edgeA1] where edge?0/1 are
 * the same band-width endpoints bandQuad puts on each shared edge. If that
 * winding self-crosses (perimeter figure-eight), swap edgeB0/edgeB1.
 */
function diagonalQuad(d: RoadDiamond, a: ArmDir, b: ArmDir, halfW: number): ScreenCoord[] {
  const mA = d.mid[a];
  const mB = d.mid[b];
  const euA = d.edgeUnit[a];
  const euB = d.edgeUnit[b];
  const a0 = add(mA, scale(euA, halfW));
  const a1 = sub(mA, scale(euA, halfW));
  const b0 = add(mB, scale(euB, halfW));
  const b1 = sub(mB, scale(euB, halfW));
  const quad = [a0, b0, b1, a1];
  return segmentsIntersect(quad[0], quad[1], quad[2], quad[3])
    ? [a0, b1, b0, a1] // swap edgeB0/edgeB1 to undo the self-crossing
    : quad;
}

/** Do open segments p1p2 and p3p4 cross? Used to detect a self-crossing quad. */
function segmentsIntersect(p1: ScreenCoord, p2: ScreenCoord, p3: ScreenCoord, p4: ScreenCoord): boolean {
  const d = (a: ScreenCoord, b: ScreenCoord, c: ScreenCoord) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Centerline along which a band's texture x-axis runs (origin + unit dir). */
interface UvAxis {
  origin: ScreenCoord;
  dir: ScreenCoord; // unit vector
}

/**
 * Fill one band quad (4 screen points) with the road texture (or flat road
 * colour when null), split into two triangles. Each corner's UV is its (u, v) in
 * the band's local frame: u = projection ONTO the centerline `axis.dir` from
 * `axis.origin` (along-road repeat, unchanged); v is remapped so the band's
 * perpendicular half-extent `crossHalf` spans the FULL texture height centred —
 * vRaw=0 (band centre) maps to texH/2 (the dashed centre line in the texture)
 * and ±crossHalf maps to the texture edges. Without this remap, a 16px-wide band
 * sampled the same 16px slice from the 48px texture, missing the centre line
 * entirely. `tint` is white × Lambert brightness (mirrors grass).
 */
function fillBandQuad(
  gfx: Graphics,
  quad: ScreenCoord[],
  axis: UvAxis,
  crossHalf: number,
  roadTex: Texture | null,
  tint: number,
): void {
  const [p0, p1, p2, p3] = quad;
  if (roadTex) {
    const nrm = perp(axis.dir); // band-width axis (unit)
    const texH = roadTex.source.height || 1;
    const uvOf = (p: ScreenCoord): Uv => {
      const rx = p.x - axis.origin.x;
      const ry = p.y - axis.origin.y;
      const vRaw = rx * nrm.x + ry * nrm.y;
      return {
        u: rx * axis.dir.x + ry * axis.dir.y,
        v: (vRaw / crossHalf) * (texH / 2) + texH / 2,
      };
    };
    const u0 = uvOf(p0), u1 = uvOf(p1), u2 = uvOf(p2), u3 = uvOf(p3);
    fillTexturedTri(gfx, p0, p1, p2, u0, u1, u2, roadTex, tint);
    fillTexturedTri(gfx, p0, p2, p3, u0, u2, u3, roadTex, tint);
  } else {
    fillTri(gfx, p0, p1, p2, TILE_COLORS.road, 1.0);
    fillTri(gfx, p0, p2, p3, TILE_COLORS.road, 1.0);
  }
}

/** Centerline axis for a straight arm band: from the tile centre toward m{dir}. */
function bandAxis(d: RoadDiamond, dir: ArmDir): UvAxis {
  return { origin: d.center, dir: normalize(sub(d.mid[dir], d.center)) };
}

/**
 * Draw all asphalt bands for a road tile over the already-drawn grass base.
 * Reads the mask via roadAutoTile (the gated pure classifier) and emits band
 * geometry per kind. `brightness` is the flat-tile Lambert factor (1.0 for a
 * flat road) so the asphalt dims with slope like the grass under it.
 */
function drawRoadBands(
  gfx: Graphics,
  d: RoadDiamond,
  desc: RoadDescriptor,
  halfW: number,
  roadTex: Texture | null,
  brightness: number,
): void {
  const tint = darken(0xffffff, brightness);

  if (desc.kind === 'diagonal') {
    // Two adjacent arms forming a staircase elbow → single chamfer band, no hub.
    // Texture x-axis follows the centerline between the two edge midpoints.
    const [a, b] = desc.arms as ArmDir[];
    const axis: UvAxis = { origin: d.mid[a], dir: normalize(sub(d.mid[b], d.mid[a])) };
    const dQuad = diagonalQuad(d, a, b, halfW);
    // Measure the chamfer's actual perpendicular half-extent against the diagonal
    // axis normal so the cross-section maps across the chamfer's true width,
    // which is narrower than halfW (corners sit on diamond-edge units, not the
    // road-width axis).
    const dNrm = perp(axis.dir);
    const diagCrossHalf = Math.max(...dQuad.map(
      p => Math.abs((p.x - axis.origin.x) * dNrm.x + (p.y - axis.origin.y) * dNrm.y)
    ));
    fillBandQuad(gfx, dQuad, axis, diagCrossHalf, roadTex, tint);
    return;
  }

  // Draw the per-arm cross-section bands FIRST, then (for every non-straight
  // kind) cover the centre with a flat-asphalt SQUARE hub LAST. straight is the
  // only kind whose two opposite bands already form a continuous line through C,
  // so it needs no hub.
  for (const arm of desc.arms) {
    fillBandQuad(gfx, bandQuad(d, arm as ArmDir, halfW), bandAxis(d, arm as ArmDir), halfW, roadTex, tint);
  }

  if (desc.kind !== 'straight') {
    // Clean SimCity-style intersection: a flat-asphalt patch drawn LAST over the
    // arm bands, so each arm's converging concrete-sidewalk strips recede under it
    // and the junction reads as one continuous asphalt surface (the crossing
    // cross-sections would otherwise overlap into a messy plaid). cross/tee/corner
    // get a clean junction; end gets an asphalt CAP over its one band; isolated
    // (zero arms) is a lone asphalt PATCH — the hub IS its whole road shape.
    // Crosswalk markings are a deferred future option.
    //
    // Shape = a scaled-down copy of the TILE diamond (corners toward top/right/
    // bottom/left), NOT a screen-axis square. The roads enter through the tile-edge
    // midpoints, so a tile-aligned mini-diamond meets each arm with a flat edge
    // that's PARALLEL to the road — it reads as a proper junction. A screen-axis
    // square instead pokes its corners out along the screen diagonals, 45° off the
    // road flow, so it looked like a stray rotated diamond dropped on the crossing.
    //
    // SIZE: scale s from the centroid so the mini-diamond's inscribed circle is
    // HUB_COVERAGE × the arm-cap radius halfW (every arm inner cap = C ± nrm·halfW
    // sits at distance halfW from C; inscribed radius = s · rIns where rIns = min
    // centre→edge distance, so s = (halfW / rIns) · HUB_COVERAGE). At HUB_COVERAGE 1
    // the inscribed circle exactly equals the two-band overlap; <1 trades a hair of
    // crossing-curb sliver for a smaller, less chunky junction patch.
    // s ⩽ 1 is GUARANTEED (halfW ⩽ maxRoadHalfWidthForDiamond ⩽ rIns, HUB_COVERAGE
    // ⩽ 1), and a diamond scaled from the centroid by s ⩽ 1 stays inside the tile —
    // so unlike the old square the hub provably cannot bleed past the tile boundary.
    //
    // HUB-TINT matches the arm bands so hub + arms dim together on slopes:
    //   textured  → darken(TILE_COLORS.road, brightness)  (== the arms' white ×
    //               Lambert tint applied over the #4a4a4a asphalt texture)
    //   null tex  → raw TILE_COLORS.road at alpha 1.0      (== flat arm fallback)
    // On flat ground brightness === 1 so darken(...,1) is a no-op.
    const C = d.center;
    const { top, right, bottom, left } = d.corners;
    const rIns = Math.min(
      perpDist(C, top, right),
      perpDist(C, right, bottom),
      perpDist(C, bottom, left),
      perpDist(C, left, top),
    );
    const s = Math.min(0.95, (halfW / rIns) * HUB_COVERAGE);
    const toward = (corner: ScreenCoord) => add(C, scale(sub(corner, C), s));
    const hubColor = roadTex ? darken(TILE_COLORS.road, brightness) : TILE_COLORS.road;
    const ht = toward(top), hr = toward(right), hb = toward(bottom), hl = toward(left);
    fillTri(gfx, ht, hr, hb, hubColor, 1);
    fillTri(gfx, ht, hb, hl, hubColor, 1);
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
  // A road tile's diamond BASE renders as ordinary grass — opaque asphalt bands
  // draw ON TOP (see drawRoadBands). So the base flat-fill colour is the grass
  // colour, never road-gray; the asphalt shape is what makes the road read.
  const isRoad = input.type === TileType.ROAD;
  const baseTypeColor = isRoad ? TILE_COLORS.grass : color;
  const fillColor = isRough ? darken(baseTypeColor, ROUGH_SHAPE_DARKEN) : baseTypeColor;
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
  // Road tiles use the grass texture for their base too (asphalt bands overlay).
  // Park tiles get their own lawn texture. Undeveloped zone tiles get the grass
  // texture tinted by the zone hue (so the zone colour reads while sharing the
  // same geometry). Dirt tiles use their own brown dirt texture (art carries
  // colour; tint = white). `landFill` is the per-tile terrain texture passed to
  // shadeTri (null → flat-colour fallback).
  const zoneTint = input.type === 'zone_residential' ? TILE_COLORS.zone_residential
    : input.type === 'zone_commercial'  ? TILE_COLORS.zone_commercial
    : input.type === 'zone_industrial'  ? TILE_COLORS.zone_industrial
    : null;
  const isZoneTile = zoneTint !== null;
  const grassFill: Texture | null = input.type === 'grass' || isRoad ? getGrassTexture() : null;
  const parkFill: Texture | null = input.type === 'park' ? getParkTexture() : null;
  const dirtFill: Texture | null = input.type === 'dirt' ? getDirtTexture() : null;
  const landFill: Texture | null = grassFill ?? parkFill ?? dirtFill ?? (isZoneTile ? getGrassTexture() : null);
  // White for grass/park/dirt (art carries colour); zone tiles use the
  // level-aware zone fill colour (baseTypeColor) so the tint matches the
  // flat-path at the same zone level — using the raw base zone hue (zoneTint)
  // would ignore level lightening baked into baseTypeColor / tileFillColor().
  const landTintBase: number = isZoneTile ? baseTypeColor : 0xffffff;
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
    shadeTri(gfx, bottom, left,  top, uvBottom, uvLeft,  uvTop, plan.brightnessWest, tbWestWater, fillColor, landFill, waterFill, roughFactor, landTintBase);
    shadeTri(gfx, bottom, right, top, uvBottom, uvRight, uvTop, plan.brightnessEast, tbEastWater, fillColor, landFill, waterFill, roughFactor, landTintBase);
    if (plan.strokeFold) {
      gfx.beginPath();
      gfx.moveTo(top.x, top.y);
      gfx.lineTo(bottom.x, bottom.y);
      gfx.stroke({ color: 0x000000, width: 1, alpha: 0.18 });
    }
  } else {
    shadeTri(gfx, left, top,    right, uvLeft, uvTop,    uvRight, plan.brightnessNorth, lrNorthWater, fillColor, landFill, waterFill, roughFactor, landTintBase);
    shadeTri(gfx, left, bottom, right, uvLeft, uvBottom, uvRight, plan.brightnessSouth, lrSouthWater, fillColor, landFill, waterFill, roughFactor, landTintBase);
    if (plan.strokeFold) {
      gfx.beginPath();
      gfx.moveTo(left.x, left.y);
      gfx.lineTo(right.x, right.y);
      gfx.stroke({ color: 0x000000, width: 1, alpha: 0.18 });
    }
  }

  // Road asphalt bands — drawn ON TOP of the grass base per the autotile mask.
  // INSIDE drawDiamond (not an early-return path) so the OOB skirt below still
  // runs for map-edge road tiles exactly as for any other tile. Uses DEFORMED
  // corners so bands follow ramps. brightness averages the two triangle Lambert
  // factors (== 1.0 on flat tiles) so the asphalt dims with slope like the grass.
  if (isRoad) {
    const desc = roadAutoTile(input.roadNeighbors ?? (() => false));
    const roadDiamond = buildRoadDiamond(top, right, bottom, left);
    // Clamp to the deformed diamond so bands/hub can't bleed outside the tile
    // on coplanar ramps. On flat tiles maxRoadHalfWidthForDiamond ≈ 10.67 so
    // the target 10.24 is used unchanged.
    const halfW = Math.min(
      ROAD_HALF_WIDTH * ISO_CONFIG.TILE_HEIGHT,
      maxRoadHalfWidthForDiamond(roadDiamond.center, top, right, bottom, left),
    );
    const bandBrightness = plan.diagonal === 'tb'
      ? (plan.brightnessWest + plan.brightnessEast) / 2
      : (plan.brightnessNorth + plan.brightnessSouth) / 2;
    drawRoadBands(gfx, roadDiamond, desc, halfW, getRoadTexture(), bandBrightness);
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
  // Drawn for every tile type, road included — the outline sits on top of the
  // asphalt bands and restores the uniform grid appearance.
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
