/**
 * Render-only renderer for park decoration sprites (trees, benches, flowerbeds).
 *
 * Keyed by stable slot key (string) — one Sprite per ParkSlot. Scans the
 * structure map every frame for 'park' structures, culls via the building AABB,
 * then mounts/updates/prunes sprites via the standard per-frame pattern used by
 * ServiceStructureRenderer and siblings.
 *
 * Shared decoration textures (loaded by faceTexture's preloadFaceTextures) are
 * held for the process lifetime and are NOT destroyed here — see faceTexture.ts
 * for the Assets.load/process-lifetime rationale. Only the per-sprite Sprite
 * objects are destroyed on prune/destroy.
 *
 * Does NOT destroy buildingContainer — owned by PixiApp.
 */

import { Container, Sprite } from 'pixi.js';
import type { World } from '@/game/core/World';
import { tileToScreenWithHeight, ISO_CONFIG } from './IsoTransform';
import { isBuildingVisible } from './viewportCulling';
import type { VisibleTileBounds } from './viewportCulling';
import { computeZIndex } from './visuals/polygon/cubeBuildingZIndex';
import { parkObjectsForCell } from './visuals/polygon/decorationPlacement';
import type { ParkObjectKind } from './visuals/polygon/decorationPlacement';
import {
  getTreeTexture,
  getBenchTexture,
  getFlowerbedTexture,
} from './visuals/polygon/faceTexture';
import type { Texture } from 'pixi.js';

function resolveTexture(kind: ParkObjectKind): Texture | null {
  switch (kind) {
    case 'tree0': return getTreeTexture(0);
    case 'tree1': return getTreeTexture(1);
    case 'bench': return getBenchTexture();
    case 'flowerbed': return getFlowerbedTexture();
  }
}

export class DecorationRenderer {
  private readonly buildingContainer: Container;
  private readonly byKey: Map<string, Sprite> = new Map();

  constructor(buildingContainer: Container) {
    this.buildingContainer = buildingContainer;
  }

  render(world: World, visibleBounds: VisibleTileBounds): void {
    const structureMap = world.getStructureMap();
    const terrain = world.getTerrain();

    const visibleKeys = new Set<string>();

    for (const structure of structureMap.iterStructures()) {
      if (structure.type !== 'park') continue;

      if (!isBuildingVisible(structure.footprint, visibleBounds.buildings)) {
        continue;
      }

      const { x: ax, y: ay } = structure.anchor;
      const slots = parkObjectsForCell(structure.id, ax, ay);

      // Hoist loop-invariant computations: both depend only on the anchor.
      const screen = tileToScreenWithHeight({ x: ax, y: ay }, terrain.getRenderHeight(ax, ay));
      const baseZ = computeZIndex([structure.anchor]);

      for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
        const slot = slots[slotIndex];

        // Resolve texture first — if null, skip entirely so the key retries
        // cleanly once the texture loads (no fallback box).
        const tex = resolveTexture(slot.kind);
        if (tex === null) continue;

        // Only after a non-null texture: record the key as visible.
        visibleKeys.add(slot.key);

        const posX = screen.x + slot.dx;
        const posY = screen.y + ISO_CONFIG.TILE_HEIGHT / 2 + slot.dy;
        const zIdx = baseZ + slotIndex * 0.1;

        const existing = this.byKey.get(slot.key);
        if (!existing) {
          // Mount
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5, 1.0);
          sprite.position.set(posX, posY);
          sprite.zIndex = zIdx;
          this.buildingContainer.addChild(sprite);
          this.byKey.set(slot.key, sprite);
        } else {
          // Update — reposition in case terrain elevation changed under the park
          existing.position.set(posX, posY);
          existing.zIndex = zIdx;
        }
      }
    }

    // Prune sprites for keys absent from the current visible pass.
    for (const [key, sprite] of this.byKey) {
      if (!visibleKeys.has(key)) {
        // Default destroy options — do NOT pass { texture: true }; the texture
        // is a shared Assets.load texture owned by faceTexture for the process lifetime.
        sprite.destroy();
        this.byKey.delete(key);
      }
    }
  }

  destroy(): void {
    for (const sprite of this.byKey.values()) {
      // Default options — shared textures are NOT destroyed (see module JSDoc).
      sprite.destroy();
    }
    this.byKey.clear();
    // buildingContainer is owned by PixiApp — not destroyed here.
  }
}
