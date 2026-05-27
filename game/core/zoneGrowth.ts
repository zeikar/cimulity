import type { World } from './World';
import type { Building } from './Building';
import { TileType } from './Tile';
import type { Frontage, Rect } from './buildingFootprint';
import { lotBboxOf } from './buildingFootprint';

export function depthAxisFromFrontage(frontage: Frontage): { dx: number; dy: number } {
  switch (frontage) {
    case 'N': return { dx: 0, dy: 1 };
    case 'S': return { dx: 0, dy: -1 };
    case 'W': return { dx: 1, dy: 0 };
    case 'E': return { dx: -1, dy: 0 };
  }
}

export function pickSeedFrontage(seed: { x: number; y: number }, world: World): Frontage | null {
  const map = world.getMap();
  // Check distances 1..4, tie-break order S > E > W > N at each distance.
  const directions: Array<{ dir: Frontage; dx: number; dy: number }> = [
    { dir: 'S', dx: 0, dy: 1 },
    { dir: 'E', dx: 1, dy: 0 },
    { dir: 'W', dx: -1, dy: 0 },
    { dir: 'N', dx: 0, dy: -1 },
  ];
  for (let k = 1; k <= 4; k++) {
    for (const { dir, dx, dy } of directions) {
      const nx = seed.x + dx * k;
      const ny = seed.y + dy * k;
      const tile = map.getTile(nx, ny);
      if (tile !== null && tile.type === TileType.ROAD) return dir;
    }
  }
  return null;
}

export function countRoadsOnFace(rect: Rect, frontage: Frontage, world: World): number {
  const map = world.getMap();
  let count = 0;
  switch (frontage) {
    case 'N':
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const t = map.getTile(x, rect.y - 1);
        if (t !== null && t.type === TileType.ROAD) count++;
      }
      break;
    case 'S':
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const t = map.getTile(x, rect.y + rect.h);
        if (t !== null && t.type === TileType.ROAD) count++;
      }
      break;
    case 'W':
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        const t = map.getTile(rect.x - 1, y);
        if (t !== null && t.type === TileType.ROAD) count++;
      }
      break;
    case 'E':
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        const t = map.getTile(rect.x + rect.w, y);
        if (t !== null && t.type === TileType.ROAD) count++;
      }
      break;
  }
  return count;
}

export function greedyDepthLot(
  seed: { x: number; y: number },
  frontage: Frontage,
  seedTileType: TileType,
  world: World,
): Rect | null {
  const map = world.getMap();
  const terrain = world.getTerrain();
  const isWater = (x: number, y: number) => world.isWater(x, y);
  const { dx, dy } = depthAxisFromFrontage(frontage);
  const anchorHeight = terrain.getRenderHeight(seed.x, seed.y);

  const cells: Array<{ x: number; y: number }> = [{ x: seed.x, y: seed.y }];

  for (let step = 1; step < 4; step++) {
    const nx = seed.x + dx * step;
    const ny = seed.y + dy * step;
    const tile = map.getTile(nx, ny);
    if (tile === null) break;
    if (tile.type !== seedTileType) break;
    if (map.getBuildings().getBuildingAt(nx, ny) !== null) break;
    if (terrain.getRenderHeight(nx, ny) !== anchorHeight) break;
    if (!terrain.isFlatTile(nx, ny, isWater)) break;
    cells.push({ x: nx, y: ny });
  }

  const rect = lotBboxOf(cells);

  if (!validateFootprintRect(rect, seedTileType, world)) return null;

  // Chosen-frontage validation: the chosen frontage face must actually touch a road.
  if (countRoadsOnFace(rect, frontage, world) === 0) return null;

  return rect;
}

export function initialStructureRect(lot: Rect, frontage: Frontage): Rect {
  switch (frontage) {
    case 'N': return { x: lot.x, y: lot.y, w: lot.w, h: 1 };
    case 'S': return { x: lot.x, y: lot.y + lot.h - 1, w: lot.w, h: 1 };
    case 'W': return { x: lot.x, y: lot.y, w: 1, h: lot.h };
    case 'E': return { x: lot.x + lot.w - 1, y: lot.y, w: 1, h: lot.h };
  }
}

export function structureRectFillsLotDepth(sr: Rect, lot: Rect, frontage: Frontage): boolean {
  if (frontage === 'N' || frontage === 'S') return sr.h === lot.h;
  return sr.w === lot.w;
}

export function extendStructureToward(structureRect: Rect, lot: Rect, frontage: Frontage): Rect | null {
  if (structureRectFillsLotDepth(structureRect, lot, frontage)) return null;
  const sr = structureRect;
  switch (frontage) {
    case 'N': return { x: sr.x, y: sr.y, w: sr.w, h: sr.h + 1 };
    case 'S': return { x: sr.x, y: sr.y - 1, w: sr.w, h: sr.h + 1 };
    case 'W': return { x: sr.x, y: sr.y, w: sr.w + 1, h: sr.h };
    case 'E': return { x: sr.x - 1, y: sr.y, w: sr.w + 1, h: sr.h };
  }
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
 * Returns true iff the building's stored frontage face still touches a road.
 * Use this for growth/merge gates — not the generic any-side check.
 */
export function hasFrontageRoadAccess(building: Building, world: World): boolean {
  return countRoadsOnFace(lotBboxOf(building.footprint), building.frontage, world) > 0;
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
