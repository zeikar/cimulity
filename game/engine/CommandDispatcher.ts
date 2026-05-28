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
import { buildToolCommands, buildToolPreview } from '../tools';
import { ROAD_COST, ZONE_COST, BULLDOZE_COST, POWER_PLANT_COST } from '../core/World';
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
      // Drag collapses to a single-click at start — the NW anchor.
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
 * Power is recomputed at the end of `applyCommands` whenever any command
 * dirtied it, so the next render frame always reads a fresh snapshot — even
 * when the simulation is paused. Tick-path `recomputePowerIfDirty` remains
 * as defense-in-depth.
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
      // Build the 4-cell footprint from the NW anchor.
      const footprint = [
        { x: cmd.x,     y: cmd.y     },
        { x: cmd.x + 1, y: cmd.y     },
        { x: cmd.x,     y: cmd.y + 1 },
        { x: cmd.x + 1, y: cmd.y + 1 },
      ];
      // Invariant: classifyPowerPlant passed, so addStructure must succeed.
      const structure = world.getStructureMap().addStructure({
        type: cmd.structureType,
        footprint,
        anchor: { x: cmd.x, y: cmd.y },
      });
      // This branch should never fire: addStructure returned null despite classifyPowerPlant passing.
      // This can only happen if two place-structure commands overlap (the tool layer never produces that).
      if (structure === null) {
        throw new Error('invariant: addStructure returned null after classifyPowerPlant passed');
      }
      for (const { x: cx, y: cy } of footprint) {
        const rec = map.setTileAndReconcile(cx, cy, createTile(cx, cy, TileType.POWER_PLANT));
        pushChanged(cx, cy);
        // Defensively handle any removed building (classifier should have prevented this).
        if (rec.removedBuilding !== null) {
          removedBuildingIds.push(rec.removedBuilding.id);
          for (const coord of rec.removedBuilding.footprint) {
            affectedTiles.push(coord);
          }
        }
      }
      powerInvalidated = true;
    } else if (cmd.kind === 'remove-structure') {
      const s = world.getStructureMap().getStructure(cmd.structureId);
      // Invariant: tool layer dedupes by id; a stale id cannot reach applyCommands through normal flow.
      if (s === null) {
        throw new Error('invariant: remove-structure references a missing structureId');
      }
      for (const { x: cx, y: cy } of s.footprint) {
        map.setTileAndReconcile(cx, cy, createTile(cx, cy, TileType.DIRT));
        pushChanged(cx, cy);
      }
      world.getStructureMap().removeStructure(s.id);
      powerInvalidated = true;
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
        // Mark power dirty when a ROAD tile is placed or a ROAD tile is replaced.
        if (
          !powerInvalidated &&
          (cmd.tile.type === TileType.ROAD ||
            (prevTile !== null && prevTile.type === TileType.ROAD))
        ) {
          powerInvalidated = true;
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
