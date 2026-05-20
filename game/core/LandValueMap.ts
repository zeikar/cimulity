/**
 * Derived influence field: land value per tile.
 * NOT persisted — recomputed from the map on demand.
 *
 * Two-stage influence:
 *   Stage 1: road proximity  (Chebyshev distance within radius 6, normalised).
 *   Stage 2: zone-mix diversity (distinct zone types in 3×3, divided by 3).
 *   Final:   clamp(0.7 * road + 0.3 * diversity, 0, 1).
 */

import type { GameMap } from './Map';
import type { BuildingMap } from './Building';
import { TileType, isZoneType } from './Tile';

const ROAD_RADIUS = 6;

export class LandValueMap {
  private readonly width: number;
  private readonly height: number;
  private readonly values: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.values = new Float32Array(width * height);
  }

  /**
   * Recompute the entire influence field from the current map state.
   * Pure: no side-effects beyond writing to this.values.
   */
  recompute(map: GameMap, _buildings: BuildingMap): void {
    const w = this.width;
    const h = this.height;

    // Stage 1: road proximity score per tile.
    // For each tile, find Chebyshev distance to nearest ROAD within radius 6.
    // adjacent (dist=1) → score=1.0, radius edge (dist=6) → score ~0.167,
    // same tile (dist=0) → tile IS a road, score=1.0.
    // normalise: score = 1 - (dist / (ROAD_RADIUS + 1)); clamped to [0,1].
    const roadScores = new Float32Array(w * h);

    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        let minDist = Infinity;

        const r0 = Math.max(0, ty - ROAD_RADIUS);
        const r1 = Math.min(h - 1, ty + ROAD_RADIUS);
        const c0 = Math.max(0, tx - ROAD_RADIUS);
        const c1 = Math.min(w - 1, tx + ROAD_RADIUS);

        for (let ny = r0; ny <= r1; ny++) {
          for (let nx = c0; nx <= c1; nx++) {
            const tile = map.getTile(nx, ny);
            if (tile !== null && tile.type === TileType.ROAD) {
              const chebyshev = Math.max(Math.abs(nx - tx), Math.abs(ny - ty));
              if (chebyshev < minDist) minDist = chebyshev;
            }
          }
        }

        let score = 0;
        if (minDist !== Infinity) {
          // dist=0 (road tile itself) → 1 - 0/(6+1) = 1.0
          // dist=6 → 1 - 6/7 ≈ 0.143
          score = Math.max(0, 1 - minDist / (ROAD_RADIUS + 1));
        }
        roadScores[ty * w + tx] = score;
      }
    }

    // Stage 2: zone-mix diversity score per tile.
    // Count distinct zone types within 3×3 neighbourhood, divide by 3.
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const seen = new Set<TileType>();

        for (let ny = Math.max(0, ty - 1); ny <= Math.min(h - 1, ty + 1); ny++) {
          for (let nx = Math.max(0, tx - 1); nx <= Math.min(w - 1, tx + 1); nx++) {
            const tile = map.getTile(nx, ny);
            if (tile !== null && isZoneType(tile.type)) {
              seen.add(tile.type);
            }
          }
        }

        const diversityScore = Math.min(1, seen.size / 3);
        const roadScore = roadScores[ty * w + tx];
        const combined = Math.min(1, Math.max(0, 0.7 * roadScore + 0.3 * diversityScore));
        this.values[ty * w + tx] = combined;
      }
    }
  }

  /**
   * Returns the land value at (x, y) in [0, 1].
   * Returns 0 for out-of-bounds coordinates.
   */
  getValue(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return this.values[y * this.width + x];
  }

  /**
   * Raw backing array — exposed for tests and debug tooling.
   * Do not mutate.
   */
  getRaw(): Float32Array {
    return this.values;
  }
}
