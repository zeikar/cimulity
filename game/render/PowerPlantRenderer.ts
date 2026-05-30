/**
 * Render-only renderer for power-plant structures.
 *
 * Iterates StructureMap each frame (the map is tiny — full re-scan is fine and
 * matches UtilityStatusOverlay's approach). Mounts on first sight, updates if
 * already tracked, and prunes wrappers for structures no longer present or
 * visible — mirroring the TileRenderer.buildingById prune pattern.
 *
 * Does NOT destroy buildingContainer — that is owned by PixiApp.
 */

import { Container } from 'pixi.js';
import type { World } from '@/game/core/World';
import { PowerPlantVisual } from './visuals/polygon/PowerPlantVisual';
import { isBuildingVisible } from './viewportCulling';
import type { VisibleTileBounds } from './viewportCulling';

export class PowerPlantRenderer {
  private readonly buildingContainer: Container;
  private readonly visual: PowerPlantVisual;
  /** Wrapper containers keyed by structure.id. */
  private readonly byId: Map<number, Container> = new Map();

  constructor(buildingContainer: Container) {
    this.buildingContainer = buildingContainer;
    this.visual = new PowerPlantVisual();
  }

  render(world: World, visibleBounds?: VisibleTileBounds): void {
    const structureMap = world.getStructureMap();
    const terrain = world.getTerrain();

    // Track which ids are present+visible this frame so we can prune the rest.
    const visibleIds = new Set<number>();

    for (const structure of structureMap.iterStructures()) {
      // Only render power plants — skip any future structure types.
      if (structure.type !== 'power_plant') continue;

      if (visibleBounds && !isBuildingVisible(structure.footprint, visibleBounds.buildings)) {
        continue;
      }

      visibleIds.add(structure.id);

      const existing = this.byId.get(structure.id);
      if (!existing) {
        // First sight: mount the visual and track its wrapper.
        const wrapper = this.visual.mount(structure, terrain, this.buildingContainer);
        this.byId.set(structure.id, wrapper);
      } else {
        // Already tracked: reposition only (geometry is static after placement).
        this.visual.update(structure, terrain, existing);
      }
    }

    // Prune wrappers for ids no longer present or visible this frame.
    for (const [id, wrapper] of this.byId) {
      if (!visibleIds.has(id)) {
        this.visual.unmount(wrapper);
        this.byId.delete(id);
      }
    }
  }

  destroy(): void {
    // Unmount every tracked wrapper before releasing the visual's internal state.
    for (const wrapper of this.byId.values()) {
      this.visual.unmount(wrapper);
    }
    this.byId.clear();
    // Release any shared GraphicsContext cache the visual holds (no-op today,
    // but called unconditionally so the interface is stable — mirrors
    // TileRenderer.destroy() → registry.disposeAll()).
    this.visual.dispose();
    // buildingContainer is owned by PixiApp — not destroyed here.
  }
}
