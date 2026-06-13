/**
 * Render-only visual for the power plant structure.
 *
 * Draws the 2×2 body cube first (always beneath chimneys), then the two
 * chimney cubes sorted back-to-front by (anchor.x+anchor.y, anchor.y).
 * All face geometry comes from `powerPlantCubeFaces` — no iso/lift math
 * is duplicated here.
 *
 * No GraphicsContext caching: power plants are infrequent enough that the
 * overhead of a per-structure Graphics draw is negligible and avoids
 * building a cache-key scheme for world-position-dependent geometry.
 * `dispose()` is therefore a documented no-op; `PowerPlantRenderer.destroy()`
 * calls it unconditionally so the interface is stable.
 */

import { Graphics, Container } from 'pixi.js';
import { tileToScreenWithHeight } from '@/game/render/IsoTransform';
import { computeZIndex } from './cubeBuildingZIndex';
import { shadeColor } from './cubePalette';
import {
  powerPlantCubeSpecs,
  powerPlantCubeFaces,
  type PowerPlantCubeSpec,
} from './powerPlantGeometry';
import {
  getPowerPlantWallTexture,
  getChimneyTexture,
  getRoofTexture,
  wallFaceFillMatrix,
  roofFaceFillMatrix,
} from './faceTexture';
import { drawTexturedPoly, drawPoly, drawWindows, MULLION_COLOR } from './texturedFace';
import { windowSeed } from './windowLights';
import type { Point } from './cubeGeometry';
import type { Structure } from '@/game/core/StructureMap';
import type { Terrain } from '@/game/core/Terrain';

// Base colors for the two cube roles.
// Body uses palette.power_plant (0x7a7a7a); chimneys are slightly darker so
// they read as distinct volumes even against the body.
const BODY_BASE   = 0x7a7a7a;
const CHIMNEY_BASE = 0x606060;

// Shading multipliers — match the CubeBuildingVisual face-shading convention.
const SHADE_TOP   = 1.00;   // brightest face
const SHADE_RIGHT = 0.75;
const SHADE_LEFT  = 0.55;

// Stroke alphas match CubeBuildingVisual exactly: 0.55 on the top face, 0.5 on sides.
const STROKE_ALPHA_TOP  = 0.55;
const STROKE_ALPHA_SIDE = 0.5;

function baseForSpec(spec: PowerPlantCubeSpec): number {
  return spec.role === 'body' ? BODY_BASE : CHIMNEY_BASE;
}

// Glass backing colour for a power plant body wall face.
// Dim warm industrial glow — sparse windowed texture means only a few cells
// reveal glass, but the palette reads as operational/industrial.
function glassColor(lit: boolean, faceFactor: number): number {
  if (lit) {
    // Emissive warm glow, floored so even the shadow face has visible light.
    return shadeColor(0xffd089, 0.7 + 0.3 * faceFactor);
  }
  return shadeColor(0x222018, faceFactor);
}

// ---------------------------------------------------------------------------
// PowerPlantVisual
// ---------------------------------------------------------------------------

export class PowerPlantVisual {
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
   * nothing to release here. Kept as an explicit no-op so PowerPlantRenderer
   * can call `dispose()` unconditionally without a guard.
   */
  dispose(): void {
    // No-op: per-structure Graphics are destroyed in unmount().
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Draw the full power-plant composition into `gfx` in the correct back-to-front
   * order: body first, then chimneys sorted by ascending (anchor.x+anchor.y, anchor.y).
   */
  private _draw(gfx: Graphics, structure: Structure): void {
    const anchor = structure.anchor;
    const ctx = gfx.context;
    const specs = powerPlantCubeSpecs(anchor);
    const seed = windowSeed(structure.id);

    const bodySpec = specs.find((s) => s.role === 'body')!;
    // Body is always drawn before any chimney so chimney cubes overlap it correctly.
    this._drawCube(ctx, powerPlantCubeFaces(bodySpec, anchor), baseForSpec(bodySpec), 'body', seed);

    const chimneySpecs = specs
      .filter((s) => s.role === 'chimney')
      .sort((a, b) => {
        const da = a.anchor.x + a.anchor.y;
        const db = b.anchor.x + b.anchor.y;
        return da !== db ? da - db : a.anchor.y - b.anchor.y;
      });

    for (const spec of chimneySpecs) {
      this._drawCube(ctx, powerPlantCubeFaces(spec, anchor), baseForSpec(spec), 'chimney', seed);
    }
  }

  private _drawCube(
    ctx: import('pixi.js').GraphicsContext,
    faces: { top: Point[]; left: Point[]; right: Point[] },
    base: number,
    role: 'body' | 'chimney',
    seed: number,
  ): void {
    const roofTex = getRoofTexture();

    if (role === 'body') {
      const wallTex = getPowerPlantWallTexture();

      // LEFT face
      if (wallTex !== null) {
        // Windowless body wall first, then the vector window layer on top.
        drawTexturedPoly(ctx, faces.left, wallTex, wallFaceFillMatrix(faces.left, 0, 0, wallTex), shadeColor(0xffffff, SHADE_LEFT), STROKE_ALPHA_SIDE, 0, 0);
        drawWindows(ctx, faces.left, 'punched', (lit) => glassColor(lit, SHADE_LEFT), shadeColor(MULLION_COLOR, SHADE_LEFT), seed, 0, 0);
      } else {
        drawPoly(ctx, faces.left, shadeColor(base, SHADE_LEFT), STROKE_ALPHA_SIDE, 0, 0);
      }

      // RIGHT face
      if (wallTex !== null) {
        drawTexturedPoly(ctx, faces.right, wallTex, wallFaceFillMatrix(faces.right, 0, 0, wallTex), shadeColor(0xffffff, SHADE_RIGHT), STROKE_ALPHA_SIDE, 0, 0);
        drawWindows(ctx, faces.right, 'punched', (lit) => glassColor(lit, SHADE_RIGHT), shadeColor(MULLION_COLOR, SHADE_RIGHT), seed, 0, 0);
      } else {
        drawPoly(ctx, faces.right, shadeColor(base, SHADE_RIGHT), STROKE_ALPHA_SIDE, 0, 0);
      }
    } else {
      // Chimney: opaque walls — NO window backing.
      const chimneyTex = getChimneyTexture();

      // LEFT face
      if (chimneyTex !== null) {
        drawTexturedPoly(ctx, faces.left, chimneyTex, wallFaceFillMatrix(faces.left, 0, 0, chimneyTex), shadeColor(0xffffff, SHADE_LEFT), STROKE_ALPHA_SIDE, 0, 0);
      } else {
        drawPoly(ctx, faces.left, shadeColor(base, SHADE_LEFT), STROKE_ALPHA_SIDE, 0, 0);
      }

      // RIGHT face
      if (chimneyTex !== null) {
        drawTexturedPoly(ctx, faces.right, chimneyTex, wallFaceFillMatrix(faces.right, 0, 0, chimneyTex), shadeColor(0xffffff, SHADE_RIGHT), STROKE_ALPHA_SIDE, 0, 0);
      } else {
        drawPoly(ctx, faces.right, shadeColor(base, SHADE_RIGHT), STROKE_ALPHA_SIDE, 0, 0);
      }
    }

    // TOP face — same roof rule for every cube (body and chimneys).
    if (roofTex !== null) {
      drawTexturedPoly(ctx, faces.top, roofTex, roofFaceFillMatrix(faces.top, 0, 0), shadeColor(0xffffff, SHADE_TOP), STROKE_ALPHA_TOP, 0, 0);
    } else {
      drawPoly(ctx, faces.top, shadeColor(base, SHADE_TOP), STROKE_ALPHA_TOP, 0, 0);
    }
  }
}
