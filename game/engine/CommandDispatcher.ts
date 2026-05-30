/**
 * Command dispatcher: the seam between input intent and core mutation
 *
 * Given the current tool and a click or raw drag, resolves the tool's
 * path, bounds-filters it, asks the tool to build commands, then applies
 * those commands to core. Resolving the path with the current tool at
 * call time avoids stale-rule bugs. Tools never mutate core; the engine
 * applies their commands here.
 */

import { Tool } from '../tools/Tool';
import { snapRoadDragPath } from '../tools/RoadTool';
import { rectDragPath } from '../tools/BulldozeTool';
import { buildToolCommands, buildToolPreview, structureFootprint } from '../tools';
import { ROAD_COST, ZONE_COST, BULLDOZE_COST, POWER_PLANT_COST, WATER_TOWER_COST } from '../core/World';
import { TileType, createTile, isZoneType } from '../core/Tile';
import { SEA_LEVEL, tilesTouchingVertex } from '../core/Terrain';
import type { World } from '../core/World';
import type { TileCoord } from '../types/coordinates';
import type { ToolCommand, ToolResult, ToolPreview } from '../tools';

/**
 * Single place tool→path mapping lives. Each drag tool owns its own path
 * rule: ROAD snaps to H/V/45° lines, BULLDOZE and all zone tools share the
 * filled-rectangle rule (rectDragPath).
 */
function pathForTool(
  tool: Tool,
  start: TileCoord,
  end: TileCoord
): TileCoord[] {
  switch (tool) {
    case Tool.ROAD:
      return snapRoadDragPath(start, end);
    case Tool.ZONE_RESIDENTIAL:
    case Tool.ZONE_COMMERCIAL:
    case Tool.ZONE_INDUSTRIAL:
    case Tool.BULLDOZE:
    case Tool.TERRAIN_UP:
    case Tool.TERRAIN_DOWN:
    case Tool.TERRAIN_LEVEL:
      return rectDragPath(start, end);
    case Tool.POWER_PLANT:
    case Tool.WATER_TOWER:
      // Drag collapses to a single click at the NW anchor.
      return [start];
    default:
      return [];
  }
}

/**
 * Cost for a single command, keyed on the tile type being written.
 * DIRT is the tile bulldoze writes for both ROAD→DIRT and ZONE→DIRT clears,
 * so BULLDOZE_COST is charged for any bulldoze command regardless of the
 * source tile type. Zone types share ZONE_COST when being placed.
 * Elevation writes are always free.
 *
 * Cost is per-command. A power-plant placement pays POWER_PLANT_COST once.
 * A remove-structure pays BULLDOZE_COST once per plant — drag-rect dedup
 * happens at the tool layer, so one plant cannot be billed twice.
 */
function commandCost(cmd: ToolCommand): number {
  if (cmd.kind === 'vertex-edit') return 0;
  if (cmd.kind === 'place-structure') {
    if (cmd.structureType === 'power_plant') return POWER_PLANT_COST;
    if (cmd.structureType === 'water_tower') return WATER_TOWER_COST;
    return 0;
  }
  if (cmd.kind === 'remove-structure') return BULLDOZE_COST;
  const t = cmd.tile.type;
  if (t === TileType.ROAD) return ROAD_COST;
  if (isZoneType(t)) return ZONE_COST;
  if (t === TileType.DIRT) return BULLDOZE_COST;
  // TERRAIN_DOWN may write DIRT→GRASS after lowering to SEA_LEVEL; GRASS tile writes are free.
  return 0;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Apply tool commands to core state; report tiles actually written.
 * This is the only place tool-driven mutation reaches core.
 *
 * Cost is charged on the whole batch before any tile write (all-or-nothing).
 * Same-zone repaint emits no commands → zero total → free, no trySpend call.
 * Insufficient funds → silent no-op, empty changedTiles.
 *
 * Power and water are recomputed at the end of `applyCommands` whenever any
 * command dirtied them, so the next render frame always reads a fresh snapshot
 * — even when the simulation is paused. Tick-path recompute remains as
 * defense-in-depth. The two dirty flags are independent: a tower bulldoze does
 * not recompute power; a road change dirties both.
 *
 * Exported so invariant-throw branches can be exercised directly in tests
 * without routing through the tool-command builders that normally prevent
 * those states from occurring.
 */
export function applyCommands(commands: ToolCommand[], world: World): ToolResult {
  if (commands.length === 0) return { changedTiles: [], affectedTiles: [], removedBuildingIds: [] };

  const total = commands.reduce((s, c) => s + commandCost(c), 0);
  // Never call trySpend(0) — only charge when there is an actual cost.
  if (total > 0 && !world.trySpend(total)) {
    return { changedTiles: [], affectedTiles: [], removedBuildingIds: [] };
  }

  const map = world.getMap();
  const changedTiles: TileCoord[] = [];
  const affectedTiles: TileCoord[] = [];
  const removedBuildingIds: number[] = [];
  let landValueInvalidated = false;
  let powerInvalidated = false;
  let waterInvalidated = false;
  const pushedChanged = new Set<string>();
  const pushChanged = (x: number, y: number): void => {
    const key = tileKey(x, y);
    if (pushedChanged.has(key)) return;
    pushedChanged.add(key);
    changedTiles.push({ x, y });
  };

  for (const cmd of commands) {
    if (cmd.kind === 'vertex-edit') {
      const terrain = world.getTerrain();
      const convertedDirt = new Set<string>();
      for (const write of cmd.writes) {
        const prevHeight = terrain.getVertexHeight(write.vx, write.vy);
        const changed = terrain.setPlayerVertexHeight(write.vx, write.vy, write.height);
        if (!changed) continue;

        for (const [tx, ty] of tilesTouchingVertex(write.vx, write.vy, terrain.getWidth(), terrain.getHeight())) {
          pushChanged(tx, ty);

          if (cmd.direction === 'up') continue;
          // Only reconcile DIRT→GRASS when this specific write crossed sea level downward.
          // A 'level' write that raises a vertex, or a down-write on an already-below-sea-level
          // corner, must not trigger conversion.
          if (!(prevHeight > SEA_LEVEL && write.height <= SEA_LEVEL)) continue;
          if (terrain.getTileMinCornerHeight(tx, ty) > SEA_LEVEL) continue;
          const key = tileKey(tx, ty);
          if (convertedDirt.has(key)) continue;
          const tile = map.getTile(tx, ty);
          if (tile?.type !== TileType.DIRT) continue;
          const rec = map.setTileAndReconcile(tx, ty, createTile(tx, ty, TileType.GRASS));
          if (rec.changed) {
            convertedDirt.add(key);
            pushChanged(tx, ty);
          }
        }
      }
    } else if (cmd.kind === 'place-structure') {
      const footprint = structureFootprint({ x: cmd.x, y: cmd.y }, cmd.structureType);
      // Invariant: classifier passed, so addStructure must succeed.
      const structure = world.getStructureMap().addStructure({
        type: cmd.structureType,
        footprint,
        anchor: { x: cmd.x, y: cmd.y },
      });
      // This branch should never fire: addStructure returned null despite classifier passing.
      // This can only happen if two place-structure commands overlap (the tool layer never produces that).
      if (structure === null) {
        throw new Error('invariant: addStructure returned null after classifier passed');
      }
      const tileType = cmd.structureType === 'water_tower' ? TileType.WATER_TOWER : TileType.POWER_PLANT;
      for (const { x: cx, y: cy } of footprint) {
        const rec = map.setTileAndReconcile(cx, cy, createTile(cx, cy, tileType));
        pushChanged(cx, cy);
        // Defensively handle any removed building (classifier should have prevented this).
        if (rec.removedBuilding !== null) {
          removedBuildingIds.push(rec.removedBuilding.id);
          for (const coord of rec.removedBuilding.footprint) {
            affectedTiles.push(coord);
          }
        }
      }
      if (cmd.structureType === 'water_tower') {
        waterInvalidated = true;
      } else {
        powerInvalidated = true;
      }
    } else if (cmd.kind === 'remove-structure') {
      const s = world.getStructureMap().getStructure(cmd.structureId);
      // Invariant: tool layer dedupes by id; a stale id cannot reach applyCommands through normal flow.
      if (s === null) {
        throw new Error('invariant: remove-structure references a missing structureId');
      }
      // Use the structure's stored footprint directly (authoritative; avoids any
      // drift from recomputing it).
      for (const { x: cx, y: cy } of s.footprint) {
        map.setTileAndReconcile(cx, cy, createTile(cx, cy, TileType.DIRT));
        pushChanged(cx, cy);
      }
      world.getStructureMap().removeStructure(s.id);
      if (s.type === 'water_tower') {
        waterInvalidated = true;
      } else {
        powerInvalidated = true;
      }
    } else {
      const prevTile = map.getTile(cmd.x, cmd.y);
      const rec = map.setTileAndReconcile(cmd.x, cmd.y, cmd.tile);
      if (rec.changed) {
        pushChanged(cmd.x, cmd.y);
        // Mark land value dirty when a ROAD or ZONE tile is placed or replaced.
        if (
          !landValueInvalidated &&
          (cmd.tile.type === TileType.ROAD ||
            isZoneType(cmd.tile.type) ||
            (prevTile !== null && (prevTile.type === TileType.ROAD || isZoneType(prevTile.type))))
        ) {
          landValueInvalidated = true;
        }
        // Mark power and water dirty when a ROAD tile is placed or a ROAD tile is replaced.
        // ROAD changes affect both graphs — a new road may extend either network.
        if (
          cmd.tile.type === TileType.ROAD ||
          (prevTile !== null && prevTile.type === TileType.ROAD)
        ) {
          powerInvalidated = true;
          waterInvalidated = true;
        }
      }
      if (rec.removedBuilding !== null) {
        removedBuildingIds.push(rec.removedBuilding.id);
        for (const coord of rec.removedBuilding.footprint) {
          affectedTiles.push(coord);
        }
      }
    }
  }
  if (landValueInvalidated) {
    world.markLandValueDirty();
  }
  if (removedBuildingIds.length > 0) {
    world.markDemandDirty();
  }
  // Post-apply recompute: if any command dirtied power, mark + drain immediately so the
  // next render frame sees a fresh snapshot even when the simulation is paused.
  if (powerInvalidated) {
    world.markPowerDirty();
    world.recomputePowerIfDirty();
  }
  // Same for water — tower placement/removal and road changes drain water independently of power.
  if (waterInvalidated) {
    world.markWaterDirty();
    world.recomputeWaterIfDirty();
  }
  return { changedTiles, affectedTiles, removedBuildingIds };
}

export function executeClick(
  tool: Tool,
  tile: TileCoord,
  world: World
): ToolResult {
  return applyCommands(buildToolCommands(tool, [tile], world, tile), world);
}

export function executeDrag(
  tool: Tool,
  start: TileCoord,
  end: TileCoord,
  world: World
): ToolResult {
  const tiles = pathForTool(tool, start, end).filter((t) =>
    world.getMap().getTile(t.x, t.y)
  );
  if (tiles.length === 0) {
    return { changedTiles: [], affectedTiles: [], removedBuildingIds: [] };
  }
  return applyCommands(buildToolCommands(tool, tiles, world, start), world);
}

export function previewDrag(
  tool: Tool,
  start: TileCoord,
  end: TileCoord,
  world: World
): ToolPreview {
  const tiles = pathForTool(tool, start, end).filter(
    (t) => world.getMap().getTile(t.x, t.y)
  );
  if (tiles.length === 0) {
    return { pathTiles: [], rejected: [], allOrNothingBlocked: false, affectedBuildingIds: new Set<number>() };
  }
  return buildToolPreview(tool, tiles, world);
}

/**
 * Pure hover preview for a single-tile click at `tile`.
 *
 * Returns the tool's target footprint (2×2 for POWER_PLANT and WATER_TOWER, 1×1 otherwise)
 * with rejection derived from the existing buildToolPreview classifier —
 * the whole footprint turns red when the classifier rejects the anchor.
 * Never mutates core; never calls buildToolCommands or applyCommands.
 */
export function previewClick(
  tool: Tool,
  tile: TileCoord,
  world: World
): ToolPreview {
  const empty: ToolPreview = { pathTiles: [], rejected: [], allOrNothingBlocked: false, affectedBuildingIds: new Set<number>() };

  // OOB tiles and SELECT produce no preview.
  if (world.getMap().getTile(tile.x, tile.y) === null) return empty;
  if (tool === Tool.SELECT) return empty;

  // A click has exactly one target tile, so pass the single hovered tile as
  // the tile list (vs a drag path which passes a multi-tile span).
  // buildToolPreview handles footprint expansion for BULLDOZE (structure cells),
  // so base.pathTiles is already the correct visual footprint for all tools
  // except POWER_PLANT / WATER_TOWER placement (which buildToolPreview returns
  // as [anchor] only — the 2×2 visual slab must be derived from structureFootprint).
  const base = buildToolPreview(tool, [tile], world);

  // Footprint: POWER_PLANT and WATER_TOWER use their 2×2 anchor-derived slab; everything else
  // (including BULLDOZE-over-structure which buildToolPreview already expanded)
  // uses base.pathTiles directly — no duplication of expansion logic.
  const footprint: TileCoord[] =
    tool === Tool.POWER_PLANT ? structureFootprint(tile, 'power_plant') :
    tool === Tool.WATER_TOWER ? structureFootprint(tile, 'water_tower') :
    base.pathTiles;

  // Whole footprint is red when the classifier signals any rejection.
  const rejected: TileCoord[] = base.rejected.length > 0 ? footprint : [];

  return {
    pathTiles: footprint,
    rejected,
    allOrNothingBlocked: base.allOrNothingBlocked,
    affectedBuildingIds: base.affectedBuildingIds,
  };
}
