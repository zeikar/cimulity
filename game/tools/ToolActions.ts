/**
 * Tool command builders
 *
 * Tools read world state to decide intent and return pure ToolCommand
 * objects; the engine dispatcher applies them. Tools never mutate core.
 */

import { Tool } from './Tool';
import { TileType, createTile, isZoneType } from '../core/Tile';
import type { Tile } from '../core/Tile';
import { SEA_LEVEL, MAX_ELEVATION, tileVertices, tilesTouchingVertex } from '../core/Terrain';
import type { TileCoord } from '../types/coordinates';
import type { World } from '../core/World';
import type { ToolCommand } from './ToolCommand';
import type { StructureType } from '../core/StructureMap';
import { structureFootprintSize } from '../core/StructureMap';

/**
 * POWER_PLANT and WATER_TOWER tiles are structured — terrain tools refuse to edit
 * vertices under them, just like under a road/zone. Invariant: structure tile ⟺
 * StructureMap occupancy (enforced by save validation + dispatcher); checking
 * tile.type is sufficient.
 */
function isStructuredCell(world: World, tile: Tile, x: number, y: number): boolean {
  if (tile.type === TileType.ROAD) return true;
  if (isZoneType(tile.type)) return true;
  if (tile.type === TileType.POWER_PLANT) return true;
  if (tile.type === TileType.WATER_TOWER) return true;
  return world.getMap().getBuildings().getBuildingAt(x, y) !== null;
}

function wouldBreakStructuredTile(
  world: World,
  vx: number,
  vy: number,
  newHeight: number
): boolean {
  const terrain = world.getTerrain();
  const map = world.getMap();
  for (const [tx, ty] of tilesTouchingVertex(vx, vy, terrain.getWidth(), terrain.getHeight())) {
    const tile = map.getTile(tx, ty);
    if (!tile || !isStructuredCell(world, tile, tx, ty)) continue;
    const heights = tileVertices(tx, ty).map(([cx, cy]) =>
      cx === vx && cy === vy ? newHeight : terrain.getVertexHeight(cx, cy)
    );
    const flat = heights.every((h) => h === heights[0]);
    if (!flat || heights[0] <= SEA_LEVEL) return true;
  }
  return false;
}

/** Narrow union of the three placeable zone tile types. */
type ZoneTileType = TileType.ZONE_RESIDENTIAL | TileType.ZONE_COMMERCIAL | TileType.ZONE_INDUSTRIAL;

type PlaceClassification = 'emit' | 'skip' | 'reject';

function classifyRoadTile(world: World, x: number, y: number): PlaceClassification {
  const tile = world.getMap().getTile(x, y);
  if (!tile) return 'reject';
  if (tile.type === TileType.ROAD) return 'skip';
  if (isZoneType(tile.type)) return 'reject';
  if (tile.type === TileType.POWER_PLANT) return 'reject';
  if (tile.type === TileType.WATER_TOWER) return 'reject';
  if (!world.canBuildRoadAt(x, y)) return 'reject';
  return 'emit';
}

function classifyZoneTile(
  world: World, x: number, y: number, zoneType: ZoneTileType
): PlaceClassification {
  const tile = world.getMap().getTile(x, y);
  if (!tile) return 'reject';
  if (tile.type === TileType.POWER_PLANT) return 'reject';
  if (tile.type === TileType.WATER_TOWER) return 'reject';
  if (tile.type === zoneType) return 'skip';
  const paintable =
    tile.type === TileType.GRASS ||
    tile.type === TileType.DIRT ||
    isZoneType(tile.type);
  if (!paintable) return 'reject';
  if (!world.canBuildAt(x, y, 1, 1)) return 'reject';
  return 'emit';
}

export interface ToolPreview {
  /**
   * The caller-provided drag path tiles — copied verbatim from the `tiles`
   * argument. The builder does NOT filter for in-bounds; that is the caller's
   * responsibility. `previewDrag` in CommandDispatcher.ts performs in-bounds
   * filtering BEFORE invoking this builder.
   */
  readonly pathTiles: TileCoord[];
  /** Subset of pathTiles that classify as `reject` for the active tool. */
  readonly rejected: TileCoord[];
  /** True iff the tool is transactional (ROAD) AND `rejected.length > 0`. */
  readonly allOrNothingBlocked: boolean;
  /** Building IDs whose entire footprint will be REMOVED by this preview when
   *  the click commits. Populated only for BULLDOZE, and only for cells whose
   *  current tile is a zone type (i.e. mirrors Map.setTileAndReconcile's
   *  building-removal precondition, NOT the broader buildBulldozeCommands
   *  clearable set). Empty for non-bulldoze tools and for bulldoze paths that
   *  don't touch a removable, owned zone cell. */
  readonly affectedBuildingIds: ReadonlySet<number>;
}

export function buildToolPreview(tool: Tool, tiles: TileCoord[], world: World): ToolPreview {
  const pathTiles = [...tiles];
  let rejected: TileCoord[];
  let allOrNothingBlocked: boolean;
  const affectedBuildingIds: Set<number> = new Set<number>();

  switch (tool) {
    case Tool.ROAD: {
      rejected = tiles.filter(({ x, y }) => classifyRoadTile(world, x, y) === 'reject');
      allOrNothingBlocked = rejected.length > 0;
      break;
    }
    case Tool.ZONE_RESIDENTIAL: {
      rejected = tiles.filter(({ x, y }) => classifyZoneTile(world, x, y, TileType.ZONE_RESIDENTIAL) === 'reject');
      allOrNothingBlocked = false;
      break;
    }
    case Tool.ZONE_COMMERCIAL: {
      rejected = tiles.filter(({ x, y }) => classifyZoneTile(world, x, y, TileType.ZONE_COMMERCIAL) === 'reject');
      allOrNothingBlocked = false;
      break;
    }
    case Tool.ZONE_INDUSTRIAL: {
      rejected = tiles.filter(({ x, y }) => classifyZoneTile(world, x, y, TileType.ZONE_INDUSTRIAL) === 'reject');
      allOrNothingBlocked = false;
      break;
    }
    case Tool.BULLDOZE: {
      rejected = [];
      allOrNothingBlocked = false;
      const map = world.getMap();
      // Expanded pathTiles: raw drag cells, but power-plant cells are replaced by
      // their full structure footprint so the ghost covers all cells the bulldoze
      // will destroy. Dedup by key so overlapping drags don't double-list cells.
      const seenPathKeys = new Set<string>();
      const expandedPathTiles: TileCoord[] = [];
      const addPathTile = (coord: TileCoord): void => {
        const key = `${coord.x},${coord.y}`;
        if (seenPathKeys.has(key)) return;
        seenPathKeys.add(key);
        expandedPathTiles.push(coord);
      };
      for (const { x, y } of tiles) {
        const currentTile = map.getTile(x, y);
        if (!currentTile) continue;
        // Structure tiles (POWER_PLANT, WATER_TOWER): expand to full structure footprint so the
        // drag preview covers all cells the bulldoze will destroy, not just the hovered cell.
        if (currentTile.type === TileType.POWER_PLANT || currentTile.type === TileType.WATER_TOWER) {
          const structure = world.getStructureMap().getStructureAt(x, y);
          if (structure !== null) {
            for (const cell of structure.footprint) addPathTile(cell);
          } else {
            addPathTile({ x, y });
          }
          continue;
        }
        addPathTile({ x, y });
        // Mirror Map.setTileAndReconcile's building-removal precondition:
        // only zone tiles trigger building removal, NOT road tiles.
        // affectedBuildingIds: zone buildings only; structures (power plants) are removed at dispatch time and do not surface here.
        if (!isZoneType(currentTile.type)) continue;
        const building = map.getBuildings().getBuildingAt(x, y);
        if (building !== null) {
          affectedBuildingIds.add(building.id);
        }
      }
      return { pathTiles: expandedPathTiles, rejected, allOrNothingBlocked, affectedBuildingIds };
    }
    case Tool.POWER_PLANT: {
      // `tiles[0]` IS the NW anchor — `pathForTool(Tool.POWER_PLANT, start, end)` returns
      // `[start]`, so the preview path has exactly one tile.
      if (tiles.length > 0 && classifyStructurePlacement(world, tiles[0].x, tiles[0].y, 'power_plant') === 'reject') {
        rejected = [tiles[0]];
      } else {
        rejected = [];
      }
      allOrNothingBlocked = false;
      return { pathTiles, rejected, allOrNothingBlocked, affectedBuildingIds };
    }
    case Tool.WATER_TOWER: {
      // `tiles[0]` IS the NW anchor — `pathForTool(Tool.WATER_TOWER, start, end)` returns
      // `[start]`, so the preview path has exactly one tile.
      if (tiles.length > 0 && classifyStructurePlacement(world, tiles[0].x, tiles[0].y, 'water_tower') === 'reject') {
        rejected = [tiles[0]];
      } else {
        rejected = [];
      }
      allOrNothingBlocked = false;
      return { pathTiles, rejected, allOrNothingBlocked, affectedBuildingIds };
    }
    default:
      rejected = [];
      allOrNothingBlocked = false;
  }

  return { pathTiles, rejected, allOrNothingBlocked, affectedBuildingIds };
}

/**
 * Build the commands a tool would apply on a set of tiles
 * @returns the intended tile writes (empty if the tool changes nothing)
 */
export function buildToolCommands(
  tool: Tool,
  tiles: TileCoord[],
  world: World,
  dragStart: TileCoord
): ToolCommand[] {
  switch (tool) {
    case Tool.SELECT:
      // Selection doesn't modify tiles
      return [];
    case Tool.ROAD:
      return buildRoadCommands(tiles, world);
    case Tool.BULLDOZE:
      return buildBulldozeCommands(tiles, world);
    case Tool.ZONE_RESIDENTIAL:
      return buildZoneCommands(TileType.ZONE_RESIDENTIAL, tiles, world);
    case Tool.ZONE_COMMERCIAL:
      return buildZoneCommands(TileType.ZONE_COMMERCIAL, tiles, world);
    case Tool.ZONE_INDUSTRIAL:
      return buildZoneCommands(TileType.ZONE_INDUSTRIAL, tiles, world);
    case Tool.TERRAIN_UP:
      return buildTerrainUpCommands(tiles, world);
    case Tool.TERRAIN_DOWN:
      return buildTerrainDownCommands(tiles, world);
    case Tool.TERRAIN_LEVEL:
      return buildTerrainLevelCommands(tiles, world, dragStart);
    case Tool.POWER_PLANT:
      return buildPowerPlantCommands(dragStart, world);
    case Tool.WATER_TOWER:
      return buildWaterTowerCommands(dragStart, world);
    default:
      return [];
  }
}

function buildRoadCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const commands: ToolCommand[] = [];
  let anyRejected = false;
  for (const { x, y } of tiles) {
    const c = classifyRoadTile(world, x, y);
    if (c === 'reject') { anyRejected = true; continue; }
    if (c === 'skip') continue;
    commands.push({ kind: 'tile', x, y, tile: createTile(x, y, TileType.ROAD) });
  }
  return anyRejected ? [] : commands;
}

/**
 * Build bulldoze commands.
 * Clears roads and zone tiles to a dirt scar that the simulation regrows to
 * grass on the next tick. Natural terrain (water, grass, dirt) is left
 * untouched. A bulldoze on any cell of a power plant or water tower emits one
 * `remove-structure` per structure in the batch — cost is charged once per
 * structure regardless of how many of its cells the bulldoze path overlaps.
 */
function buildBulldozeCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  const map = world.getMap();
  const commands: ToolCommand[] = [];
  const seenStructures = new Set<number>();

  for (const coord of tiles) {
    const { x, y } = coord;
    const currentTile = map.getTile(x, y);

    if (!currentTile) continue;

    // Structure tile: emit one remove-structure per structure (dedup by id).
    // Applies to all structure tile types (POWER_PLANT and WATER_TOWER are both registered in StructureMap).
    if (currentTile.type === TileType.POWER_PLANT || currentTile.type === TileType.WATER_TOWER) {
      const s = world.getStructureMap().getStructureAt(x, y);
      // Defensive: by invariant s is never null when tile is a structure type.
      // If null, skip — the dispatcher's invariant check enforces correctness for production.
      if (s === null) continue;
      if (!seenStructures.has(s.id)) {
        commands.push({ kind: 'remove-structure', structureId: s.id });
        seenStructures.add(s.id);
      }
      continue;
    }

    const clearable = currentTile.type === TileType.ROAD || isZoneType(currentTile.type);
    if (!clearable) continue;

    commands.push({
      kind: 'tile',
      x,
      y,
      tile: createTile(x, y, TileType.DIRT),
    });
  }

  return commands;
}

/**
 * Shared NW-anchored footprint builder for any 2×2 (or other sized) structure type.
 * Reads the canonical footprint dimensions from `structureFootprintSize` so this
 * function and the serialization layer can never drift apart.
 */
export function structureFootprint(anchor: TileCoord, type: StructureType): TileCoord[] {
  const { w, h } = structureFootprintSize(type);
  const cells: TileCoord[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      cells.push({ x: anchor.x + dx, y: anchor.y + dy });
    }
  }
  return cells;
}

/**
 * Thin alias retained for existing imports/tests; prefer structureFootprint for new callers.
 */
export function powerPlantFootprint(anchor: TileCoord): TileCoord[] {
  return structureFootprint(anchor, 'power_plant');
}

/**
 * Shared placement validator for any service structure (power plant, water
 * tower). Identical rules for every structure type — only the footprint size
 * (via the type) differs — so power and water share one body to prevent drift.
 */
function classifyStructurePlacement(
  world: World,
  x: number,
  y: number,
  type: StructureType,
): 'emit' | 'reject' {
  const map = world.getMap();
  const { w, h } = structureFootprintSize(type);
  // Reject if anchor or SE corner of the footprint is out of bounds.
  if (!map.getTile(x, y) || !map.getTile(x + w - 1, y + h - 1)) return 'reject';
  // Check all footprint cells via the shared helper.
  for (const { x: cx, y: cy } of structureFootprint({ x, y }, type)) {
    const tile = map.getTile(cx, cy);
    if (!tile || tile.type !== TileType.GRASS) return 'reject';
    if (map.getBuildings().getBuildingAt(cx, cy) !== null) return 'reject';
    if (world.getStructureMap().getStructureAt(cx, cy) !== null) return 'reject';
  }
  // Reject if the footprint area is not flat (delegates to Terrain.isFlatArea).
  if (!world.canBuildAt(x, y, w, h)) return 'reject';
  return 'emit';
}

function buildPowerPlantCommands(tile: TileCoord, world: World): ToolCommand[] {
  if (classifyStructurePlacement(world, tile.x, tile.y, 'power_plant') === 'reject') return [];
  return [{ kind: 'place-structure', x: tile.x, y: tile.y, structureType: 'power_plant' }];
}

function buildWaterTowerCommands(tile: TileCoord, world: World): ToolCommand[] {
  if (classifyStructurePlacement(world, tile.x, tile.y, 'water_tower') === 'reject') return [];
  return [{ kind: 'place-structure', x: tile.x, y: tile.y, structureType: 'water_tower' }];
}

function buildZoneCommands(zoneType: ZoneTileType, tiles: TileCoord[], world: World): ToolCommand[] {
  const commands: ToolCommand[] = [];
  for (const { x, y } of tiles) {
    const c = classifyZoneTile(world, x, y, zoneType);
    if (c !== 'emit') continue;
    commands.push({ kind: 'tile', x, y, tile: createTile(x, y, zoneType) });
  }
  return commands;
}

function buildTerrainUpCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  return buildTerrainVertexEditCommand(tiles, world, 'up');
}

function buildTerrainDownCommands(tiles: TileCoord[], world: World): ToolCommand[] {
  return buildTerrainVertexEditCommand(tiles, world, 'down');
}

function buildTerrainLevelCommands(
  tiles: TileCoord[],
  world: World,
  dragStart: TileCoord
): ToolCommand[] {
  const terrain = world.getTerrain();
  const map = world.getMap();

  if (!map.getTile(dragStart.x, dragStart.y)) return [];

  const c = terrain.getTileCornerHeights(dragStart.x, dragStart.y);
  const target = Math.min(c.topH, c.rightH, c.bottomH, c.leftH);

  const vertices = new Map<string, { vx: number; vy: number }>();
  for (const { x, y } of tiles) {
    const tile = map.getTile(x, y);
    if (!tile) continue;
    if (isStructuredCell(world, tile, x, y)) continue;
    for (const [vx, vy] of tileVertices(x, y)) {
      vertices.set(`${vx},${vy}`, { vx, vy });
    }
  }

  const writes = [...vertices.values()]
    .sort((a, b) => a.vy - b.vy || a.vx - b.vx)
    .flatMap(({ vx, vy }) => {
      const h = terrain.getVertexHeight(vx, vy);
      if (h === target) return [];

      // Search from target toward h so the closest-to-target legal value wins.
      const step = target < h ? 1 : -1;
      let h_new = h;
      for (let v = target; v !== h; v += step) {
        if (terrain.canPlayerSetVertexHeight(vx, vy, v)) {
          h_new = v;
          break;
        }
      }

      if (h_new === h) return [];
      if (wouldBreakStructuredTile(world, vx, vy, h_new)) return [];
      return [{ vx, vy, height: h_new }];
    });

  if (writes.length === 0) return [];
  return [{ kind: 'vertex-edit', direction: 'level', writes }];
}

function buildTerrainVertexEditCommand(
  tiles: TileCoord[],
  world: World,
  direction: 'up' | 'down'
): ToolCommand[] {
  const terrain = world.getTerrain();
  const map = world.getMap();
  const vertices = new Map<string, { vx: number; vy: number }>();

  for (const { x, y } of tiles) {
    const tile = map.getTile(x, y);
    if (!tile) continue;
    if (isStructuredCell(world, tile, x, y)) continue;
    for (const [vx, vy] of tileVertices(x, y)) {
      vertices.set(`${vx},${vy}`, { vx, vy });
    }
  }

  const writes = [...vertices.values()]
    .sort((a, b) => a.vy - b.vy || a.vx - b.vx)
    .flatMap(({ vx, vy }) => {
      const current = terrain.getVertexHeight(vx, vy);
      const height = direction === 'up' ? current + 1 : current - 1;
      if (height < SEA_LEVEL || height > MAX_ELEVATION) return [];
      if (!terrain.canPlayerSetVertexHeight(vx, vy, height)) return [];
      if (wouldBreakStructuredTile(world, vx, vy, height)) return [];
      return [{ vx, vy, height }];
    });

  if (writes.length === 0) return [];
  return [{ kind: 'vertex-edit', direction, writes }];
}
