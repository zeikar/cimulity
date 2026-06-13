/**
 * Render-only visual for the simple service structures (police, fire, hospital,
 * school). Draws ONE flat-topped cube over the 2×2 footprint in the per-type
 * colour from `serviceStructureGeometry`. Mirrors PowerPlantVisual's
 * mount/update/unmount lifecycle (static geometry → update only repositions),
 * minus the chimney composition.
 *
 * No GraphicsContext caching: service structures are infrequent, so a per-
 * structure Graphics draw is negligible. `dispose()` is a documented no-op.
 */

import { Graphics, Container } from 'pixi.js';
import { tileToScreenWithHeight } from '@/game/render/IsoTransform';
import { computeZIndex } from './cubeBuildingZIndex';
import { shadeColor } from './cubePalette';
import {
  serviceStructureBaseColor,
  serviceStructureCubeFaces,
  isServiceStructureType,
  type ServiceStructureType,
} from './serviceStructureGeometry';
import {
  getPoliceWallTexture,
  getFireWallTexture,
  getHospitalWallTexture,
  getSchoolWallTexture,
  getRoofTexture,
  wallFaceFillMatrix,
  roofFaceFillMatrix,
} from './faceTexture';
import { drawTexturedPoly, drawPoly, drawWindows, MULLION_COLOR } from './texturedFace';
import { windowSeed } from './windowLights';
import type { Structure } from '@/game/core/StructureMap';
import type { Terrain } from '@/game/core/Terrain';

// Shading multipliers + stroke alphas match CubeBuildingVisual / PowerPlantVisual.
const SHADE_TOP = 1.0;
const SHADE_RIGHT = 0.75;
const SHADE_LEFT = 0.55;
const STROKE_ALPHA_TOP = 0.55;
const STROKE_ALPHA_SIDE = 0.5;

// Per-type glass colour pairs for the windowed civic walls.
// Each type gets a distinct hue so police/fire/hospital/school are immediately
// readable at a glance without relying solely on wall colour.
const CIVIC_GLASS: Record<ServiceStructureType, { lit: number; dark: number }> = {
  // Hospital: cool clinical white-blue — sterile, high-occupancy feel.
  hospital:       { lit: 0xe8f4ff, dark: 0x1e2f40 },
  // Police: cool authority blue — distinct from the hospital but similarly cold.
  police_station: { lit: 0xb0d4ff, dark: 0x14233a },
  // Fire: warm amber-red — heat and urgency; contrasts with the cool civic types.
  fire_station:   { lit: 0xffd090, dark: 0x2a1a0e },
  // School: warm amber — welcoming and energetic.
  school:         { lit: 0xffe0a0, dark: 0x2a200c },
};

// Map civic type to its wall texture getter.
function wallTextureForType(type: ServiceStructureType) {
  switch (type) {
    case 'police_station': return getPoliceWallTexture();
    case 'fire_station':   return getFireWallTexture();
    case 'hospital':       return getHospitalWallTexture();
    case 'school':         return getSchoolWallTexture();
  }
}

// Glass backing colour for a civic wall face.
// Structures have no density variable (each civic building is one size), so the
// density factor used in CubeBuildingVisual's glassColor is simply absent — this
// is not dropping a live variable; there is no density to fold in.
function glassColor(type: ServiceStructureType, lit: boolean, faceFactor: number): number {
  const { lit: litColor, dark: darkColor } = CIVIC_GLASS[type];
  if (lit) {
    // Emissive interior: floor brightness so even the shadowed face glows.
    return shadeColor(litColor, 0.7 + 0.3 * faceFactor);
  }
  return shadeColor(darkColor, faceFactor);
}

export class ServiceStructureVisual {
  /** Maps wrapper Container → its Graphics child so unmount destroys it correctly. */
  private readonly wrapperChild: WeakMap<Container, Graphics> = new WeakMap();

  mount(structure: Structure, terrain: Terrain, parent: Container): Container {
    const anchor = structure.anchor;
    const screen = tileToScreenWithHeight(anchor, terrain.getRenderHeight(anchor.x, anchor.y));

    const wrapper = new Container();
    wrapper.position.set(screen.x, screen.y);
    wrapper.zIndex = computeZIndex(structure.footprint);

    const gfx = new Graphics();
    wrapper.addChild(gfx);
    this.wrapperChild.set(wrapper, gfx);

    this._draw(gfx, structure);

    parent.addChild(wrapper);
    return wrapper;
  }

  update(structure: Structure, terrain: Terrain, displayObject: Container): void {
    // Geometry is static after placement — reposition only.
    const anchor = structure.anchor;
    const screen = tileToScreenWithHeight(anchor, terrain.getRenderHeight(anchor.x, anchor.y));
    displayObject.position.set(screen.x, screen.y);
    displayObject.zIndex = computeZIndex(structure.footprint);
  }

  unmount(displayObject: Container): void {
    const gfx = this.wrapperChild.get(displayObject);
    if (gfx) gfx.destroy();
    displayObject.destroy({ children: false });
  }

  /** No shared GraphicsContext cache is held — explicit no-op (see header). */
  dispose(): void {
    // No-op: per-structure Graphics are destroyed in unmount().
  }

  private _draw(gfx: Graphics, structure: Structure): void {
    // Only the simple service types reach here (the renderer filters), but guard
    // defensively so a non-service type never picks an undefined colour.
    if (!isServiceStructureType(structure.type)) return;

    const faces = serviceStructureCubeFaces(structure.footprint, structure.anchor);
    if (faces === null) return; // non-rect footprint — impossible for a placed structure

    const type = structure.type;
    const base = serviceStructureBaseColor(type);
    const ctx = gfx.context;
    const wallTex = wallTextureForType(type);
    const seed = windowSeed(structure.id);
    const roofTex = getRoofTexture();

    // Painter's order: back side walls before the top face.

    // LEFT face
    if (wallTex !== null) {
      // Windowless wall texture first, then the vector window layer on top.
      drawTexturedPoly(ctx, faces.left, wallTex, wallFaceFillMatrix(faces.left, 0, 0, wallTex), shadeColor(0xffffff, SHADE_LEFT), STROKE_ALPHA_SIDE, 0, 0);
      drawWindows(ctx, faces.left, 'punched', (lit) => glassColor(type, lit, SHADE_LEFT), shadeColor(MULLION_COLOR, SHADE_LEFT), seed, 0, 0);
    } else {
      // Texture unavailable — solid fill; skip the window pass.
      drawPoly(ctx, faces.left, shadeColor(base, SHADE_LEFT), STROKE_ALPHA_SIDE, 0, 0);
    }

    // RIGHT face
    if (wallTex !== null) {
      drawTexturedPoly(ctx, faces.right, wallTex, wallFaceFillMatrix(faces.right, 0, 0, wallTex), shadeColor(0xffffff, SHADE_RIGHT), STROKE_ALPHA_SIDE, 0, 0);
      drawWindows(ctx, faces.right, 'punched', (lit) => glassColor(type, lit, SHADE_RIGHT), shadeColor(MULLION_COLOR, SHADE_RIGHT), seed, 0, 0);
    } else {
      drawPoly(ctx, faces.right, shadeColor(base, SHADE_RIGHT), STROKE_ALPHA_SIDE, 0, 0);
    }

    // TOP face
    if (roofTex !== null) {
      drawTexturedPoly(ctx, faces.top, roofTex, roofFaceFillMatrix(faces.top, 0, 0), shadeColor(0xffffff, SHADE_TOP), STROKE_ALPHA_TOP, 0, 0);
    } else {
      drawPoly(ctx, faces.top, shadeColor(base, SHADE_TOP), STROKE_ALPHA_TOP, 0, 0);
    }
  }
}
