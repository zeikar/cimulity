/**
 * Graded service-coverage map for fire coverage — stores intensity (0..255),
 * NOT a binary bit. Recomputed on demand via `propagateServiceCoverage`; NOT
 * persisted (transient, like PowerMap/WaterMap).
 *
 * CLONEABLE FAMILY NOTE:
 *   This class is the SECOND of the service-coverage family, which now has
 *   FOUR members: `ServiceCoverageMap` (police, first), `FireCoverageMap`
 *   (fire, second), `HospitalCoverageMap` (hospital, third — emergency trio),
 *   and `SchoolCoverageMap` (school, fourth — education). Hard-codes
 *   `'fire_station'` as the source type and reuses `propagateServiceCoverage`
 *   plus the shared threshold constant `SERVICE_COVERAGE_THRESHOLD_RAW` —
 *   exactly how WaterMap clones PowerMap for `'water_tower'`.
 *
 * ANCHOR-vs-FOOTPRINT GATE RATIONALE:
 *   Binary fields (power, water) gate buildings by scanning the full footprint
 *   — any powered/watered footprint cell satisfies the gate — because the
 *   binary field marks individual cells reachable from the utility network.
 *   Graded fields (coverage, land value) are a continuous intensity surface;
 *   the gate question is "does this location have enough service?", answered
 *   at the building's anchor point. See `isFireAnchorCovered` below.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import { TileType } from './Tile';
import { propagateServiceCoverage } from './serviceCoveragePropagation';
import { SERVICE_COVERAGE_THRESHOLD_RAW } from './ServiceCoverageMap';

export class FireCoverageMap {
  private readonly width: number;
  private readonly height: number;
  private readonly coverage: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.coverage = new Uint8Array(width * height);
  }

  recompute(map: GameMap, structures: StructureMap): void {
    const result = propagateServiceCoverage(
      map,
      structures,
      (t) => t === TileType.ROAD,
      (s) => s.type === 'fire_station',
    );
    this.coverage.set(result);
  }

  /** Raw coverage intensity at (x, y), range 0..255. Returns 0 for OOB coords. */
  getCoverage(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return this.coverage[y * this.width + x];
  }

  /** Normalized coverage at (x, y), range [0, 1]. Intended for the inspector UI. */
  getCoverageNormalized(x: number, y: number): number {
    return this.getCoverage(x, y) / 255;
  }

  /** Returns the backing Uint8Array directly (by reference). */
  getRaw(): Uint8Array {
    return this.coverage;
  }

  clear(): void {
    this.coverage.fill(0);
  }
}

/**
 * Returns true if the anchor cell has raw coverage >= SERVICE_COVERAGE_THRESHOLD_RAW.
 *
 * Graded fields (coverage, land value) gate at the ANCHOR — a single point
 * representing "where does this building live in the service field?" Binary
 * fields (power, water) scan the full footprint because any powered/watered
 * cell satisfies the gate. This is the intended split between the two families.
 */
export function isFireAnchorCovered(
  anchor: { x: number; y: number },
  fireSvc: FireCoverageMap,
): boolean {
  return fireSvc.getCoverage(anchor.x, anchor.y) >= SERVICE_COVERAGE_THRESHOLD_RAW;
}
