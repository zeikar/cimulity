/**
 * Render-only overlay. Reads `world.getPowerMap()` and `world.getMap().getBuildings()`;
 * never mutates core. Recompute is owned by `World.tick` (sim path),
 * `CommandDispatcher.applyCommands` (tool path), and the bulk-rebuild drains in
 * save-hydrate/reset/regenerate paths (Task 7). Empty unpowered zones (no building yet)
 * intentionally get no icon — absence of growth is the player-visible feedback. Power
 * plants are not buildings; they never get an icon. Icon y derived from `getCubeTopScreenY`,
 * same source of truth as `CubeBuildingVisual` — so the icon floats above the actual cube
 * top, not the terrain top.
 */

import { Graphics, Container } from 'pixi.js';
import type { World } from '@/game/core/World';
import { isBuildingPowered } from '@/game/core/PowerMap';
import type { VisibleTileBounds } from '../viewportCulling';
import { isBuildingVisible } from '../viewportCulling';
import type { VisualRegistry } from '../visuals/visualRegistry';
import { tileToScreenWithHeight } from '../IsoTransform';
import type { Building } from '@/game/core/Building';
import type { BuildingVisualInput } from '../visuals/TileVisual';

// Lightning-bolt polygon points in local coordinates (centered roughly at 0,0).
// A simple 5-point zigzag bolt shape.
const BOLT_COLOR = 0xffd84a;
const BOLT_POINTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 3,  y: -8 },
  { x: -1, y: -1 },
  { x: 2,  y: -1 },
  { x: -3, y:  8 },
  { x: 1,  y:  1 },
  { x: -2, y:  1 },
];

function drawBolt(gfx: Graphics): void {
  gfx.clear();
  gfx.beginPath();
  gfx.moveTo(BOLT_POINTS[0].x, BOLT_POINTS[0].y);
  for (let i = 1; i < BOLT_POINTS.length; i++) {
    gfx.lineTo(BOLT_POINTS[i].x, BOLT_POINTS[i].y);
  }
  gfx.closePath();
  gfx.fill({ color: BOLT_COLOR });
}

function buildingToVisualInput(building: Building, renderHeight: number): BuildingVisualInput {
  return {
    buildingId: building.id,
    type: building.type,
    anchor: building.anchor,
    footprint: building.footprint,
    level: building.level,
    density: building.density,
    frontage: building.frontage,
    structureRect: building.structureRect,
    renderHeight,
  };
}

export class PowerStatusOverlay {
  private container: Container;
  private registry: VisualRegistry;
  private iconsByBuildingId: Map<number, Graphics> = new Map();

  constructor(container: Container, registry: VisualRegistry) {
    this.container = container;
    this.registry = registry;
  }

  render(world: World, visibleBounds?: VisibleTileBounds): void {
    const pw = world.getPowerMap();
    const map = world.getMap();
    const terrain = world.getTerrain();

    // Build the set of building ids that need an icon this frame.
    const needsIcon = new Set<number>();

    for (const building of map.getBuildings().iterBuildings()) {
      if (visibleBounds && !isBuildingVisible(building.footprint, visibleBounds.buildings)) {
        continue;
      }
      if (isBuildingPowered(building, pw)) {
        continue;
      }
      needsIcon.add(building.id);

      // Mount or update icon.
      let gfx = this.iconsByBuildingId.get(building.id);
      if (!gfx) {
        gfx = new Graphics();
        drawBolt(gfx);
        this.container.addChild(gfx);
        this.iconsByBuildingId.set(building.id, gfx);
      }

      // Position the icon above the cube top.
      const buildingVisual = this.registry.getBuilding(building.type);
      const renderHeight = terrain.getRenderHeight(building.structureRect.x, building.structureRect.y);
      const input = buildingToVisualInput(building, renderHeight);
      const cubeTopY = buildingVisual.getCubeTopScreenY(input, terrain);
      const iconScreenX = tileToScreenWithHeight(building.structureRect, renderHeight).x;
      gfx.position.set(iconScreenX, cubeTopY - 6);
    }

    // Unmount icons for buildings no longer needing them.
    for (const [id, gfx] of this.iconsByBuildingId) {
      if (!needsIcon.has(id)) {
        gfx.destroy();
        this.iconsByBuildingId.delete(id);
      }
    }
  }

  destroy(): void {
    for (const gfx of this.iconsByBuildingId.values()) {
      gfx.destroy();
    }
    this.iconsByBuildingId.clear();
    // container is owned by PixiApp — not destroyed here.
  }
}
