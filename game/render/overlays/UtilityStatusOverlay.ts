/**
 * Render-only shared utility-status overlay. Reads world.getPowerMap() + world.getWaterMap() +
 * world.getMap().getBuildings(); never mutates core. Draws AT MOST ONE badge per building,
 * glyph-switched by the missing utility with priority POWER > WATER (bolt = no power; drop =
 * powered but no water). One badge avoids the two-stacked-icon collision at cubeTopY - 6.
 * Recompute is owned by World.tick, CommandDispatcher.applyCommands, and the bulk-rebuild
 * drains (save/reset/regenerate).
 *
 * Empty zones (zoned, no building yet) get a bolt iff they are UNpowered — power gates spawn,
 * so an unpowered empty zone is exactly why nothing is growing there, and the bolt explains it.
 * A powered empty zone gets no icon (it will spawn). Water is NEVER shown on empty zones: water
 * gates only level-up/density, not spawn, so an unwatered-but-powered zone still spawns a level-1
 * building — that building then carries a drop badge until a tower reaches it. Power plants and
 * water towers are structures, not buildings/zones — they never get a badge.
 */

import { Graphics, Container } from 'pixi.js';
import type { World } from '@/game/core/World';
import { isBuildingPowered } from '@/game/core/PowerMap';
import { isBuildingWatered } from '@/game/core/WaterMap';
import type { VisibleTileBounds } from '../viewportCulling';
import { isBuildingVisible, iterateVisibleTiles } from '../viewportCulling';
import type { VisualRegistry } from '../visuals/visualRegistry';
import { tileToScreenWithHeight, ISO_CONFIG } from '../IsoTransform';
import { isZoneType } from '@/game/core/Tile';
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
  // Bolt icons on unpowered EMPTY zone tiles (keyed by tile index y*width+x). These only
  // ever show a bolt (power gates spawn), so no glyph-kind tracking is needed.
  private zoneBoltsByTile: Map<number, Graphics> = new Map();

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

    // Empty-zone bolts: a zoned tile with no building yet that is UNpowered gets a bolt,
    // since power gates spawn — this is the player-facing "why nothing is growing here" cue.
    // (Powered empty zones will spawn → no cue; water never gates spawn → never shown here.)
    const width = map.getWidth();
    const height = map.getHeight();
    const tileBounds = visibleBounds
      ? visibleBounds.terrain
      : { minX: 0, maxX: width, minY: 0, maxY: height };
    const halfTileH = ISO_CONFIG.TILE_HEIGHT / 2;
    const needsZoneBolt = new Set<number>();

    for (const { x, y } of iterateVisibleTiles(tileBounds)) {
      const tile = map.getTile(x, y);
      if (!tile || !isZoneType(tile.type)) continue;
      if (map.getBuildings().getBuildingAt(x, y) !== null) continue; // occupied — handled above
      if (pw.isPowered(x, y)) continue; // powered empty zone will spawn — no cue needed

      const idx = y * width + x;
      needsZoneBolt.add(idx);
      let gfx = this.zoneBoltsByTile.get(idx);
      if (!gfx) {
        gfx = new Graphics();
        drawBolt(gfx);
        this.container.addChild(gfx);
        this.zoneBoltsByTile.set(idx, gfx);
      }
      // Float the bolt near the tile's surface center.
      const renderHeight = terrain.getRenderHeight(x, y);
      const s = tileToScreenWithHeight({ x, y }, renderHeight);
      gfx.position.set(s.x, s.y + halfTileH - 6);
    }

    for (const [idx, gfx] of this.zoneBoltsByTile) {
      if (!needsZoneBolt.has(idx)) {
        gfx.destroy();
        this.zoneBoltsByTile.delete(idx);
      }
    }
  }

  destroy(): void {
    for (const gfx of this.iconsByBuildingId.values()) {
      gfx.destroy();
    }
    for (const gfx of this.zoneBoltsByTile.values()) {
      gfx.destroy();
    }
    this.iconsByBuildingId.clear();
    this.glyphKindByBuildingId.clear();
    this.zoneBoltsByTile.clear();
    // container is owned by PixiApp — not destroyed here.
  }
}
