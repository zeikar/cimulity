/**
 * Render-only shared utility-status overlay. Reads world.getPowerMap() + world.getWaterMap() +
 * world.getMap().getBuildings(); never mutates core. Draws AT MOST ONE badge per building,
 * glyph-switched by the missing utility with priority POWER > WATER (bolt = no power; drop =
 * powered but no water). One badge avoids the two-stacked-icon collision at cubeTopY - 6.
 * Recompute is owned by World.tick, CommandDispatcher.applyCommands, and the bulk-rebuild
 * drains (save/reset/regenerate).
 *
 * Empty zones (zoned, no building yet) get AT MOST ONE icon explaining why nothing is growing
 * there, priority ROAD > POWER (mirrors the building badge's one-icon rule). Road comes FIRST
 * because it is the more fundamental gate: power only ever reaches a cell orthogonally adjacent
 * to a road (see roadNetworkPropagation), so a roadless zone can never be powered AND can never
 * spawn (the spawn frontage gate). Conversely a powered empty zone is ALWAYS road-adjacent, so
 * "powered but roadless" cannot happen. Both gates follow lot COVERAGE via
 * classifyEmptyZoneSpawnBlock: it finds the frontage seed whose road-fronting lot (grown along
 * contiguous same-type empty cells) would cover this tile, and takes the road AND power verdicts on
 * that seed — because the spawner checks power on the seed and the lot then absorbs deeper cells.
 * So interior cells of a deep lot are NOT mislabeled (neither a road glyph nor a false bolt); a
 * road across unzoned land does not count (contiguity required); terrain is ignored (a slope-only
 * blocker is not road/power-fixable, so it stays unbadged). Thus:
 *   - no road-fronting lot reaches the tile → road glyph (build/extend a road; also unblocks power),
 *   - a lot reaches it but no covering frontage seed is powered → bolt (common early-game: zoned by
 *     a road, no power plant connected yet),
 *   - a powered frontage seed will spawn a covering lot → no icon (and terrain/demand-only blockers
 *     stay unbadged, since a road/power can't fix them).
 * Water is NEVER shown on empty zones: water gates only level-up/density, not spawn, so an
 * unwatered-but-powered zone still spawns a level-1 building — that building then carries a drop
 * badge until a tower reaches it. Power plants and water towers are structures, not
 * buildings/zones — they never get a badge.
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
import { classifyEmptyZoneSpawnBlock } from '@/game/core/zoneGrowth';
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

// Road glyph: a horizontal grey road bar with two white centerline dashes — its horizontal
// orientation reads distinctly from the vertical bolt and the drop. Grey on a colored zone
// tile, with bright dashes so it pops. Means "no road frontage in reach → can't spawn".
const ROAD_BAR_COLOR = 0x555555;
const ROAD_DASH_COLOR = 0xf2f2f2;
const ROAD_BAR_POINTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: -7, y: -3 },
  { x:  7, y: -3 },
  { x:  7, y:  3 },
  { x: -7, y:  3 },
];

type GlyphKind = 'bolt' | 'drop' | 'road';

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

function drawRoad(gfx: Graphics): void {
  gfx.clear();
  // Road bar.
  gfx.beginPath();
  gfx.moveTo(ROAD_BAR_POINTS[0].x, ROAD_BAR_POINTS[0].y);
  for (let i = 1; i < ROAD_BAR_POINTS.length; i++) {
    gfx.lineTo(ROAD_BAR_POINTS[i].x, ROAD_BAR_POINTS[i].y);
  }
  gfx.closePath();
  gfx.fill({ color: ROAD_BAR_COLOR });
  // Two white centerline dashes so it reads as a road, not a plain bar.
  gfx.rect(-5, -0.7, 3, 1.4);
  gfx.rect(2, -0.7, 3, 1.4);
  gfx.fill({ color: ROAD_DASH_COLOR });
}

function drawGlyph(gfx: Graphics, kind: GlyphKind): void {
  if (kind === 'bolt') drawBolt(gfx);
  else if (kind === 'drop') drawDrop(gfx);
  else drawRoad(gfx);
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
    abandoned: building.abandoned,
  };
}

export class UtilityStatusOverlay {
  private container: Container;
  private registry: VisualRegistry;
  private iconsByBuildingId: Map<number, Graphics> = new Map();
  // Tracks which glyph is currently drawn per building so we can redraw on kind change.
  private glyphKindByBuildingId: Map<number, GlyphKind> = new Map();
  // Icons on EMPTY zone tiles that can't spawn (keyed by tile index y*width+x), with the glyph
  // kind tracked per tile so we redraw on a power↔road switch (e.g. a tower powers a roadless zone).
  private zoneIconsByTile: Map<number, Graphics> = new Map();
  private zoneGlyphKindByTile: Map<number, GlyphKind> = new Map();

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
        drawGlyph(gfx, kind);
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

    // Empty-zone icons: a zoned tile with no building yet that can't spawn gets ONE icon,
    // priority road > power — the player-facing "why nothing is growing here" cue. Both gates
    // follow lot COVERAGE (the road/power verdict is taken on the frontage seed that would spawn a
    // lot covering this tile), so deep interior cells aren't mislabeled. (Road-reachable + powered
    // empty zones will spawn → no cue; water never gates spawn.)
    const width = map.getWidth();
    const height = map.getHeight();
    const tileBounds = visibleBounds
      ? visibleBounds.terrain
      : { minX: 0, maxX: width, minY: 0, maxY: height };
    const halfTileH = ISO_CONFIG.TILE_HEIGHT / 2;
    const isPoweredAt = (px: number, py: number) => pw.isPowered(px, py);
    const needsZoneIcon = new Set<number>();

    for (const { x, y } of iterateVisibleTiles(tileBounds)) {
      const tile = map.getTile(x, y);
      if (!tile || !isZoneType(tile.type)) continue;
      if (map.getBuildings().getBuildingAt(x, y) !== null) continue; // occupied — handled above

      const block = classifyEmptyZoneSpawnBlock({ x, y }, world, isPoweredAt);
      if (block === null) continue; // will spawn, or only terrain/demand-blocked → no cue
      const kind: GlyphKind = block === 'road' ? 'road' : 'bolt';

      const idx = y * width + x;
      needsZoneIcon.add(idx);
      let gfx = this.zoneIconsByTile.get(idx);
      if (!gfx) {
        gfx = new Graphics();
        this.container.addChild(gfx);
        this.zoneIconsByTile.set(idx, gfx);
      }
      if (this.zoneGlyphKindByTile.get(idx) !== kind) {
        drawGlyph(gfx, kind);
        this.zoneGlyphKindByTile.set(idx, kind);
      }
      // Float the icon near the tile's surface center.
      const renderHeight = terrain.getRenderHeight(x, y);
      const s = tileToScreenWithHeight({ x, y }, renderHeight);
      gfx.position.set(s.x, s.y + halfTileH - 6);
    }

    for (const [idx, gfx] of this.zoneIconsByTile) {
      if (!needsZoneIcon.has(idx)) {
        gfx.destroy();
        this.zoneIconsByTile.delete(idx);
        this.zoneGlyphKindByTile.delete(idx);
      }
    }
  }

  destroy(): void {
    for (const gfx of this.iconsByBuildingId.values()) {
      gfx.destroy();
    }
    for (const gfx of this.zoneIconsByTile.values()) {
      gfx.destroy();
    }
    this.iconsByBuildingId.clear();
    this.glyphKindByBuildingId.clear();
    this.zoneIconsByTile.clear();
    this.zoneGlyphKindByTile.clear();
    // container is owned by PixiApp — not destroyed here.
  }
}
