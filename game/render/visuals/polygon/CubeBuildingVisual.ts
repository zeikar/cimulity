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
import { tileToScreen, tileToScreenWithHeight } from '@/game/render/IsoTransform';
import type { Point } from './cubeGeometry';
import {
  normalizeFootprint,
  cubeFacePolygons,
  isNwAnchoredFullRectFootprint,
  roofCapPolygons,
  setbackTopPolygon,
} from './cubeGeometry';
import { shouldShowRoofAccent, roofAccentFaces } from './cubeRoofAccent';
import { cubeShadowPolygon, SHADOW_COLOR, SHADOW_ALPHA } from './cubeDropShadow';
import { computeZIndex } from './cubeBuildingZIndex';
import {
  shellVariationFor,
  shellVariationToken,
  volumeSplitGeometry,
} from './shellVariation';
import type { ShellVariation } from './shellVariation';
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

function variationFor(input: BuildingVisualInput): {
  v: ShellVariation;
  w: number;
  h: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of input.footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return {
    v: shellVariationFor(
      { id: input.buildingId, level: input.level },
      { w, h },
    ),
    w,
    h,
  };
}

function cacheKey(input: BuildingVisualInput): string {
  const shape = normalizeFootprint(input.footprint, input.anchor);
  const base = `${input.type}:${input.level}:${input.density}:${shape}`;
  if (!isNwAnchoredFullRectFootprint(input.footprint, input.anchor)) {
    return base; // irregular footprint: legacy path, no variation token
  }
  const { v } = variationFor(input);
  return `${base}:${shellVariationToken(v)}`;
}

// All shadows must draw before any face — large negative offset puts every shadow zIndex
// below any computeZIndex(footprint) value while preserving relative depth among shadows.
export const SHADOW_Z_OFFSET = -1_000_000;

// ---------------------------------------------------------------------------
// Context builders
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
  allowRoofAccent: boolean,
): void {
  drawPoly(ctx, faces.left, leftColor(input), 0.5, ox, oy);
  drawPoly(ctx, faces.right, rightColor(input), 0.5, ox, oy);
  drawPoly(ctx, faces.top, topColor(input), 0.55, ox, oy);

  if (allowRoofAccent && shouldShowRoofAccent(input.level)) {
    const mainLift = faces.left[2].y - faces.left[1].y;
    const accent = roofAccentFaces(faces.top, mainLift, input.type);
    if (accent !== null) {
      drawPoly(ctx, accent.left, lerpToWhite(leftColor(input), ROOF_ACCENT_BRIGHTEN), 0.5, ox, oy);
      drawPoly(ctx, accent.right, lerpToWhite(rightColor(input), ROOF_ACCENT_BRIGHTEN), 0.5, ox, oy);
      drawPoly(ctx, accent.top, lerpToWhite(topColor(input), ROOF_ACCENT_BRIGHTEN), 0.55, ox, oy);
    }
  }
}

// Sub-cube descriptor used by both face + shadow split sub-paths.
type SubCube = {
  footprint: { x: number; y: number }[];
  anchor: { x: number; y: number };
  isTall: boolean;
};

// Derive the two sub-cube descriptors (footprint + sub-anchor + isTall) for a
// canonical NW-anchored rectangle whose splitKind is 'x' or 'y'. Sorted back-
// to-front by (anchor.x + anchor.y, then anchor.y).
function buildSplitSubCubes(
  input: BuildingVisualInput,
  v: ShellVariation,
  w: number,
  h: number,
): SubCube[] {
  // Invariant: v.splitKind !== 'none' inside this branch, so
  // volumeSplitGeometry returns non-null per its contract.
  const split = volumeSplitGeometry(v.splitKind, { w, h })!;
  const ax = input.anchor.x;
  const ay = input.anchor.y;

  const subs: SubCube[] = [];

  if (v.splitKind === 'x') {
    const loCells: { x: number; y: number }[] = [];
    for (let y = ay; y < ay + h; y++) {
      for (let x = ax; x < ax + split.offset; x++) {
        loCells.push({ x, y });
      }
    }
    const hiCells: { x: number; y: number }[] = [];
    for (let y = ay; y < ay + h; y++) {
      for (let x = ax + split.offset; x < ax + w; x++) {
        hiCells.push({ x, y });
      }
    }
    subs.push({ footprint: loCells, anchor: { x: ax, y: ay }, isTall: split.tallSide === 'lo' });
    subs.push({ footprint: hiCells, anchor: { x: ax + split.offset, y: ay }, isTall: split.tallSide !== 'lo' });
  } else {
    // 'y'
    const loCells: { x: number; y: number }[] = [];
    for (let y = ay; y < ay + split.offset; y++) {
      for (let x = ax; x < ax + w; x++) {
        loCells.push({ x, y });
      }
    }
    const hiCells: { x: number; y: number }[] = [];
    for (let y = ay + split.offset; y < ay + h; y++) {
      for (let x = ax; x < ax + w; x++) {
        hiCells.push({ x, y });
      }
    }
    subs.push({ footprint: loCells, anchor: { x: ax, y: ay }, isTall: split.tallSide === 'lo' });
    subs.push({ footprint: hiCells, anchor: { x: ax, y: ay + split.offset }, isTall: split.tallSide !== 'lo' });
  }

  subs.sort((a, b) => {
    const sa = a.anchor.x + a.anchor.y;
    const sb = b.anchor.x + b.anchor.y;
    if (sa !== sb) return sa - sb;
    return a.anchor.y - b.anchor.y;
  });
  return subs;
}

function subFootprintWH(sub: SubCube): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of sub.footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

function buildShadowContext(input: BuildingVisualInput): GraphicsContext | null {
  if (input.level <= 0) return null;

  const ctx = new GraphicsContext();

  if (isNwAnchoredFullRectFootprint(input.footprint, input.anchor)) {
    const { v, w, h } = variationFor(input);
    const liftScale = 1 + v.liftJitterPct / 100;

    if (v.splitKind === 'none') {
      const faces = cubeFacePolygons(
        input.type, input.level, input.density,
        input.footprint, input.anchor, liftScale,
      );
      if (faces === null) return null;
      drawCubeShadow(ctx, faces, 0, 0);
      return ctx;
    }

    // Split: two shadow polygons, one per sub-cube, in back-to-front order.
    const subs = buildSplitSubCubes(input, v, w, h);
    const anchorScreen = tileToScreen(input.anchor);
    let drew = false;
    for (const sub of subs) {
      const subScale = sub.isTall ? liftScale : liftScale * 0.65;
      const subFaces = cubeFacePolygons(
        input.type, input.level, input.density,
        sub.footprint, sub.anchor, subScale,
      );
      if (subFaces === null) continue;
      const subScreen = tileToScreen(sub.anchor);
      drawCubeShadow(ctx, subFaces, subScreen.x - anchorScreen.x, subScreen.y - anchorScreen.y);
      drew = true;
    }
    return drew ? ctx : null;
  }

  // Irregular footprint: one shadow polygon per cell, back-to-front.
  const anchorScreen = tileToScreen(input.anchor);
  const sorted = [...input.footprint].sort((a, b) => {
    const da = a.x + a.y;
    const db = b.x + b.y;
    return da !== db ? da - db : a.y - b.y;
  });

  let drew = false;
  for (const cell of sorted) {
    const faces = cubeFacePolygons(input.type, input.level, input.density, [cell], cell);
    if (faces === null) continue;
    const cellScreen = tileToScreen(cell);
    drawCubeShadow(ctx, faces, cellScreen.x - anchorScreen.x, cellScreen.y - anchorScreen.y);
    drew = true;
  }
  return drew ? ctx : null;
}

function buildFacesContext(input: BuildingVisualInput): GraphicsContext | null {
  if (input.level <= 0) return null;

  const ctx = new GraphicsContext();

  if (isNwAnchoredFullRectFootprint(input.footprint, input.anchor)) {
    const { v, w, h } = variationFor(input);
    const liftScale = 1 + v.liftJitterPct / 100;

    if (v.splitKind === 'none') {
      // No-split sub-path: single cube + setback + roof cap
      const faces = cubeFacePolygons(
        input.type, input.level, input.density,
        input.footprint, input.anchor, liftScale,
      );
      if (faces === null) return null;

      const allowRoofAccent = (v.roof === 'flat' && v.setbackSteps === 0);
      drawCubeFaces(ctx, faces, input, 0, 0, allowRoofAccent);

      const mainLift = faces.left[2].y - faces.left[1].y;
      let currentTop = faces.top;

      if (v.setbackSteps > 0) {
        const sb = setbackTopPolygon(currentTop, v.setbackSteps, mainLift);
        if (sb !== null) {
          for (const f of sb.faces) {
            const color = f.shading === 'top' ? topColor(input)
                        : f.shading === 'left' ? leftColor(input)
                        : rightColor(input);
            drawPoly(ctx, f.poly, color, 0.5, 0, 0);
          }
          currentTop = sb.top;
        }
      }

      // ridgeAxis derived from footprint shape.
      const ridgeAxis: 'ns' | 'ew' = (w >= h) ? 'ns' : 'ew';
      const cap = roofCapPolygons(currentTop, v.roof, ridgeAxis, mainLift);
      if (cap !== null) {
        for (const f of cap.faces) {
          const color = f.shading === 'top' ? topColor(input)
                      : f.shading === 'left' ? leftColor(input)
                      : rightColor(input);
          drawPoly(ctx, f.poly, color, 0.5, 0, 0);
        }
      }
      return ctx;
    }

    // Split sub-path: TWO sub-cubes drawn back-to-front.
    const subs = buildSplitSubCubes(input, v, w, h);
    const anchorScreen = tileToScreen(input.anchor);
    let drew = false;

    for (const sub of subs) {
      const subScale = sub.isTall ? liftScale : liftScale * 0.65;
      const subFaces = cubeFacePolygons(
        input.type, input.level, input.density,
        sub.footprint, sub.anchor, subScale,
      );
      if (subFaces === null) continue;
      const subScreen = tileToScreen(sub.anchor);
      const ox = subScreen.x - anchorScreen.x;
      const oy = subScreen.y - anchorScreen.y;
      drawCubeFaces(ctx, subFaces, input, ox, oy, false);
      drew = true;

      if (!sub.isTall) continue;

      // Tall sub-cube: apply setback (low-to-high) then roof cap.
      const subMainLift = subFaces.left[2].y - subFaces.left[1].y;
      let subCurrentTop = subFaces.top;

      if (v.setbackSteps > 0) {
        const sb = setbackTopPolygon(subCurrentTop, v.setbackSteps, subMainLift);
        if (sb !== null) {
          for (const f of sb.faces) {
            const color = f.shading === 'top' ? topColor(input)
                        : f.shading === 'left' ? leftColor(input)
                        : rightColor(input);
            drawPoly(ctx, f.poly, color, 0.5, ox, oy);
          }
          subCurrentTop = sb.top;
        }
      }

      const { w: subW, h: subH } = subFootprintWH(sub);
      const subRidgeAxis: 'ns' | 'ew' = (subW >= subH) ? 'ns' : 'ew';
      const cap = roofCapPolygons(subCurrentTop, v.roof, subRidgeAxis, subMainLift);
      if (cap !== null) {
        for (const f of cap.faces) {
          const color = f.shading === 'top' ? topColor(input)
                      : f.shading === 'left' ? leftColor(input)
                      : rightColor(input);
          drawPoly(ctx, f.poly, color, 0.5, ox, oy);
        }
      }
    }
    return drew ? ctx : null;
  }

  // Irregular footprint: one cube per cell, back-to-front.
  const anchorScreen = tileToScreen(input.anchor);
  const sorted = [...input.footprint].sort((a, b) => {
    const da = a.x + a.y;
    const db = b.x + b.y;
    return da !== db ? da - db : a.y - b.y;
  });

  let drew = false;
  for (const cell of sorted) {
    const faces = cubeFacePolygons(input.type, input.level, input.density, [cell], cell);
    if (faces === null) continue;
    const cellScreen = tileToScreen(cell);
    drawCubeFaces(ctx, faces, input, cellScreen.x - anchorScreen.x, cellScreen.y - anchorScreen.y, true);
    drew = true;
  }
  return drew ? ctx : null;
}

// ---------------------------------------------------------------------------
// CubeBuildingVisual
// ---------------------------------------------------------------------------

export class CubeBuildingVisual implements BuildingVisual {
  readonly layer = 'building' as const;

  /** Separate caches — shadow and faces share the same key but are distinct GraphicsContexts. */
  private shadowCache: Map<string, GraphicsContext> = new Map();
  private facesCache: Map<string, GraphicsContext> = new Map();

  /** Singleton empty context for level-0 / downgrade — avoids leaking a fresh
   *  GraphicsContext on every level→0 transition. NOT entered into caches so
   *  dispose() doesn't double-free it; the static instance is intentional and
   *  lives until module unload. */
  private static readonly emptyContext: GraphicsContext = new GraphicsContext();

  /** Maps the tracked facesGfx → its sibling shadowGfx so update/unmount can reach both. */
  private shadowByFaces: WeakMap<Graphics, Graphics> = new WeakMap();

  private getOrBuildShadowContext(input: BuildingVisualInput): GraphicsContext | null {
    if (input.level === 0) return null;
    const key = cacheKey(input);
    let ctx = this.shadowCache.get(key);
    if (!ctx) {
      ctx = buildShadowContext(input) ?? undefined;
      if (ctx) this.shadowCache.set(key, ctx);
    }
    return ctx ?? null;
  }

  private getOrBuildFacesContext(input: BuildingVisualInput): GraphicsContext | null {
    if (input.level === 0) return null;
    const key = cacheKey(input);
    let ctx = this.facesCache.get(key);
    if (!ctx) {
      ctx = buildFacesContext(input) ?? undefined;
      if (ctx) this.facesCache.set(key, ctx);
    }
    return ctx ?? null;
  }

  mount(input: BuildingVisualInput, parent: Container): Container {
    const facesGfx = new Graphics();
    const facesCtx = this.getOrBuildFacesContext(input);
    if (facesCtx) facesGfx.context = facesCtx;

    // renderHeight is NOT part of the cache key — GraphicsContext is anchor-local geometry.
    // Position shift from terrain elevation is applied here via tileToScreenWithHeight.
    const h = input.renderHeight ?? 0;
    const screen = tileToScreenWithHeight(input.anchor, h);
    const zIndex = computeZIndex(input.footprint);
    facesGfx.position.set(screen.x, screen.y);
    facesGfx.zIndex = zIndex;
    parent.addChild(facesGfx);

    const shadowCtx = this.getOrBuildShadowContext(input);
    if (shadowCtx) {
      const shadowGfx = new Graphics();
      shadowGfx.context = shadowCtx;
      shadowGfx.position.set(screen.x, screen.y);
      // SHADOW_Z_OFFSET ensures every shadow draws before every face in the sorted building layer.
      shadowGfx.zIndex = SHADOW_Z_OFFSET + zIndex;
      parent.addChild(shadowGfx);
      this.shadowByFaces.set(facesGfx, shadowGfx);
    }

    return facesGfx;
  }

  update(input: BuildingVisualInput, displayObject: Container): void {
    const facesGfx = displayObject as Graphics;
    const newFacesCtx = this.getOrBuildFacesContext(input);

    // Swap context if shape/level/density changed, or clear on level→0.
    facesGfx.context = newFacesCtx ?? CubeBuildingVisual.emptyContext;

    // renderHeight is NOT part of the cache key — GraphicsContext is anchor-local geometry.
    // Position shift from terrain elevation is applied here via tileToScreenWithHeight.
    const h = input.renderHeight ?? 0;
    const screen = tileToScreenWithHeight(input.anchor, h);
    const zIndex = computeZIndex(input.footprint);
    facesGfx.position.set(screen.x, screen.y);
    facesGfx.zIndex = zIndex;

    const newShadowCtx = this.getOrBuildShadowContext(input);
    const existingShadowGfx = this.shadowByFaces.get(facesGfx);

    if (existingShadowGfx) {
      existingShadowGfx.context = newShadowCtx ?? CubeBuildingVisual.emptyContext;
      existingShadowGfx.position.set(screen.x, screen.y);
      existingShadowGfx.zIndex = SHADOW_Z_OFFSET + zIndex;
    } else if (newShadowCtx) {
      // Level rose from 0: create the shadow sibling now.
      const shadowGfx = new Graphics();
      shadowGfx.context = newShadowCtx;
      shadowGfx.position.set(screen.x, screen.y);
      shadowGfx.zIndex = SHADOW_Z_OFFSET + zIndex;
      // update() is only called while the object is mounted, so parent is non-null
      facesGfx.parent!.addChild(shadowGfx);
      this.shadowByFaces.set(facesGfx, shadowGfx);
    }
  }

  unmount(displayObject: Container): void {
    const facesGfx = displayObject as Graphics;
    const shadowGfx = this.shadowByFaces.get(facesGfx);
    if (shadowGfx) {
      shadowGfx.destroy();
      this.shadowByFaces.delete(facesGfx);
    }
    facesGfx.destroy();
  }

  dispose(): void {
    for (const ctx of this.shadowCache.values()) ctx.destroy();
    this.shadowCache.clear();
    for (const ctx of this.facesCache.values()) ctx.destroy();
    this.facesCache.clear();
  }
}
