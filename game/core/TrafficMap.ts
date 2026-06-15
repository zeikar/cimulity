/**
 * Derived per-road-tile traffic congestion (0..255). Recomputed via
 * `assignTraffic`; NOT persisted (transient, like the coverage maps).
 * DATA-ONLY — no render, no sim feedback.
 *
 * Mirrors the coverage-map holder pattern (`FireCoverageMap`, etc.) with one
 * extra argument on `recompute`: `flows` (precomputed commute O-D flows), which
 * `assignTraffic` loads along their shortest road paths. The coverage holders
 * only need `(map, structures)`.
 */

import type { GameMap } from './Map';
import type { StructureMap } from './StructureMap';
import type { CommuteFlow } from './laborMarket';
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
   * Recompute congestion from the current map state and precomputed flows.
   *
   * Unlike the coverage-map holders, this takes an extra `flows` arg
   * because `assignTraffic` loads precomputed commute O-D flows along their
   * shortest road paths — coverage maps only need `(map, structures)`.
   */
  recompute(map: GameMap, structures: StructureMap, flows: ReadonlyArray<CommuteFlow>): void {
    this.congestion.set(assignTraffic(map, structures, flows));
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
