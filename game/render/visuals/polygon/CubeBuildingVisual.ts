/**
 * BuildingVisual that draws an isometric cube for level > 0.
 *
 * The visual returns a stable wrapper `Container` whose child is either a
 * facade `Sprite` (baked from the pixel-art atlas) when the building shape
 * is representable as a single canonical NW-anchored full rect with the
 * "base" shell variation (no split, no setback, flat roof), or the existing
 * polygon `Graphics` otherwise. The shadow `Graphics` sibling is always
 * added directly to the building parent Container — not to the wrapper —
 * so iso depth sort sees shadow and faces as independent siblings.
 *
 * For level === 0 the building has no visual of its own — the terrain
 * DiamondTileVisual already renders the flat zone diamond.
 *
 * Polygon geometry is computed in anchor-local screen coordinates so cached
 * GraphicsContexts are reusable for any building of the same shape at any
 * map position. Baked facade RenderTextures are cached per-building because
 * they encode tint-free atlas-baked pixels for a specific (level, density,
 * shape, frontage, atlasVersion) tuple — see `bakedEntryKey`.
 */

import { Graphics, GraphicsContext, Sprite, Container } from 'pixi.js';
import type { Renderer } from 'pixi.js';
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
import {
  baseColor,
  shadeColor,
  lerpToWhite,
  densityShade,
  ROOF_ACCENT_BRIGHTEN,
} from './cubePalette';
import type { FacadeAtlas } from '../pixel/facadeAtlas';
import { composeFacade, facadeTintFor } from '../pixel/facadeComposer';
import { bakeBuildingFacade, type BakedBuildingTexture } from '../pixel/bakeBuilding';

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

// ---------------------------------------------------------------------------
// Facade gating + cache key
// ---------------------------------------------------------------------------

/**
 * Returns true iff the shell variation is the "base cube" the facade atlas can
 * represent today: no volume split, no setback, flat roof.
 */
function facadeRepresentable(v: ShellVariation): boolean {
  return v.splitKind === 'none'
      && v.setbackSteps === 0
      && v.roof === 'flat';
}

/**
 * Per-building bake key. Tint is NOT part of the bake (it's applied as a
 * cheap multiply on the Sprite) so it's excluded from the key. Atlas version
 * is included so any future atlas reload invalidates every baked RT.
 */
function bakedEntryKey(input: BuildingVisualInput, atlasVersion: number): string {
  const shape = normalizeFootprint(input.footprint, input.anchor);
  return `${input.level}:${input.density}:${shape}:${input.frontage}:av${atlasVersion}`;
}

/**
 * Gate: should this mount/update use the facade Sprite path? Requires:
 *   - atlas/renderer wired (setFacadeContext called),
 *   - level > 0 (level 0 has no building visual at all),
 *   - canonical NW-anchored full-rect footprint,
 *   - "base cube" shell variation (no split, no setback, flat roof).
 * Everything else falls through to the polygon Graphics path.
 */
function shouldUseFacade(input: BuildingVisualInput, atlas: FacadeAtlas | null): boolean {
  if (atlas === null) return false;
  if (input.level <= 0) return false;
  if (!isNwAnchoredFullRectFootprint(input.footprint, input.anchor)) return false;
  const { v } = variationFor(input);
  return facadeRepresentable(v);
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

  /** Maps the tracked wrapper Container → its sibling shadowGfx so update/unmount can reach both. */
  private shadowByFaces: WeakMap<Container, Graphics> = new WeakMap();

  // Facade atlas wiring (set by PixiApp.init via setFacadeContext).
  private atlas: FacadeAtlas | null = null;
  private renderer: Renderer | null = null;

  // Per-building bake cache. Replaced (with destroy-on-swap) when the key
  // changes — typically when level/density/frontage/shape transitions while
  // staying on the facade path.
  private bakedByBuilding: Map<number, { key: string; baked: BakedBuildingTexture }> = new Map();

  // wrapper Container → building id, so unmount can find the right cache slot.
  private wrapperToBuildingId: WeakMap<Container, number> = new WeakMap();

  // wrapper Container → its current child (Sprite for facade branch, Graphics
  // for polygon branch). Used by update() to decide between cases A/B/C/D and
  // by unmount() to pick the right destroy options.
  private wrapperChild: WeakMap<Container, Graphics | Sprite> = new WeakMap();

  /**
   * Wire the facade renderer + atlas. Called from PixiApp.init after
   * `initFacadeAtlas` resolves. Must be called before any mount/update for
   * the facade path to activate; otherwise `shouldUseFacade` returns false
   * and every building stays on the polygon path.
   */
  setFacadeContext(renderer: Renderer, atlas: FacadeAtlas): void {
    this.renderer = renderer;
    this.atlas = atlas;
  }

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

  /**
   * Bake a facade RT (or return the cached one) for this building.
   *
   * Ordering invariant: BAKE first, then SWAP the map entry, then DESTROY the
   * old RT. If `bakeBuildingFacade` throws, the existing entry remains live in
   * the map AND on the existing Sprite — no orphan, no dangling texture
   * pointer. Caller assigns `sprite.texture = baked.texture` BEFORE control
   * returns to any other code path, so destroying the old RT at the end is
   * safe.
   */
  private getOrBakeFacade(input: BuildingVisualInput): BakedBuildingTexture {
    if (this.atlas === null || this.renderer === null) {
      throw new Error('getOrBakeFacade called without atlas/renderer set');
    }
    const key = bakedEntryKey(input, this.atlas.version);
    const existing = this.bakedByBuilding.get(input.buildingId);
    if (existing && existing.key === key) return existing.baked;

    // 1) BAKE THE REPLACEMENT FIRST.
    const out = composeFacade({
      buildingId: input.buildingId,
      type: input.type,
      level: input.level,
      density: input.density,
      footprint: input.footprint,
      anchor: input.anchor,
      frontage: input.frontage,
    });
    const { v } = variationFor(input);
    const liftScale = 1 + v.liftJitterPct / 100;
    const faces = cubeFacePolygons(
      input.type, input.level, input.density,
      input.footprint, input.anchor, liftScale,
    );
    if (faces === null) {
      throw new Error('getOrBakeFacade: cubeFacePolygons returned null unexpectedly');
    }
    const baked = bakeBuildingFacade({
      renderer: this.renderer,
      atlas: this.atlas,
      placements: out.placements,
      faceSizes: out.faceSizes,
      targets: faces,
    });

    // 2) SWAP MAP ENTRY (caller swaps Sprite.texture immediately after return).
    this.bakedByBuilding.set(input.buildingId, { key, baked });

    // 3) DESTROY OLD RT LAST.
    if (existing) {
      existing.baked.texture.destroy(true);
    }
    return baked;
  }

  mount(input: BuildingVisualInput, parent: Container): Container {
    // renderHeight is NOT part of geometry caches — anchor-local geometry is
    // position-independent. Terrain elevation is applied here on the wrapper.
    const h = input.renderHeight ?? 0;
    const screen = tileToScreenWithHeight(input.anchor, h);
    const zIndex = computeZIndex(input.footprint);

    const wrapper = new Container();
    wrapper.position.set(screen.x, screen.y);
    wrapper.zIndex = zIndex;
    this.wrapperToBuildingId.set(wrapper, input.buildingId);

    if (shouldUseFacade(input, this.atlas)) {
      const baked = this.getOrBakeFacade(input);
      const sprite = new Sprite(baked.texture);
      sprite.x = baked.spriteOffset.x;
      sprite.y = baked.spriteOffset.y;
      sprite.tint = facadeTintFor({ id: input.buildingId, type: input.type });
      wrapper.addChild(sprite);
      this.wrapperChild.set(wrapper, sprite);
    } else {
      const facesGfx = new Graphics();
      const facesCtx = this.getOrBuildFacesContext(input);
      if (facesCtx) facesGfx.context = facesCtx;
      wrapper.addChild(facesGfx);
      this.wrapperChild.set(wrapper, facesGfx);
    }

    parent.addChild(wrapper);

    // Shadow Graphics is a sibling of the wrapper (added to `parent`), not a
    // child of the wrapper. Sort order between shadow and faces uses zIndex.
    const shadowCtx = this.getOrBuildShadowContext(input);
    if (shadowCtx) {
      const shadowGfx = new Graphics();
      shadowGfx.context = shadowCtx;
      shadowGfx.position.set(screen.x, screen.y);
      // SHADOW_Z_OFFSET ensures every shadow draws before every face in the sorted building layer.
      shadowGfx.zIndex = SHADOW_Z_OFFSET + zIndex;
      parent.addChild(shadowGfx);
      this.shadowByFaces.set(wrapper, shadowGfx);
    }

    return wrapper;
  }

  update(input: BuildingVisualInput, displayObject: Container): void {
    const wrapper = displayObject;

    const h = input.renderHeight ?? 0;
    const screen = tileToScreenWithHeight(input.anchor, h);
    const zIndex = computeZIndex(input.footprint);
    wrapper.position.set(screen.x, screen.y);
    wrapper.zIndex = zIndex;

    const useFacade = shouldUseFacade(input, this.atlas);
    const existingChild = this.wrapperChild.get(wrapper);

    if (useFacade && existingChild instanceof Sprite) {
      // Case A — facade → facade: bake/lookup, reassign texture in place.
      const baked = this.getOrBakeFacade(input);
      existingChild.texture = baked.texture;
      existingChild.x = baked.spriteOffset.x;
      existingChild.y = baked.spriteOffset.y;
      existingChild.tint = facadeTintFor({ id: input.buildingId, type: input.type });
    } else if (useFacade && existingChild instanceof Graphics) {
      // Case B — polygon → facade: destroy Graphics (keep its shared context),
      // remove from wrapper, attach fresh Sprite.
      wrapper.removeChild(existingChild);
      existingChild.destroy({ context: false });
      const baked = this.getOrBakeFacade(input);
      const sprite = new Sprite(baked.texture);
      sprite.x = baked.spriteOffset.x;
      sprite.y = baked.spriteOffset.y;
      sprite.tint = facadeTintFor({ id: input.buildingId, type: input.type });
      wrapper.addChild(sprite);
      this.wrapperChild.set(wrapper, sprite);
    } else if (!useFacade && existingChild instanceof Sprite) {
      // Case C — facade → polygon: destroy baked RT for this building, drop
      // the Sprite, attach a Graphics with the polygon context.
      const cached = this.bakedByBuilding.get(input.buildingId);
      if (cached) {
        cached.baked.texture.destroy(true);
        this.bakedByBuilding.delete(input.buildingId);
      }
      wrapper.removeChild(existingChild);
      // Sprite holds a reference to the now-destroyed RT (via cached above).
      // We must NOT destroy the texture again here.
      existingChild.destroy({ texture: false, textureSource: false });

      const facesGfx = new Graphics();
      const facesCtx = this.getOrBuildFacesContext(input);
      facesGfx.context = facesCtx ?? CubeBuildingVisual.emptyContext;
      wrapper.addChild(facesGfx);
      this.wrapperChild.set(wrapper, facesGfx);
    } else if (!useFacade && existingChild instanceof Graphics) {
      // Case D — polygon → polygon: swap context only (existing logic).
      const facesCtx = this.getOrBuildFacesContext(input);
      existingChild.context = facesCtx ?? CubeBuildingVisual.emptyContext;
    }
    // (No "else" — wrapperChild is always set in mount and maintained by the
    // four branches above. A missing child would indicate a logic bug.)

    // Shadow update (unchanged behaviour) — keyed by wrapper now instead of facesGfx.
    const newShadowCtx = this.getOrBuildShadowContext(input);
    const existingShadowGfx = this.shadowByFaces.get(wrapper);

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
      // update() is only called while mounted, so parent is non-null.
      wrapper.parent!.addChild(shadowGfx);
      this.shadowByFaces.set(wrapper, shadowGfx);
    }
  }

  unmount(displayObject: Container): void {
    const wrapper = displayObject;
    const id = this.wrapperToBuildingId.get(wrapper);
    const child = this.wrapperChild.get(wrapper);

    // 1) Destroy the baked RT FIRST. Sprite still points at it; we'll destroy
    //    the Sprite next WITHOUT a second texture-destroy.
    if (id !== undefined) {
      const entry = this.bakedByBuilding.get(id);
      if (entry) {
        entry.baked.texture.destroy(true);
        this.bakedByBuilding.delete(id);
      }
    }

    // 2) Destroy the child with branch-specific options so neither the atlas
    //    texture (Sprite branch) nor the shared GraphicsContext (Graphics
    //    branch) is double-destroyed.
    if (child instanceof Sprite) {
      child.destroy({ texture: false, textureSource: false });
    } else if (child instanceof Graphics) {
      child.destroy({ context: false });
    }

    // 3) Shadow sibling — added directly to parent, unchanged from prior logic.
    const shadowGfx = this.shadowByFaces.get(wrapper);
    if (shadowGfx) {
      shadowGfx.destroy();
      this.shadowByFaces.delete(wrapper);
    }

    // 4) Wrapper itself — children already destroyed explicitly above.
    wrapper.destroy({ children: false });
  }

  dispose(): void {
    for (const ctx of this.shadowCache.values()) ctx.destroy();
    this.shadowCache.clear();
    for (const ctx of this.facesCache.values()) ctx.destroy();
    this.facesCache.clear();
    for (const { baked } of this.bakedByBuilding.values()) {
      baked.texture.destroy(true);
    }
    this.bakedByBuilding.clear();
    // wrapperToBuildingId, wrapperChild, shadowByFaces are WeakMaps — self-clear.
  }
}
