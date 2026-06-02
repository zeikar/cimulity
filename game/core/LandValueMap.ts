/**
 * Derived influence field: land value per tile.
 * NOT persisted — recomputed from the map on demand.
 *
 * FOUR inputs feed a sum-to-1.0 base, PLUS a park additive boost, all clamped to [0,1]:
 *   - road proximity    (weight 0.40, Chebyshev distance within radius 6, normalised).
 *   - zone-mix diversity (weight 0.10, distinct zone types in 3×3, divided by 3).
 *   - service coverage   (weight 0.50, the AVERAGE of the four services' normalized
 *                         coverage — police, fire, hospital, school).
 *   - park proximity     (additive +PARK_BOOST_MAX = 0.25, Chebyshev distance to nearest
 *                         park within radius 4, nearest-park strongest-wins).
 *   Final: clamp(0.40 * road + 0.10 * diversity + 0.50 * service + 0.25 * park, 0, 1).
 *   The park term is additive and ≥0.
 *
 * DUAL ROLE OF SERVICES: the four coverage services hard-gate level-up at the building
 * anchor in World (all four must be covered), AND contribute to land value here via the
 * combined serviceScore term.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { ServiceCoverageMap } from './ServiceCoverageMap';
import type { FireCoverageMap } from './FireCoverageMap';
import type { HospitalCoverageMap } from './HospitalCoverageMap';
import type { SchoolCoverageMap } from './SchoolCoverageMap';
import { TileType, isZoneType } from './Tile';

const ROAD_RADIUS = 6;
const PARK_RADIUS = 4;     // tunable
const PARK_BOOST_MAX = 0.25; // tunable
const ROAD_WEIGHT = 0.40;      // tunable
const DIVERSITY_WEIGHT = 0.10; // tunable
const SERVICE_WEIGHT = 0.50;   // tunable

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
  recompute(
    map: GameMap,
    structures: StructureMap,
    coverage: {
      police: ServiceCoverageMap;
      fire: FireCoverageMap;
      hospital: HospitalCoverageMap;
      school: SchoolCoverageMap;
    },
  ): void {
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

    // Stage 3: park-proximity — gather all park footprint cells once.
    // For each tile, Chebyshev distance to nearest park cell within PARK_RADIUS
    // determines the boost: dist=0 → 1.0, dist=PARK_RADIUS → ~0.2, beyond → 0.
    // parkScore = minDist === Infinity ? 0 : max(0, 1 - minDist / (PARK_RADIUS + 1)).
    const parkCells: { x: number; y: number }[] = [];
    for (const s of structures.iterStructures()) {
      if (s.type === 'park') {
        for (const cell of s.footprint) {
          parkCells.push({ x: cell.x, y: cell.y });
        }
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

        // Stage 3: nearest-park Chebyshev boost (bounding-box scan per tile).
        let parkScore = 0;
        if (parkCells.length > 0) {
          let minDist = Infinity;

          const r0 = Math.max(0, ty - PARK_RADIUS);
          const r1 = Math.min(h - 1, ty + PARK_RADIUS);
          const c0 = Math.max(0, tx - PARK_RADIUS);
          const c1 = Math.min(w - 1, tx + PARK_RADIUS);

          for (const pc of parkCells) {
            if (pc.y >= r0 && pc.y <= r1 && pc.x >= c0 && pc.x <= c1) {
              const chebyshev = Math.max(Math.abs(pc.x - tx), Math.abs(pc.y - ty));
              if (chebyshev < minDist) minDist = chebyshev;
            }
          }

          parkScore = minDist === Infinity ? 0 : Math.max(0, 1 - minDist / (PARK_RADIUS + 1));
        }

        const serviceScore =
          (coverage.police.getCoverageNormalized(tx, ty) +
            coverage.fire.getCoverageNormalized(tx, ty) +
            coverage.hospital.getCoverageNormalized(tx, ty) +
            coverage.school.getCoverageNormalized(tx, ty)) /
          4;

        const combined = Math.min(1, Math.max(0, ROAD_WEIGHT * roadScore + DIVERSITY_WEIGHT * diversityScore + SERVICE_WEIGHT * serviceScore + PARK_BOOST_MAX * parkScore));
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
