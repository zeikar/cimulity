/**
 * Render-only renderer for park decoration sprites (trees, benches, flowerbeds)
 * and street trees on roadside grass tiles.
 *
 * Keyed by stable slot key (string) — one Sprite per decoration slot. Scans the
 * structure map every frame for 'park' structures (park: prefix) and iterates
 * visible tiles for street trees (street: prefix) and empty-land trees (land:
 * prefix). All three share a single prune pass so removal is automatic.
 *
 * Shared decoration textures (loaded by faceTexture's preloadFaceTextures) are
 * held for the process lifetime and are NOT destroyed here — see faceTexture.ts
 * for the Assets.load/process-lifetime rationale. Only the per-sprite Sprite
 * objects are destroyed on prune/destroy.
 *
 * Does NOT destroy buildingContainer — owned by PixiApp.
 */

import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { World } from '@/game/core/World';
import { tileToScreenWithHeight, ISO_CONFIG } from './IsoTransform';
import { isBuildingVisible, iterateVisibleTiles } from './viewportCulling';
import type { VisibleTileBounds } from './viewportCulling';
import { computeZIndex } from './visuals/polygon/cubeBuildingZIndex';
import { parkObjectsForCell, streetTreeForCell, landTreesForCell } from './visuals/polygon/decorationPlacement';
import type { ParkObjectKind } from './visuals/polygon/decorationPlacement';
import {
  getTreeTexture,
  getBenchTexture,
  getFlowerbedTexture,
} from './visuals/polygon/faceTexture';
import { TileType } from '@/game/core/Tile';

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

  /**
   * Mount or update a decoration sprite.
   *
   * Skips silently when tex is null (texture not yet loaded). Adds the key to
   * visibleKeys only after confirming a non-null texture so the prune pass does
   * not destroy a slot that should retry next frame.
   */
  private mountOrUpdate(
    key: string,
    tex: Texture | null,
    screenX: number,
    screenY: number,
    zIndex: number,
    visibleKeys: Set<string>,
  ): void {
    if (tex === null) return;

    // Only after a non-null texture: record the key as visible.
    visibleKeys.add(key);

    const existing = this.byKey.get(key);
    if (!existing) {
      // Mount
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 1.0);
      sprite.position.set(screenX, screenY);
      sprite.zIndex = zIndex;
      this.buildingContainer.addChild(sprite);
      this.byKey.set(key, sprite);
    } else {
      // Update — reposition in case terrain elevation changed under the tile.
      existing.position.set(screenX, screenY);
      existing.zIndex = zIndex;
    }
  }

  render(world: World, visibleBounds: VisibleTileBounds): void {
    const structureMap = world.getStructureMap();
    const terrain = world.getTerrain();

    const visibleKeys = new Set<string>();

    // ── Park pass ─────────────────────────────────────────────────────────────
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
        const posX = screen.x + slot.dx;
        const posY = screen.y + ISO_CONFIG.TILE_HEIGHT / 2 + slot.dy;
        const zIndex = baseZ + slotIndex * 0.1;
        this.mountOrUpdate(slot.key, resolveTexture(slot.kind), posX, posY, zIndex, visibleKeys);
      }
    }

    // ── Street-tree pass ──────────────────────────────────────────────────────
    const map = world.getMap();
    const isRoad = (x: number, y: number): boolean =>
      map.getTile(x, y)?.type === TileType.ROAD;
    const isPlainGrass = (x: number, y: number): boolean =>
      map.getTile(x, y)?.type === TileType.GRASS && structureMap.getStructureAt(x, y) === null;

    for (const { x, y } of iterateVisibleTiles(visibleBounds.buildings)) {
      const candidate = streetTreeForCell(x, y, isRoad, isPlainGrass);
      if (candidate !== null) {
        const screen = tileToScreenWithHeight({ x, y }, terrain.getRenderHeight(x, y));
        const posX = screen.x + candidate.dx;
        const posY = screen.y + ISO_CONFIG.TILE_HEIGHT / 2 + candidate.dy;
        const zIndex = computeZIndex([{ x, y }]);
        this.mountOrUpdate(candidate.key, getTreeTexture(candidate.variant), posX, posY, zIndex, visibleKeys);
        // Roadside cell hosts a street tree — skip land trees to avoid double-placement.
        continue;
      }

      // Empty-land pass: only reached when no street tree here. Resolve trees
      // before the screen projection so the terrain read stays off the hot path
      // for the majority of (non-grass) tiles, which yield no trees.
      const landTrees = landTreesForCell(x, y, isPlainGrass);
      if (landTrees.length === 0) continue;
      const screen = tileToScreenWithHeight({ x, y }, terrain.getRenderHeight(x, y));
      const baseZ = computeZIndex([{ x, y }]);
      for (const tree of landTrees) {
        const posX = screen.x + tree.dx;
        const posY = screen.y + ISO_CONFIG.TILE_HEIGHT / 2 + tree.dy;
        const zIndex = baseZ + tree.slotIndex * 0.1;
        this.mountOrUpdate(tree.key, getTreeTexture(tree.variant), posX, posY, zIndex, visibleKeys);
      }
    }

    // Prune sprites for keys absent from the current visible pass (covers
    // park:, street:, and land: prefixes — no separate prune needed).
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
