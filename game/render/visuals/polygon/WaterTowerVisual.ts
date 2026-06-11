/**
 * Render-only visual for the water tower structure.
 *
 * Draws the 1×1 body cube first (always beneath the tank), then the single
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
import {
  getWaterTowerBodyTexture,
  getWaterTowerTankTexture,
  getRoofTexture,
  wallFaceFillMatrix,
  roofFaceFillMatrix,
} from './faceTexture';
import { drawTexturedPoly, drawPoly } from './texturedFace';
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

    this._draw(gfx, structure);

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
  private _draw(gfx: Graphics, structure: Structure): void {
    const anchor = structure.anchor;
    const ctx = gfx.context;
    const specs = waterTowerCubeSpecs(anchor);

    const bodySpec = specs.find((s) => s.role === 'body')!;
    // Body is always drawn before the tank so the tank cube overlaps it correctly.
    this._drawCube(ctx, waterTowerCubeFaces(bodySpec, anchor), baseForSpec(bodySpec), 'body');

    const tankSpec = specs.find((s) => s.role === 'tank')!;
    this._drawCube(ctx, waterTowerCubeFaces(tankSpec, anchor), baseForSpec(tankSpec), 'tank');
  }

  private _drawCube(
    ctx: import('pixi.js').GraphicsContext,
    faces: { top: Point[]; left: Point[]; right: Point[] },
    base: number,
    role: 'body' | 'tank',
  ): void {
    const wallTex = role === 'body' ? getWaterTowerBodyTexture() : getWaterTowerTankTexture();
    const roofTex = getRoofTexture();

    // Both body and tank are opaque — NO window backing for either.

    // LEFT face
    if (wallTex !== null) {
      drawTexturedPoly(ctx, faces.left, wallTex, wallFaceFillMatrix(faces.left, 0, 0, wallTex), shadeColor(0xffffff, SHADE_LEFT), STROKE_ALPHA_SIDE, 0, 0);
    } else {
      drawPoly(ctx, faces.left, shadeColor(base, SHADE_LEFT), STROKE_ALPHA_SIDE, 0, 0);
    }

    // RIGHT face
    if (wallTex !== null) {
      drawTexturedPoly(ctx, faces.right, wallTex, wallFaceFillMatrix(faces.right, 0, 0, wallTex), shadeColor(0xffffff, SHADE_RIGHT), STROKE_ALPHA_SIDE, 0, 0);
    } else {
      drawPoly(ctx, faces.right, shadeColor(base, SHADE_RIGHT), STROKE_ALPHA_SIDE, 0, 0);
    }

    // TOP face — same roof rule for every cube (body and tank).
    if (roofTex !== null) {
      drawTexturedPoly(ctx, faces.top, roofTex, roofFaceFillMatrix(faces.top, 0, 0), shadeColor(0xffffff, SHADE_TOP), STROKE_ALPHA_TOP, 0, 0);
    } else {
      drawPoly(ctx, faces.top, shadeColor(base, SHADE_TOP), STROKE_ALPHA_TOP, 0, 0);
    }
  }
}
