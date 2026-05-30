/**
 * Render-only shared utility-status overlay. Reads world.getPowerMap() + world.getWaterMap() +
 * world.getMap().getBuildings(); never mutates core. Draws AT MOST ONE badge per building,
 * glyph-switched by the missing utility with priority POWER > WATER (bolt = no power; drop =
 * powered but no water). One badge avoids the two-stacked-icon collision at cubeTopY - 6.
 * Recompute is owned by World.tick, CommandDispatcher.applyCommands, and the bulk-rebuild
 * drains (save/reset/regenerate). Empty unserviced zones (no building yet) intentionally get
 * no icon. Power plants and water towers are structures, not buildings — they never get a badge.
 * Water gates growth, not spawn, so an unwatered city still grows level-1 buildings that then
 * carry a drop badge until a tower reaches them.
 */

import { Graphics, Container } from 'pixi.js';
import type { World } from '@/game/core/World';
import { isBuildingPowered } from '@/game/core/PowerMap';
import { isBuildingWatered } from '@/game/core/WaterMap';
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

// Water-drop polygon: point at top, rounded bottom approximated as a 7-point polygon.
// The shape tapers to a tip at y=-8 and bulges to a rounded bottom at y=+6.
const DROP_COLOR = 0x4ab8ff;
const DROP_POINTS: ReadonlyArray<{ x: number; y: number }> = [
  { x:  0, y: -8 }, // top tip
  { x:  3, y: -3 }, // upper-right shoulder
  { x:  5, y:  2 }, // right side
  { x:  3, y:  6 }, // lower-right
  { x: -3, y:  6 }, // lower-left
  { x: -5, y:  2 }, // left side
  { x: -3, y: -3 }, // upper-left shoulder
];

type GlyphKind = 'bolt' | 'drop';

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

function drawDrop(gfx: Graphics): void {
  gfx.clear();
  gfx.beginPath();
  gfx.moveTo(DROP_POINTS[0].x, DROP_POINTS[0].y);
  for (let i = 1; i < DROP_POINTS.length; i++) {
    gfx.lineTo(DROP_POINTS[i].x, DROP_POINTS[i].y);
  }
  gfx.closePath();
  gfx.fill({ color: DROP_COLOR });
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

export class UtilityStatusOverlay {
  private container: Container;
  private registry: VisualRegistry;
  private iconsByBuildingId: Map<number, Graphics> = new Map();
  // Tracks which glyph is currently drawn per building so we can redraw on kind change.
  private glyphKindByBuildingId: Map<number, GlyphKind> = new Map();

  constructor(container: Container, registry: VisualRegistry) {
    this.container = container;
    this.registry = registry;
  }

  render(world: World, visibleBounds?: VisibleTileBounds): void {
    const pw = world.getPowerMap();
    const wm = world.getWaterMap();
    const map = world.getMap();
    const terrain = world.getTerrain();

    // Build the set of building ids that need an icon this frame.
    const needsIcon = new Set<number>();

    for (const building of map.getBuildings().iterBuildings()) {
      if (visibleBounds && !isBuildingVisible(building.footprint, visibleBounds.buildings)) {
        continue;
      }

      let kind: GlyphKind | null = null;
      if (!isBuildingPowered(building, pw)) {
        // Priority: missing power wins regardless of water status.
        kind = 'bolt';
      } else if (!isBuildingWatered(building, wm)) {
        kind = 'drop';
      }

      if (kind === null) continue;

      needsIcon.add(building.id);

      // Mount new icon or redraw if the glyph kind has switched (e.g. power restored).
      let gfx = this.iconsByBuildingId.get(building.id);
      if (!gfx) {
        gfx = new Graphics();
        this.container.addChild(gfx);
        this.iconsByBuildingId.set(building.id, gfx);
      }

      const currentKind = this.glyphKindByBuildingId.get(building.id);
      if (currentKind !== kind) {
        // Kind changed or newly mounted — (re)draw.
        if (kind === 'bolt') {
          drawBolt(gfx);
        } else {
          // kind === 'drop'
          drawDrop(gfx);
        }
        this.glyphKindByBuildingId.set(building.id, kind);
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
        this.glyphKindByBuildingId.delete(id);
      }
    }
  }

  destroy(): void {
    for (const gfx of this.iconsByBuildingId.values()) {
      gfx.destroy();
    }
    this.iconsByBuildingId.clear();
    this.glyphKindByBuildingId.clear();
    // container is owned by PixiApp — not destroyed here.
  }
}
