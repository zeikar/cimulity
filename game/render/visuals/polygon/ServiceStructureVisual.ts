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
} from './serviceStructureGeometry';
import type { Point } from './cubeGeometry';
import type { Structure } from '@/game/core/StructureMap';
import type { Terrain } from '@/game/core/Terrain';

// Shading multipliers + stroke alphas match CubeBuildingVisual / PowerPlantVisual.
const SHADE_TOP = 1.0;
const SHADE_RIGHT = 0.75;
const SHADE_LEFT = 0.55;
const STROKE_ALPHA_TOP = 0.55;
const STROKE_ALPHA_SIDE = 0.5;

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

    const base = serviceStructureBaseColor(structure.type);
    // Painter's order: back side walls before the top face.
    drawPoly(gfx, faces.left, shadeColor(base, SHADE_LEFT), STROKE_ALPHA_SIDE);
    drawPoly(gfx, faces.right, shadeColor(base, SHADE_RIGHT), STROKE_ALPHA_SIDE);
    drawPoly(gfx, faces.top, shadeColor(base, SHADE_TOP), STROKE_ALPHA_TOP);
  }
}
