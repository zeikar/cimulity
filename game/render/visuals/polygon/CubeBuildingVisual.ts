/**
 * BuildingVisual that draws a plain isometric cube (no variation) for level > 0.
 *
 * The visual returns a stable wrapper `Container` whose child is a polygon
 * `Graphics` driven by a cached anchor-local `GraphicsContext`. The shadow
 * `Graphics` sibling is added directly to the building parent Container —
 * not to the wrapper — so iso depth sort sees shadow and faces as independent
 * siblings.
 *
 * For level === 0 the building has no visual of its own — the terrain
 * DiamondTileVisual already renders the flat zone diamond.
 *
 * Polygon geometry is computed in anchor-local screen coordinates so cached
 * GraphicsContexts are reusable for any building of the same shape at any
 * map position.
 */

import { Graphics, GraphicsContext, Container, Texture } from 'pixi.js';
import { tileToScreen, tileToScreenWithHeight } from '@/game/render/IsoTransform';
import type { Point } from './cubeGeometry';
import {
  normalizeFootprint,
  cubeFacePolygons,
  isNwAnchoredFullRectFootprint,
} from './cubeGeometry';
import { cubeShadowPolygon, SHADOW_COLOR, SHADOW_ALPHA } from './cubeDropShadow';
import {
  getWallTexture,
  wallFaceFillMatrix,
  wallVariant,
  getRoofTexture,
  roofFaceFillMatrix,
} from './faceTexture';
import { windowSeed } from './windowLights';
import { computeZIndex } from './cubeBuildingZIndex';
import type { BuildingVisual, BuildingVisualInput } from '../TileVisual';
import type { BuildingType } from '@/game/core/Building';
import type { Terrain } from '@/game/core/Terrain';
import {
  baseColor,
  shadeColor,
  densityShade,
} from './cubePalette';
import { cubeBodyHeightPx } from './cubeLift';
import { drawTexturedPoly, drawPoly, drawWindowBacking } from './texturedFace';

function topColor(input: BuildingVisualInput): number {
  // Top face: full-brightness white-based tint (face shading only). The roof
  // texture carries its own colour, so we don't fold in the building-type
  // palette here — multiplying by white preserves the texture's hue while the
  // density factor keeps the subtle per-density darkening.
  return shadeColor(0xffffff, densityShade(input.density));
}

function leftColor(input: BuildingVisualInput): number {
  // Left face — strongest shadow side (~55% brightness). Full-colour pixel-art
  // walls carry their own hue, so the tint is white-based (face shading only);
  // multiplying by the texture preserves its colour instead of adding a type cast.
  return shadeColor(0xffffff, 0.55 * densityShade(input.density));
}

function rightColor(input: BuildingVisualInput): number {
  // Right face — softer shadow (~75% brightness). White-based for the same reason
  // as leftColor (texture supplies the colour).
  return shadeColor(0xffffff, 0.75 * densityShade(input.density));
}

// --- Window lights -----------------------------------------------------------
// Per-type glass colour pairs: lit = emissive interior glow, dark = unlit glass.
// Distinct palettes give residential/commercial/industrial a clear visual identity.
const GLASS_COLORS: Record<BuildingType, { lit: number; dark: number }> = {
  residential: { lit: 0xffcf8a, dark: 0x26303f }, // warm amber / cool slate
  commercial:  { lit: 0xbfe3ff, dark: 0x1e2a38 }, // cool blue-white / deep blue
  industrial:  { lit: 0xffe2a8, dark: 0x2a2824 }, // dim warm / dark brown-grey
};

// Glass backing colour for a single window cell or a whole face.
// Lit cells read as emissive (brightness floored so the shadow face still glows);
// unlit cells take the full face shading like the wall.
function glassColor(type: BuildingType, lit: boolean, faceFactor: number, density: 0 | 1 | 2): number {
  const { lit: litColor, dark: darkColor } = GLASS_COLORS[type];
  if (lit) {
    const factor = (0.7 + 0.3 * faceFactor) * densityShade(density);
    return shadeColor(litColor, factor);
  }
  return shadeColor(darkColor, faceFactor * densityShade(density));
}

// ---------------------------------------------------------------------------
// structureInput helper
// ---------------------------------------------------------------------------

function structureInputOf(input: BuildingVisualInput): BuildingVisualInput {
  const sr = input.structureRect;
  const cells: { x: number; y: number }[] = [];
  for (let y = sr.y; y < sr.y + sr.h; y++) {
    for (let x = sr.x; x < sr.x + sr.w; x++) {
      cells.push({ x, y });
    }
  }
  return {
    ...input,
    footprint: cells,
    anchor: { x: sr.x, y: sr.y },
  };
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

// Geometry-only key: cube silhouette / shadow depend on type+level+density+shape
// but NOT on the wall facade, so shadows share one context across variants.
function geometryKey(input: BuildingVisualInput): string {
  const shape = normalizeFootprint(input.footprint, input.anchor);
  return `${input.type}:${input.level}:${input.density}:${shape}`;
}

// Faces key: geometry plus the facade variant AND the per-building window seed,
// so buildings with different window-light patterns don't share one cached context.
function facesKey(input: BuildingVisualInput): string {
  const base = `${geometryKey(input)}:${wallVariant(input.buildingId)}`;
  return `${base}:s${windowSeed(input.buildingId)}`;
}

// All shadows must draw before any face — large negative offset puts every shadow zIndex
// below any computeZIndex(footprint) value while preserving relative depth among shadows.
export const SHADOW_Z_OFFSET = -1_000_000;

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

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
  const variant = wallVariant(input.buildingId);
  const wallTex = getWallTexture(input.type, variant);
  const seed = windowSeed(input.buildingId);

  if (wallTex !== Texture.EMPTY) {
    // Paint per-window glass backing BEFORE the wall texture so transparent window
    // holes in the texture reveal the correct lit/unlit glass colour beneath.
    // All zone types get this treatment; commercial/industrial walls are currently
    // opaque, so their backing is hidden — harmless, and ready when those textures
    // gain transparency.
    drawWindowBacking(ctx, faces.left, (lit) => glassColor(input.type, lit, 0.55, input.density), seed, ox, oy);
    drawWindowBacking(ctx, faces.right, (lit) => glassColor(input.type, lit, 0.75, input.density), seed, ox, oy);
    drawTexturedPoly(ctx, faces.left, wallTex, wallFaceFillMatrix(faces.left, ox, oy, wallTex), leftColor(input), 0.5, ox, oy);
    drawTexturedPoly(ctx, faces.right, wallTex, wallFaceFillMatrix(faces.right, ox, oy, wallTex), rightColor(input), 0.5, ox, oy);
  } else {
    // Wall texture unavailable — fall back to type-colored flat fill so the failure
    // path preserves residential/commercial/industrial identity instead of rendering gray.
    const base = baseColor(input.type);
    const ds = densityShade(input.density);
    drawPoly(ctx, faces.left, shadeColor(base, 0.55 * ds), 0.5, ox, oy);
    drawPoly(ctx, faces.right, shadeColor(base, 0.75 * ds), 0.5, ox, oy);
  }

  // Roof: textured top diamond when the rooftop tile is loaded; flat colour otherwise.
  const roofTex = getRoofTexture();
  if (roofTex) {
    drawTexturedPoly(ctx, faces.top, roofTex, roofFaceFillMatrix(faces.top, ox, oy), topColor(input), 0.55, ox, oy);
  } else {
    // Roof texture unavailable — flat fill using type-colored palette to preserve identity.
    drawPoly(ctx, faces.top, shadeColor(baseColor(input.type), densityShade(input.density)), 0.55, ox, oy);
  }
}

function buildShadowContext(input: BuildingVisualInput): GraphicsContext | null {
  if (input.level === 0) return null;

  const ctx = new GraphicsContext();

  if (isNwAnchoredFullRectFootprint(input.footprint, input.anchor)) {
    const faces = cubeFacePolygons(
      input.type, input.level, input.density,
      input.footprint, input.anchor,
    );
    if (faces === null) return null;
    drawCubeShadow(ctx, faces, 0, 0);
    return ctx;
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
    const faces = cubeFacePolygons(
      input.type, input.level, input.density,
      input.footprint, input.anchor,
    );
    if (faces === null) return null;
    drawCubeFaces(ctx, faces, input, 0, 0);
    return ctx;
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
    drawCubeFaces(ctx, faces, input, cellScreen.x - anchorScreen.x, cellScreen.y - anchorScreen.y);
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

  /** Maps the wrapper Container → its Graphics child so update() can swap the context in-place
   *  and unmount() can destroy it with the right options. */
  private wrapperChild: WeakMap<Container, Graphics> = new WeakMap();

  private getOrBuildShadowContext(input: BuildingVisualInput): GraphicsContext | null {
    if (input.level === 0) return null;
    const key = geometryKey(input);
    let ctx = this.shadowCache.get(key);
    if (!ctx) {
      ctx = buildShadowContext(input) ?? undefined;
      if (ctx) this.shadowCache.set(key, ctx);
    }
    return ctx ?? null;
  }

  private getOrBuildFacesContext(input: BuildingVisualInput): GraphicsContext | null {
    if (input.level === 0) return null;
    const key = facesKey(input);
    let ctx = this.facesCache.get(key);
    if (!ctx) {
      ctx = buildFacesContext(input) ?? undefined;
      if (ctx) this.facesCache.set(key, ctx);
    }
    return ctx ?? null;
  }

  mount(input: BuildingVisualInput, parent: Container): Container {
    // input.footprint is the LOT; structureInput.footprint is the STRUCTURE — cube/shadow geometry uses structureInput, yard layer uses input.footprint.
    const structureInput = structureInputOf(input);

    // renderHeight is NOT part of geometry caches — anchor-local geometry is
    // position-independent. Terrain elevation is applied here on the wrapper.
    const h = input.renderHeight ?? 0;
    const screen = tileToScreenWithHeight(structureInput.anchor, h);
    const zIndex = computeZIndex(structureInput.footprint);

    const wrapper = new Container();
    wrapper.position.set(screen.x, screen.y);
    wrapper.zIndex = zIndex;

    const facesGfx = new Graphics();
    const facesCtx = this.getOrBuildFacesContext(structureInput);
    if (facesCtx) facesGfx.context = facesCtx;
    wrapper.addChild(facesGfx);
    this.wrapperChild.set(wrapper, facesGfx);

    parent.addChild(wrapper);

    // Shadow Graphics is a sibling of the wrapper (added to `parent`), not a
    // child of the wrapper. Sort order between shadow and faces uses zIndex.
    const shadowCtx = this.getOrBuildShadowContext(structureInput);
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
    const structureInput = structureInputOf(input);

    const h = input.renderHeight ?? 0;
    const screen = tileToScreenWithHeight(structureInput.anchor, h);
    const zIndex = computeZIndex(structureInput.footprint);
    wrapper.position.set(screen.x, screen.y);
    wrapper.zIndex = zIndex;

    // Polygon-only path: swap the GraphicsContext in place. wrapperChild is
    // always set in mount(); a missing entry would indicate a logic bug.
    const facesGfx = this.wrapperChild.get(wrapper);
    if (facesGfx) {
      const facesCtx = this.getOrBuildFacesContext(structureInput);
      facesGfx.context = facesCtx ?? CubeBuildingVisual.emptyContext;
    }

    // Shadow update — keyed by wrapper.
    const newShadowCtx = this.getOrBuildShadowContext(structureInput);
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
    const child = this.wrapperChild.get(wrapper);

    // Destroy the Graphics child WITHOUT destroying its shared GraphicsContext
    // (contexts live in facesCache and are reused across buildings).
    if (child) {
      child.destroy({ context: false });
    }

    // Shadow sibling — added directly to parent.
    const shadowGfx = this.shadowByFaces.get(wrapper);
    if (shadowGfx) {
      shadowGfx.destroy();
      this.shadowByFaces.delete(wrapper);
    }

    // Wrapper itself — child already destroyed explicitly above.
    wrapper.destroy({ children: false });
  }

  /**
   * Returns the screen-y of the cube's top face for the given building, using the EXACT
   * positioning chain `mount()` uses (`tileToScreenWithHeight` of the structure anchor at
   * `terrain.getRenderHeight`, plus the cube body height). The overlay reads this to anchor
   * floating icons above the cube top without duplicating cube geometry math.
   */
  getCubeTopScreenY(building: BuildingVisualInput, terrain: Terrain): number {
    const structureInput = structureInputOf(building);
    const h = terrain.getRenderHeight(structureInput.anchor.x, structureInput.anchor.y);
    const screen = tileToScreenWithHeight(structureInput.anchor, h);
    const lift = cubeBodyHeightPx(building.level, building.density, building.type);
    // Cube top is ABOVE the anchor in screen space — subtract the lift.
    // For level-0 buildings (lift === 0), returns the terrain-top screen-y.
    return screen.y - lift;
  }

  dispose(): void {
    for (const ctx of this.shadowCache.values()) ctx.destroy();
    this.shadowCache.clear();
    for (const ctx of this.facesCache.values()) ctx.destroy();
    this.facesCache.clear();
    // wrapperChild, shadowByFaces are WeakMaps — self-clear.
  }
}
