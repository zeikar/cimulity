/**
 * Binary reachability. Roads are the only conductors. Plants are SOURCES only —
 * they do NOT conduct, and their footprint cells are never marked powered. A road
 * cell is powered iff there exists at least one plant whose footprint has a cell
 * orthogonally adjacent to that road cell AND the road cell is connected to such
 * a seed road cell via a chain of orthogonal road-to-road steps. A non-road cell
 * is powered iff it is orthogonally adjacent to some powered road cell AND it is
 * not inside any structure footprint. Numeric capacity is a planned follow-up; the
 * public API `isPowered(x, y): boolean` keeps room for internal repr to swap later.
 * Not persisted — recomputed on demand.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import { TileType } from './Tile';

const ORTHOGONAL = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

export class PowerMap {
  private readonly width: number;
  private readonly height: number;
  private readonly powered: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.powered = new Uint8Array(width * height);
  }

  recompute(map: GameMap, structures: StructureMap): void {
    const w = this.width;
    const h = this.height;

    this.powered.fill(0);

    // Mark every cell owned by a structure footprint.
    const structureOwned = new Uint8Array(w * h);
    for (const s of structures.iterStructures()) {
      for (const c of s.footprint) {
        structureOwned[c.y * w + c.x] = 1;
      }
    }

    // BFS: seed from road cells orthogonally adjacent to any structure footprint cell.
    const visitedRoad = new Uint8Array(w * h);
    const queue: number[] = [];

    for (const s of structures.iterStructures()) {
      for (const c of s.footprint) {
        for (const { dx, dy } of ORTHOGONAL) {
          const nx = c.x + dx;
          const ny = c.y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (visitedRoad[nIdx] === 1) continue;
          if (map.getTile(nx, ny)?.type !== TileType.ROAD) continue;
          visitedRoad[nIdx] = 1;
          queue.push(nIdx);
        }
      }
    }

    // BFS expansion: road-to-road.
    let qHead = 0;
    while (qHead < queue.length) {
      const idx = queue[qHead++];
      const cx = idx % w;
      const cy = (idx - cx) / w;

      for (const { dx, dy } of ORTHOGONAL) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (visitedRoad[nIdx] === 1) continue;
        if (map.getTile(nx, ny)?.type !== TileType.ROAD) continue;
        visitedRoad[nIdx] = 1;
        queue.push(nIdx);
      }
    }

    // Mark all visited road cells as powered.
    for (let i = 0; i < visitedRoad.length; i++) {
      if (visitedRoad[i] === 1) this.powered[i] = 1;
    }

    // Adjacency sweep: power the non-structure neighbors of powered road cells.
    for (let i = 0; i < visitedRoad.length; i++) {
      if (visitedRoad[i] !== 1) continue;
      const cx = i % w;
      const cy = (i - cx) / w;

      for (const { dx, dy } of ORTHOGONAL) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (structureOwned[nIdx] === 1) continue;
        this.powered[nIdx] = 1;
      }
    }
  }

  isPowered(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.powered[y * this.width + x] === 1;
  }

  clear(): void {
    this.powered.fill(0);
  }

  getRaw(): Uint8Array {
    return this.powered;
  }
}

/**
 * Single canonical predicate. A building is powered iff any of its footprint cells
 * is powered. Anchor is NW and not always road-facing (S/E frontage can sit deeper),
 * so the footprint scan is the authoritative check. Reused by `World.tick` growth
 * gates and by `PowerStatusOverlay`.
 */
export function isBuildingPowered(
  building: { footprint: ReadonlyArray<{ x: number; y: number }> },
  power: PowerMap,
): boolean {
  for (const c of building.footprint) {
    if (power.isPowered(c.x, c.y)) return true;
  }
  return false;
}
