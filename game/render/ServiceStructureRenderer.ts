/**
 * Render-only renderer for the simple service structures (police, fire,
 * hospital, school) — one shared ServiceStructureVisual coloured per type.
 * Mirrors PowerPlantRenderer's per-frame scan / mount / update / prune pattern;
 * a single renderer covers all four civic types (the visual picks the colour),
 * so we don't duplicate four near-identical renderers.
 *
 * Power plants and water towers keep their own dedicated renderers; parks are a
 * separate amenity (no cube). Does NOT destroy buildingContainer — owned by PixiApp.
 */

import { Container } from 'pixi.js';
import type { World } from '@/game/core/World';
import { ServiceStructureVisual } from './visuals/polygon/ServiceStructureVisual';
import { isServiceStructureType } from './visuals/polygon/serviceStructureGeometry';
import { isBuildingVisible } from './viewportCulling';
import type { VisibleTileBounds } from './viewportCulling';

export class ServiceStructureRenderer {
  private readonly buildingContainer: Container;
  private readonly visual: ServiceStructureVisual;
  /** Wrapper containers keyed by structure.id. */
  private readonly byId: Map<number, Container> = new Map();

  constructor(buildingContainer: Container) {
    this.buildingContainer = buildingContainer;
    this.visual = new ServiceStructureVisual();
  }

  render(world: World, visibleBounds?: VisibleTileBounds): void {
    const structureMap = world.getStructureMap();
    const terrain = world.getTerrain();

    const visibleIds = new Set<number>();

    for (const structure of structureMap.iterStructures()) {
      // Only the simple cube service types — power plants, water towers, and
      // parks are handled elsewhere.
      if (!isServiceStructureType(structure.type)) continue;

      if (visibleBounds && !isBuildingVisible(structure.footprint, visibleBounds.buildings)) {
        continue;
      }

      visibleIds.add(structure.id);

      const existing = this.byId.get(structure.id);
      if (!existing) {
        const wrapper = this.visual.mount(structure, terrain, this.buildingContainer);
        this.byId.set(structure.id, wrapper);
      } else {
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
    for (const wrapper of this.byId.values()) {
      this.visual.unmount(wrapper);
    }
    this.byId.clear();
    this.visual.dispose();
    // buildingContainer is owned by PixiApp — not destroyed here.
  }
}
