/**
 * Derived per-road-tile traffic congestion (0..255). Recomputed via
 * `assignTraffic`; NOT persisted (transient, like the coverage maps).
 * DATA-ONLY — no render, no sim feedback.
 *
 * Mirrors the coverage-map holder pattern (`FireCoverageMap`, etc.) with one
 * extra argument on `recompute`: `buildings` (a `BuildingMap`), which
 * `assignTraffic` needs to enumerate residential origins and job destinations.
 * The coverage holders only need `(map, structures)`.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { BuildingMap } from './Building';
import { assignTraffic } from './trafficAssignment';

export class TrafficMap {
  private readonly width: number;
  private readonly height: number;
  private readonly congestion: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.congestion = new Uint8Array(width * height);
  }

  /**
   * Recompute congestion from the current map state.
   *
   * Unlike the coverage-map holders, this takes an extra `buildings` arg
   * because `assignTraffic` enumerates both residential origins
   * (`BuildingMap`) and job destinations — coverage maps only need
   * `(map, structures)`.
   */
  recompute(map: GameMap, structures: StructureMap, buildings: BuildingMap): void {
    this.congestion.set(assignTraffic(map, structures, buildings));
  }

  /** Raw congestion intensity at (x, y), range 0..255. Returns 0 for OOB coords. */
  getCongestion(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return this.congestion[y * this.width + x];
  }

  /** Normalized congestion at (x, y), range [0, 1]. Intended for the inspector UI. */
  getCongestionNormalized(x: number, y: number): number {
    return this.getCongestion(x, y) / 255;
  }

  /** Returns the backing Uint8Array directly (by reference). */
  getRaw(): Uint8Array {
    return this.congestion;
  }

  clear(): void {
    this.congestion.fill(0);
  }
}
