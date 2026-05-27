/**
 * Pixi 8 render-glue: code-generates the placeholder facade atlas.
 *
 * Rasterises 24 placeholder modules into a single 256x256 RenderTexture, then
 * slices it into per-module `Texture` views that share the same source. The
 * owner RenderTexture is held in a module-private WeakMap so the public
 * `FacadeAtlas` value stays opaque (no `_owner` field on the type).
 *
 * NOT gated. Verified by gameplay/manual testing; no headless test mocks.
 */

import type { Renderer } from 'pixi.js';
import { Container, Graphics, Rectangle, RenderTexture, Texture } from 'pixi.js';

import { baseColor, densityShade, shadeColor } from '../polygon/cubePalette';

import {
  FACADE_ATLAS_SIZE,
  FACADE_ATLAS_SLOTS,
  FACADE_ATLAS_VERSION,
  FACADE_MODULE_IDS,
  type AtlasSlot,
} from './facadeAtlasLayout';

export type FacadeAtlas = {
  version: number;
  textures: ReadonlyMap<string, Texture>;
};

type BuildingType = 'residential' | 'commercial' | 'industrial';
type Density = 0 | 1 | 2;

// Module-private. Lets `disposeFacadeAtlas` find the owner RT without leaking
// it through the public `FacadeAtlas` type.
const atlasOwners: WeakMap<FacadeAtlas, RenderTexture> = new WeakMap();

function isBuildingType(s: string): s is BuildingType {
  return s === 'residential' || s === 'commercial' || s === 'industrial';
}

function parseDensity(s: string): Density {
  const n = Number(s);
  if (n === 0 || n === 1 || n === 2) return n;
  throw new Error(`invalid density "${s}"`);
}

function wallColor(type: BuildingType, density: Density): number {
  return shadeColor(baseColor(type), densityShade(density));
}

function drawModule(g: Graphics, id: string, slot: AtlasSlot): void {
  const parts = id.split('.');
  const kind = parts[0];

  if (kind === 'wall') {
    const type = parts[1];
    const density = parts[2];
    if (!isBuildingType(type)) throw new Error(`bad wall id ${id}`);
    const color = wallColor(type, parseDensity(density));
    g.rect(slot.x, slot.y, slot.w, slot.h).fill(color);
    return;
  }

  if (kind === 'window') {
    const type = parts[1];
    const density = parts[2];
    if (!isBuildingType(type)) throw new Error(`bad window id ${id}`);
    const wall = wallColor(type, parseDensity(density));
    g.rect(slot.x, slot.y, slot.w, slot.h).fill(wall);
    // Two dark window panes at fixed positions inside the 64x24 slot.
    const pane = shadeColor(wall, 0.4);
    g.rect(slot.x + 20, slot.y + 8, 4, 6).fill(pane);
    g.rect(slot.x + 40, slot.y + 8, 4, 6).fill(pane);
    return;
  }

  if (kind === 'door') {
    const type = parts[1];
    if (!isBuildingType(type)) throw new Error(`bad door id ${id}`);
    // Doors use the density-0 wall as their background so the door silhouette
    // stays legible regardless of building density.
    const wall = wallColor(type, 0);
    g.rect(slot.x, slot.y, slot.w, slot.h).fill(wall);
    // Dark door panel: 10x16, centered horizontally, anchored to bottom.
    const door = shadeColor(wall, 0.3);
    g.rect(slot.x + 27, slot.y + slot.h - 16, 10, 16).fill(door);
    return;
  }

  if (kind === 'roof' && parts[1] === 'flat') {
    const type = parts[2];
    if (!isBuildingType(type)) throw new Error(`bad roof id ${id}`);
    const roof = shadeColor(baseColor(type), 0.7);
    g.rect(slot.x, slot.y, slot.w, slot.h).fill(roof);
    // Two thin hatch lines so flat roofs read as "roof", not "missing pixel".
    const hatch = shadeColor(roof, 0.85);
    g.rect(slot.x + 4, slot.y + 5, slot.w - 8, 1).fill(hatch);
    g.rect(slot.x + 4, slot.y + 10, slot.w - 8, 1).fill(hatch);
    return;
  }

  throw new Error(`unknown facade module id "${id}"`);
}

/**
 * Build the placeholder atlas. `async` only for API symmetry with the future
 * real-art version (which will use `Assets.load`); the placeholder is
 * synchronous in practice.
 */
export async function initFacadeAtlas(renderer: Renderer): Promise<FacadeAtlas> {
  const rt = RenderTexture.create({
    width: FACADE_ATLAS_SIZE.width,
    height: FACADE_ATLAS_SIZE.height,
  });
  rt.source.scaleMode = 'nearest';

  const container = new Container();
  const g = new Graphics();
  container.addChild(g);

  for (const id of FACADE_MODULE_IDS) {
    const slot = FACADE_ATLAS_SLOTS[id];
    drawModule(g, id, slot);
  }

  renderer.render({ container, target: rt, clear: true });

  const textures = new Map<string, Texture>();
  for (const id of FACADE_MODULE_IDS) {
    const slot = FACADE_ATLAS_SLOTS[id];
    textures.set(
      id,
      new Texture({
        source: rt.source,
        frame: new Rectangle(slot.x, slot.y, slot.w, slot.h),
      }),
    );
  }

  // Temporary scene is no longer needed — destroy it but keep the RT alive,
  // since the slice Textures reference its source.
  g.destroy();
  container.destroy({ children: true });

  const atlas: FacadeAtlas = { version: FACADE_ATLAS_VERSION, textures };
  atlasOwners.set(atlas, rt);
  return atlas;
}

export function disposeFacadeAtlas(atlas: FacadeAtlas): void {
  const rt = atlasOwners.get(atlas);
  if (!rt) return;
  atlasOwners.delete(atlas);
  rt.destroy(true);
}
