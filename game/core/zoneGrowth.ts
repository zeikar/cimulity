import type { World } from './World';
import type { Building } from './Building';
import { TileType } from './Tile';
import type { Frontage, Rect } from './buildingFootprint';

export type SpawnSize = { w: number; h: number };

export type SpawnFootprint = { rect: Rect; frontage: Frontage };

/** T1 implementation: always 1×1. */
export function pickSpawnSize(_x: number, _y: number, _world: World): SpawnSize {
  return { w: 1, h: 1 };
}

/**
 * Every in-bounds W×H rect containing the seed tile.
 * Pure geometry — no world access.
 */
export function enumerateFootprintsContaining(
  seed: { x: number; y: number },
  w: number,
  h: number,
  mapW: number,
  mapH: number,
): Rect[] {
  const rects: Rect[] = [];
  // The NW corner of a W×H rect containing seed.x can range from
  // seed.x - (w-1) to seed.x (so that seed.x <= rectX + w - 1).
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const rx = seed.x - dx;
      const ry = seed.y - dy;
      // Clip: rect must fit within [0, mapW) × [0, mapH)
      if (rx < 0 || ry < 0) continue;
      if (rx + w > mapW || ry + h > mapH) continue;
      rects.push({ x: rx, y: ry, w, h });
    }
  }
  return rects;
}

/**
 * Count road-adjacent perimeter cells per side (N, S, E, W).
 * "Road-adjacent" means the orthogonal neighbor outside the rect on that side
 * is a ROAD tile. Out-of-bounds counts as not a road.
 */
function countRoadsByFace(rect: Rect, world: World): { N: number; S: number; E: number; W: number } {
  const map = world.getMap();
  let N = 0, S = 0, E = 0, W = 0;

  // N side: row y = rect.y-1, x from rect.x to rect.x+w-1
  for (let x = rect.x; x < rect.x + rect.w; x++) {
    const t = map.getTile(x, rect.y - 1);
    if (t !== null && t.type === TileType.ROAD) N++;
  }

  // S side: row y = rect.y+h, x from rect.x to rect.x+w-1
  for (let x = rect.x; x < rect.x + rect.w; x++) {
    const t = map.getTile(x, rect.y + rect.h);
    if (t !== null && t.type === TileType.ROAD) S++;
  }

  // W side: col x = rect.x-1, y from rect.y to rect.y+h-1
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const t = map.getTile(rect.x - 1, y);
    if (t !== null && t.type === TileType.ROAD) W++;
  }

  // E side: col x = rect.x+w, y from rect.y to rect.y+h-1
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const t = map.getTile(rect.x + rect.w, y);
    if (t !== null && t.type === TileType.ROAD) E++;
  }

  return { N, S, E, W };
}

/**
 * Returns the side with the most road-adjacent perimeter cells.
 * Tie-break: S > E > W > N. Returns null when no perimeter cell touches a road.
 */
export function pickFrontage(rect: Rect, world: World): Frontage | null {
  const counts = countRoadsByFace(rect, world);
  const max = Math.max(counts.N, counts.S, counts.E, counts.W);
  if (max === 0) return null;

  // Tie-break order: S, E, W, N
  if (counts.S === max) return 'S';
  if (counts.E === max) return 'E';
  if (counts.W === max) return 'W';
  return 'N';
}

/**
 * Returns true iff the rect is a valid footprint candidate:
 * - w and h each in {1..4} (defense in depth)
 * - every cell in-bounds
 * - every cell's tile type matches seedTileType
 * - every cell unowned (no building)
 * - every cell is flat (terrain.isFlatTile)
 * - every cell shares the same getRenderHeight as rect.x, rect.y
 * - at least one road-adjacent perimeter cell (pickFrontage non-null)
 */
export function validateFootprintRect(
  rect: Rect,
  seedTileType: TileType,
  world: World,
): boolean {
  if (rect.w < 1 || rect.w > 4 || rect.h < 1 || rect.h > 4) return false;

  const map = world.getMap();
  const terrain = world.getTerrain();
  const isWater = (x: number, y: number) => world.isWater(x, y);

  const anchorHeight = terrain.getRenderHeight(rect.x, rect.y);

  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const tile = map.getTile(x, y);
      if (tile === null) return false;
      if (tile.type !== seedTileType) return false;
      if (map.getBuildings().getBuildingAt(x, y) !== null) return false;
      if (!terrain.isFlatTile(x, y, isWater)) return false;
      if (terrain.getRenderHeight(x, y) !== anchorHeight) return false;
    }
  }

  return pickFrontage(rect, world) !== null;
}

/**
 * Convenience wrapper: returns true iff the building's footprint has at least
 * one road-adjacent perimeter cell. Assumes a canonical footprint (Task 4 invariant).
 */
export function hasRoadAccess(building: Building, world: World): boolean {
  let minX = building.footprint[0].x;
  let minY = building.footprint[0].y;
  let maxX = building.footprint[0].x;
  let maxY = building.footprint[0].y;

  for (const c of building.footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  const rect: Rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  return pickFrontage(rect, world) !== null;
}

/**
 * Expand a rect to a cell list in row-major order (y-major, x-minor).
 */
export function footprintCells(rect: Rect): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      cells.push({ x, y });
    }
  }
  return cells;
}
