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
import { tileFillColor } from '../palette';
import { tileTypeFromBuildingType } from '@/game/core/Building';
import { normalizeFootprint, cubeFacePolygons } from './cubeGeometry';
import type { BuildingVisual, BuildingVisualInput } from '../TileVisual';

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function topColor(input: BuildingVisualInput): number {
  // Top face matches the zone tile color at the current level (shared palette).
  return tileFillColor(tileTypeFromBuildingType(input.type), input.level);
}

function leftColor(input: BuildingVisualInput): number {
  // Left face is darkened ~40%.
  const base = topColor(input);
  const r = Math.round(((base >> 16) & 0xff) * 0.6);
  const g = Math.round(((base >> 8) & 0xff) * 0.6);
  const b = Math.round((base & 0xff) * 0.6);
  return (r << 16) | (g << 8) | b;
}

function rightColor(input: BuildingVisualInput): number {
  // Right face is darkened ~25%.
  const base = topColor(input);
  const r = Math.round(((base >> 16) & 0xff) * 0.75);
  const g = Math.round(((base >> 8) & 0xff) * 0.75);
  const b = Math.round((base & 0xff) * 0.75);
  return (r << 16) | (g << 8) | b;
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

function buildContext(input: BuildingVisualInput): GraphicsContext | null {
  const faces = cubeFacePolygons(input.level, input.footprint, input.anchor);
  if (faces === null) return null;

  const ctx = new GraphicsContext();

  // Left face (draw first so top face renders on top).
  ctx.beginPath();
  ctx.moveTo(faces.left[0].x, faces.left[0].y);
  for (let i = 1; i < faces.left.length; i++) {
    ctx.lineTo(faces.left[i].x, faces.left[i].y);
  }
  ctx.closePath();
  ctx.fill({ color: leftColor(input) });
  ctx.stroke({ color: 0x000000, width: 1, alpha: 0.25 });

  // Right face.
  ctx.beginPath();
  ctx.moveTo(faces.right[0].x, faces.right[0].y);
  for (let i = 1; i < faces.right.length; i++) {
    ctx.lineTo(faces.right[i].x, faces.right[i].y);
  }
  ctx.closePath();
  ctx.fill({ color: rightColor(input) });
  ctx.stroke({ color: 0x000000, width: 1, alpha: 0.25 });

  // Top face.
  ctx.beginPath();
  ctx.moveTo(faces.top[0].x, faces.top[0].y);
  for (let i = 1; i < faces.top.length; i++) {
    ctx.lineTo(faces.top[i].x, faces.top[i].y);
  }
  ctx.closePath();
  ctx.fill({ color: topColor(input) });
  ctx.stroke({ color: 0x000000, width: 1, alpha: 0.3 });

  return ctx;
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
