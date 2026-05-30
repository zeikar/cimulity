/**
 * Render-only visual for the water tower structure.
 *
 * Draws the 2×2 body cube first (always beneath the tank), then the single
 * elevated tank cube above it. All face geometry comes from `waterTowerCubeFaces`
 * — no iso/lift math is duplicated here.
 *
 * No GraphicsContext caching: water towers are infrequent enough that the
 * overhead of a per-structure Graphics draw is negligible and avoids
 * building a cache-key scheme for world-position-dependent geometry.
 * `dispose()` is therefore a documented no-op; `WaterTowerRenderer.destroy()`
 * calls it unconditionally so the interface is stable.
 */

import { Graphics, Container } from 'pixi.js';
import { tileToScreenWithHeight } from '@/game/render/IsoTransform';
import { computeZIndex } from './cubeBuildingZIndex';
import { shadeColor } from './cubePalette';
import {
  waterTowerCubeSpecs,
  waterTowerCubeFaces,
  type WaterTowerCubeSpec,
} from './waterTowerGeometry';
import type { Point } from './cubeGeometry';
import type { Structure } from '@/game/core/StructureMap';
import type { Terrain } from '@/game/core/Terrain';

// Base colors for the two cube roles.
// Body uses palette.water_tower (0x3f7fb0); the tank is slightly darker so
// it reads as a distinct elevated volume above the base.
const BODY_BASE = 0x3f7fb0;
const TANK_BASE = 0x2c608a;

// Shading multipliers — match the CubeBuildingVisual face-shading convention.
const SHADE_TOP   = 1.00;   // brightest face
const SHADE_RIGHT = 0.75;
const SHADE_LEFT  = 0.55;

// Stroke alphas match CubeBuildingVisual exactly: 0.55 on the top face, 0.5 on sides.
const STROKE_ALPHA_TOP  = 0.55;
const STROKE_ALPHA_SIDE = 0.5;

function baseForSpec(spec: WaterTowerCubeSpec): number {
  return spec.role === 'body' ? BODY_BASE : TANK_BASE;
}

function drawFaces(
  gfx: Graphics,
  faces: { top: Point[]; left: Point[]; right: Point[] },
  base: number,
): void {
  // Left → right → top (painter's order: back sides before top face).
  drawPoly(gfx, faces.left,  shadeColor(base, SHADE_LEFT),  STROKE_ALPHA_SIDE);
  drawPoly(gfx, faces.right, shadeColor(base, SHADE_RIGHT), STROKE_ALPHA_SIDE);
  drawPoly(gfx, faces.top,   shadeColor(base, SHADE_TOP),   STROKE_ALPHA_TOP);
}

function drawPoly(
  gfx: Graphics,
  points: ReadonlyArray<Point>,
  fillColor: number,
  strokeAlpha: number,
): void {
  gfx.beginPath();
  gfx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    gfx.lineTo(points[i].x, points[i].y);
  }
  gfx.closePath();
  gfx.fill({ color: fillColor });
  gfx.stroke({ color: 0x000000, width: 1, alpha: strokeAlpha });
}

// ---------------------------------------------------------------------------
// WaterTowerVisual
// ---------------------------------------------------------------------------

export class WaterTowerVisual {
  /** Maps wrapper Container → the Graphics child so unmount can destroy it correctly. */
  private readonly wrapperChild: WeakMap<Container, Graphics> = new WeakMap();

  mount(structure: Structure, terrain: Terrain, parent: Container): Container {
    const anchor = structure.anchor;

    const screen = tileToScreenWithHeight(anchor, terrain.getRenderHeight(anchor.x, anchor.y));
    const zIndex = computeZIndex(structure.footprint);

    const wrapper = new Container();
    wrapper.position.set(screen.x, screen.y);
    wrapper.zIndex = zIndex;

    const gfx = new Graphics();
    wrapper.addChild(gfx);
    this.wrapperChild.set(wrapper, gfx);

    this._draw(gfx, anchor);

    parent.addChild(wrapper);
    return wrapper;
  }

  update(structure: Structure, terrain: Terrain, displayObject: Container): void {
    const anchor = structure.anchor;

    // Geometry is static (footprint + cube heights never change after placement),
    // so update only repositions the wrapper; cubes are drawn once at mount.
    const wrapper = displayObject;
    const screen = tileToScreenWithHeight(anchor, terrain.getRenderHeight(anchor.x, anchor.y));
    wrapper.position.set(screen.x, screen.y);
    wrapper.zIndex = computeZIndex(structure.footprint);
  }

  unmount(displayObject: Container): void {
    const wrapper = displayObject;
    const gfx = this.wrapperChild.get(wrapper);
    if (gfx) {
      // Graphics owns no shared GraphicsContext here — destroy fully.
      gfx.destroy();
    }
    wrapper.destroy({ children: false });
  }

  /**
   * No shared GraphicsContext cache is held by this visual, so there is
   * nothing to release here. Kept as an explicit no-op so WaterTowerRenderer
   * can call `dispose()` unconditionally without a guard.
   */
  dispose(): void {
    // No-op: per-structure Graphics are destroyed in unmount().
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Draw the full water-tower composition into `gfx` in the correct back-to-front
   * order: body first, then the tank cube on top.
   */
  private _draw(gfx: Graphics, anchor: { x: number; y: number }): void {
    const specs = waterTowerCubeSpecs(anchor);

    const bodySpec = specs.find((s) => s.role === 'body')!;
    // Body is always drawn before the tank so the tank cube overlaps it correctly.
    drawFaces(gfx, waterTowerCubeFaces(bodySpec, anchor), baseForSpec(bodySpec));

    const tankSpec = specs.find((s) => s.role === 'tank')!;
    drawFaces(gfx, waterTowerCubeFaces(tankSpec, anchor), baseForSpec(tankSpec));
  }
}
