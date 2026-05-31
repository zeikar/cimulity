/**
 * Graded service-coverage map for police coverage — stores intensity (0..255),
 * NOT a binary bit. Recomputed on demand via `propagateServiceCoverage`; NOT
 * persisted (transient, like PowerMap/WaterMap).
 *
 * CLONEABLE FAMILY NOTE:
 *   This class is the first of a deferred cloneable service family. Future
 *   fire and hospital coverage maps will each be sibling classes (e.g.
 *   `FireCoverageMap`, `HospitalCoverageMap`) that hard-code their own source
 *   type (`'fire_station'`, `'hospital'`) and reuse `propagateServiceCoverage`
 *   — NOT one generic class with a runtime source-predicate parameter. That
 *   cloning pattern matches how PowerMap and WaterMap each hard-code their
 *   own source type. Fire and hospital are NOT built here.
 *
 * ANCHOR-vs-FOOTPRINT GATE RATIONALE:
 *   Binary fields (power, water) gate buildings by scanning the full footprint
 *   — any powered/watered footprint cell satisfies the gate — because the
 *   binary field marks individual cells reachable from the utility network.
 *   Graded fields (coverage, land value) are a continuous intensity surface;
 *   the gate question is "does this location have enough service?", answered
 *   at the building's anchor point. See `isAnchorCovered` below.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import { TileType } from './Tile';
import { propagateServiceCoverage } from './serviceCoveragePropagation';

/** Normalized coverage fraction below which a zone is considered uncovered. */
export const SERVICE_COVERAGE_THRESHOLD = 0.25;

/**
 * Integer equivalent of SERVICE_COVERAGE_THRESHOLD in the 0..255 raw scale.
 * Math.round(0.25 * 255) = Math.round(63.75) = 64.
 */
export const SERVICE_COVERAGE_THRESHOLD_RAW = Math.round(SERVICE_COVERAGE_THRESHOLD * 255);

export class ServiceCoverageMap {
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
      (s) => s.type === 'police_station',
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
export function isAnchorCovered(
  anchor: { x: number; y: number },
  svc: ServiceCoverageMap,
): boolean {
  return svc.getCoverage(anchor.x, anchor.y) >= SERVICE_COVERAGE_THRESHOLD_RAW;
}
