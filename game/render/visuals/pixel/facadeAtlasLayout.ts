/**
 * Pure layout helper for the placeholder facade atlas.
 *
 * Owns the canonical module-id list and the `(x, y, w, h)` slot table inside
 * the 256x256 atlas. No Pixi imports — the render-glue side (`facadeAtlas.ts`)
 * consumes these constants when rasterising the placeholder bitmap.
 *
 * No imports from game/core, game/engine, game/tools, or game/input.
 */

export const FACADE_ATLAS_VERSION = 1;

export const FACADE_ATLAS_SIZE = { width: 256, height: 256 } as const;

export type AtlasSlot = { x: number; y: number; w: number; h: number };

type BuildingType = 'residential' | 'commercial' | 'industrial';
type Density = 0 | 1 | 2;

const BUILDING_TYPES: ReadonlyArray<BuildingType> = ['residential', 'commercial', 'industrial'];
const DENSITIES: ReadonlyArray<Density> = [0, 1, 2];

// Canonical module id order:
//   9 walls   (type x density)
//   9 windows (type x density)
//   3 doors   (type)
//   3 flat roofs (type)
// = 24 total. Order is stable so atlas debug overlays / golden tests can pin
// indices if needed later.
function buildModuleIds(): ReadonlyArray<string> {
  const ids: string[] = [];
  for (const t of BUILDING_TYPES) {
    for (const d of DENSITIES) {
      ids.push(`wall.${t}.${d}`);
    }
  }
  for (const t of BUILDING_TYPES) {
    for (const d of DENSITIES) {
      ids.push(`window.${t}.${d}`);
    }
  }
  for (const t of BUILDING_TYPES) {
    ids.push(`door.${t}`);
  }
  for (const t of BUILDING_TYPES) {
    ids.push(`roof.flat.${t}`);
  }
  return ids;
}

export const FACADE_MODULE_IDS: ReadonlyArray<string> = buildModuleIds();

// Sizes per module-kind. Walls / windows / doors are 64x24 (side-face slot);
// flat roofs are 64x16 (top-face slot).
function sizeFor(id: string): { w: number; h: number } {
  if (id.startsWith('roof.')) return { w: 64, h: 16 };
  return { w: 64, h: 24 };
}

function buildModulesWithSizes(): ReadonlyArray<{ id: string; w: number; h: number }> {
  return FACADE_MODULE_IDS.map((id) => ({ id, ...sizeFor(id) }));
}

/**
 * Simple shelf-pack: walks modules in input order, placing each into the
 * current row left-to-right. When a module would overflow the row, starts a
 * new row whose height equals the new module's height. Throws if a module
 * does not fit at all.
 */
export function layoutSlots(
  modules: ReadonlyArray<{ id: string; w: number; h: number }>,
  atlasW: number,
  atlasH: number,
): Record<string, AtlasSlot> {
  const slots: Record<string, AtlasSlot> = {};
  let rowX = 0;
  let rowY = 0;
  let rowH = 0;
  for (const m of modules) {
    if (rowX + m.w <= atlasW && rowY + m.h <= atlasH) {
      slots[m.id] = { x: rowX, y: rowY, w: m.w, h: m.h };
      rowX += m.w;
      if (m.h > rowH) rowH = m.h;
    } else if (rowY + rowH + m.h <= atlasH) {
      rowY += rowH;
      rowX = 0;
      rowH = m.h;
      slots[m.id] = { x: rowX, y: rowY, w: m.w, h: m.h };
      rowX += m.w;
    } else {
      throw new Error(`module ${m.id} does not fit in atlas ${atlasW}x${atlasH}`);
    }
  }
  return slots;
}

export const FACADE_ATLAS_SLOTS: Readonly<Record<string, AtlasSlot>> = layoutSlots(
  buildModulesWithSizes(),
  FACADE_ATLAS_SIZE.width,
  FACADE_ATLAS_SIZE.height,
);
