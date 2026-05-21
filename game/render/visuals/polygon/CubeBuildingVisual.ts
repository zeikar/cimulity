/**
 * BuildingVisual that draws an isometric cube for level > 0.
 *
 * For level === 0 the building has no visual of its own — the terrain
 * DiamondTileVisual already renders the flat zone diamond.  We always
 * return a Graphics (never a Container) so that `update` can swap the
 * internal GraphicsContext without type ambiguity.
 *
 * Geometry is computed in anchor-local screen coordinates (relative to
 * tileToScreen(anchor)) so cached GraphicsContexts are reusable for any
 * building of the same shape at any map position.
 */

import { Graphics, GraphicsContext } from 'pixi.js';
import type { Container } from 'pixi.js';
import { tileToScreen } from '@/game/render/IsoTransform';
import type { Point } from './cubeGeometry';
import { normalizeFootprint, cubeFacePolygons, isBoundingDiamondAccurate } from './cubeGeometry';
import { shouldShowRoofAccent, roofAccentFaces } from './cubeRoofAccent';
import { cubeShadowPolygon, SHADOW_COLOR, SHADOW_ALPHA } from './cubeDropShadow';
import type { BuildingVisual, BuildingVisualInput } from '../TileVisual';

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

// Base palette color for the building type — independent of the underlying
// terrain zone color (which lerps toward white with level). Cubes need
// separation from the ground; the building palette below is intentionally
// distinct so the cube doesn't visually merge into the lighter zone tile.
function baseColor(type: BuildingVisualInput['type']): number {
  switch (type) {
    case 'residential': return 0xc2e8a0;   // soft pastel green
    case 'commercial':  return 0xa8c6f0;   // soft sky blue
    case 'industrial':  return 0xf0c890;   // warm sand
  }
}

const ROOF_ACCENT_BRIGHTEN = 0.12;

// Multiply an RGB color channel-wise by `k`, clamped to [0, 255].
function shadeColor(rgb: number, k: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((rgb >> 16) & 0xff) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((rgb >> 8) & 0xff) * k)));
  const b = Math.max(0, Math.min(255, Math.round((rgb & 0xff) * k)));
  return (r << 16) | (g << 8) | b;
}

function lerpToWhite(rgb: number, t: number): number {
  const r = ((rgb >> 16) & 0xff) + Math.round((255 - ((rgb >> 16) & 0xff)) * t);
  const g = ((rgb >> 8)  & 0xff) + Math.round((255 - ((rgb >> 8)  & 0xff)) * t);
  const b = (rgb & 0xff)         + Math.round((255 - (rgb & 0xff))         * t);
  return (r << 16) | (g << 8) | b;
}

// Density tier saturates the base color slightly (cubes at higher density
// look richer); levels 0..ZONE_MAX_LEVEL leave the base unchanged for now.
function densityShade(density: 0 | 1 | 2): number {
  // 0 → 1.00 (base), 1 → 0.92 (slightly richer / less pastel), 2 → 0.82.
  return density === 0 ? 1.0 : density === 1 ? 0.92 : 0.82;
}

function topColor(input: BuildingVisualInput): number {
  // Top face: building palette × density tint. Brighter / more saturated than
  // either side face so the cube reads as 3D against the ground.
  return shadeColor(baseColor(input.type), densityShade(input.density));
}

function leftColor(input: BuildingVisualInput): number {
  // Left face — strongest shadow side (~55% brightness).
  return shadeColor(baseColor(input.type), 0.55 * densityShade(input.density));
}

function rightColor(input: BuildingVisualInput): number {
  // Right face — softer shadow (~75% brightness).
  return shadeColor(baseColor(input.type), 0.75 * densityShade(input.density));
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

function cacheKey(input: BuildingVisualInput): string {
  const shape = normalizeFootprint(input.footprint, input.anchor);
  return `${input.type}:${input.level}:${input.density}:${shape}`;
}

// ---------------------------------------------------------------------------
// Z-index formula (handles arbitrary / L-shaped footprints)
//   depth      = max over footprint cells of (cell.x + cell.y)
//   tiebreakY  = max y among cells that achieve that max depth
//   zIndex     = depth * 1000 + tiebreakY
// ---------------------------------------------------------------------------

function computeZIndex(footprint: ReadonlyArray<{ x: number; y: number }>): number {
  let maxDepth = -Infinity;
  for (const c of footprint) {
    const d = c.x + c.y;
    if (d > maxDepth) maxDepth = d;
  }
  let tiebreakY = -Infinity;
  for (const c of footprint) {
    if (c.x + c.y === maxDepth && c.y > tiebreakY) tiebreakY = c.y;
  }
  return maxDepth * 1000 + tiebreakY;
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

function drawPoly(
  ctx: GraphicsContext,
  points: ReadonlyArray<Point>,
  fillColor: number,
  strokeAlpha: number,
  ox: number,
  oy: number,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x + ox, points[0].y + oy);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x + ox, points[i].y + oy);
  }
  ctx.closePath();
  ctx.fill({ color: fillColor });
  ctx.stroke({ color: 0x000000, width: 1, alpha: strokeAlpha });
}

// Shadows must not have outlines — drawPoly always strokes, so we need a separate path.
function drawShadow(ctx: GraphicsContext, polygon: ReadonlyArray<Point>, ox: number, oy: number): void {
  ctx.beginPath();
  ctx.moveTo(polygon[0].x + ox, polygon[0].y + oy);
  for (let i = 1; i < polygon.length; i++) {
    ctx.lineTo(polygon[i].x + ox, polygon[i].y + oy);
  }
  ctx.closePath();
  ctx.fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
}

function drawCubeShadow(
  ctx: GraphicsContext,
  faces: NonNullable<ReturnType<typeof cubeFacePolygons>>,
  ox: number,
  oy: number,
): void {
  drawShadow(ctx, cubeShadowPolygon(faces), ox, oy);
}

function drawCubeFaces(
  ctx: GraphicsContext,
  faces: NonNullable<ReturnType<typeof cubeFacePolygons>>,
  input: BuildingVisualInput,
  ox: number,
  oy: number,
): void {
  drawPoly(ctx, faces.left, leftColor(input), 0.5, ox, oy);
  drawPoly(ctx, faces.right, rightColor(input), 0.5, ox, oy);
  drawPoly(ctx, faces.top, topColor(input), 0.55, ox, oy);

  if (shouldShowRoofAccent(input.level)) {
    const mainLift = faces.left[2].y - faces.left[1].y;
    const accent = roofAccentFaces(faces.top, mainLift, input.type);
    if (accent !== null) {
      drawPoly(ctx, accent.left, lerpToWhite(leftColor(input), ROOF_ACCENT_BRIGHTEN), 0.5, ox, oy);
      drawPoly(ctx, accent.right, lerpToWhite(rightColor(input), ROOF_ACCENT_BRIGHTEN), 0.5, ox, oy);
      drawPoly(ctx, accent.top, lerpToWhite(topColor(input), ROOF_ACCENT_BRIGHTEN), 0.55, ox, oy);
    }
  }
}

function buildContext(input: BuildingVisualInput): GraphicsContext | null {
  if (input.level <= 0) return null;

  const ctx = new GraphicsContext();

  if (isBoundingDiamondAccurate(input.footprint)) {
    const faces = cubeFacePolygons(input.type, input.level, input.density, input.footprint, input.anchor);
    if (faces === null) return null;
    // shadow geometry is a deterministic function of faces (level/density/type/footprint) — existing cache key covers it
    drawCubeShadow(ctx, faces, 0, 0);
    drawCubeFaces(ctx, faces, input, 0, 0);
    return ctx;
  }

  // Irregular footprint (L-shape, T, etc.): render one small cube per cell
  // so the silhouette follows the actual footprint, not its bounding rect.
  // Back-most cells (smaller x+y) draw first so iso depth reads correctly.
  const anchorScreen = tileToScreen(input.anchor);
  const sorted = [...input.footprint].sort((a, b) => {
    const da = a.x + a.y;
    const db = b.x + b.y;
    return da !== db ? da - db : a.y - b.y;
  });

  // Shadow pass first — back-cell shadows must not paint over front-cell faces in this context.
  for (const cell of sorted) {
    const faces = cubeFacePolygons(input.type, input.level, input.density, [cell], cell);
    if (faces === null) continue;
    const cellScreen = tileToScreen(cell);
    const ox = cellScreen.x - anchorScreen.x;
    const oy = cellScreen.y - anchorScreen.y;
    drawCubeShadow(ctx, faces, ox, oy);
  }

  // Faces pass — drew tracks whether anything visible was committed.
  let drew = false;
  for (const cell of sorted) {
    const faces = cubeFacePolygons(input.type, input.level, input.density, [cell], cell);
    if (faces === null) continue;
    const cellScreen = tileToScreen(cell);
    const ox = cellScreen.x - anchorScreen.x;
    const oy = cellScreen.y - anchorScreen.y;
    drawCubeFaces(ctx, faces, input, ox, oy);
    drew = true;
  }
  return drew ? ctx : null;
}

// ---------------------------------------------------------------------------
// CubeBuildingVisual
// ---------------------------------------------------------------------------

export class CubeBuildingVisual implements BuildingVisual {
  readonly layer = 'building' as const;

  /** Cache keyed by `${type}:${level}:${density}:${normalizedFootprint}`. */
  private cache: Map<string, GraphicsContext> = new Map();

  /** Singleton empty context for level-0 / downgrade — avoids leaking a fresh
   *  GraphicsContext on every level→0 transition. NOT entered into `cache` so
   *  dispose() doesn't double-free it; the static instance is intentional and
   *  lives until module unload. */
  private static readonly emptyContext: GraphicsContext = new GraphicsContext();

  private getOrBuildContext(input: BuildingVisualInput): GraphicsContext | null {
    if (input.level === 0) return null;
    const key = cacheKey(input);
    let ctx = this.cache.get(key);
    if (!ctx) {
      ctx = buildContext(input) ?? undefined;
      if (ctx) this.cache.set(key, ctx);
    }
    return ctx ?? null;
  }

  mount(input: BuildingVisualInput, parent: Container): Container {
    const gfx = new Graphics();

    const ctx = this.getOrBuildContext(input);
    if (ctx) {
      gfx.context = ctx;
    }
    // Always position at anchor's screen coordinates (anchor-local geometry is relative here).
    const screen = tileToScreen(input.anchor);
    gfx.position.set(screen.x, screen.y);
    gfx.zIndex = computeZIndex(input.footprint);

    parent.addChild(gfx);
    return gfx;
  }

  update(input: BuildingVisualInput, displayObject: Container): void {
    const gfx = displayObject as Graphics;
    const newCtx = this.getOrBuildContext(input);

    // Swap context if the shape/level/density changed, or clear if now level 0.
    // Reuse the shared empty context for level-0 transitions to avoid leaking.
    gfx.context = newCtx ?? CubeBuildingVisual.emptyContext;

    const screen = tileToScreen(input.anchor);
    gfx.position.set(screen.x, screen.y);
    gfx.zIndex = computeZIndex(input.footprint);
  }

  unmount(displayObject: Container): void {
    // Only destroy the instance — cache stays alive (disposed via dispose()).
    displayObject.destroy();
  }

  dispose(): void {
    for (const ctx of this.cache.values()) {
      ctx.destroy();
    }
    this.cache.clear();
  }
}
