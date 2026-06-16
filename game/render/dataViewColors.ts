/**
 * Pure color-mapping utilities for the data-view overlay. No Pixi, no React.
 *
 * Provides two 3-stop color ramps (congestion and employment) and a helper
 * that buckets per-building employment shares from commute-flow data, so the
 * render overlay can recolor tiles without any core mutation.
 */

import type { GameMap } from '@/game/core/Map';
import type { BuildingMap } from '@/game/core/Building';
import { accessNodeFor } from '@/game/core/roadGraph';
import {
  JOBS_PER_LEVEL,
  WORKERS_PER_LEVEL,
  type CommuteFlow,
} from '@/game/core/laborMarket';

// ---------------------------------------------------------------------------
// Ramp palette — exported so legend components can reference the same stops.
// ---------------------------------------------------------------------------

export const RAMP_GREEN = 0x2ecc40;
export const RAMP_YELLOW = 0xffdc00;
export const RAMP_RED = 0xff4136;
/** Color returned when a tile has no applicable data (e.g. no road access). */
export const NO_DATA_COLOR = 0x777777;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Clamp `v` to [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Extract an 8-bit channel from a packed 0xRRGGBB integer.
 * channel: 0=R, 1=G, 2=B
 */
function channelByte(color: number, channel: 0 | 1 | 2): number {
  return (color >> (16 - channel * 8)) & 0xff;
}

/**
 * Integer-channel linear interpolation between two 0xRRGGBB colors.
 * t must be in [0, 1].
 */
function lerpColor(colorA: number, colorB: number, t: number): number {
  const r = Math.round(channelByte(colorA, 0) + (channelByte(colorB, 0) - channelByte(colorA, 0)) * t);
  const g = Math.round(channelByte(colorA, 1) + (channelByte(colorB, 1) - channelByte(colorA, 1)) * t);
  const b = Math.round(channelByte(colorA, 2) + (channelByte(colorB, 2) - channelByte(colorA, 2)) * t);
  return (r << 16) | (g << 8) | b;
}

// ---------------------------------------------------------------------------
// Public color-mapping functions
// ---------------------------------------------------------------------------

/**
 * Map a raw traffic congestion value [0, 255] to a GREEN → YELLOW → RED ramp.
 * Values outside [0, 255] are clamped.
 */
export function congestionColor(v: number): number {
  const clamped = clamp(v, 0, 255);
  const t = clamped / 255;
  // First half: GREEN → YELLOW; second half: YELLOW → RED.
  if (t < 0.5) {
    return lerpColor(RAMP_GREEN, RAMP_YELLOW, t * 2);
  }
  return lerpColor(RAMP_YELLOW, RAMP_RED, (t - 0.5) * 2);
}

/**
 * Map an employment share [0, 1] to a RED → YELLOW → GREEN ramp.
 * share 0 = fully unemployed (bad), share 1 = fully employed (good).
 * Values outside [0, 1] are clamped.
 */
export function employmentColor(share: number): number {
  const clamped = clamp(share, 0, 1);
  // Reverse ramp: RED (bad, low share) → YELLOW → GREEN (good, full share).
  if (clamped < 0.5) {
    return lerpColor(RAMP_RED, RAMP_YELLOW, clamped * 2);
  }
  return lerpColor(RAMP_YELLOW, RAMP_GREEN, (clamped - 0.5) * 2);
}

// ---------------------------------------------------------------------------
// Per-building employment share bucketing
// ---------------------------------------------------------------------------

export interface BuildingEmploymentEntry {
  /** Employment share in [0, 1]: matched / total capacity. */
  share: number;
  /**
   * True when the building has a road-access node AND a non-zero
   * capacity/worker count, meaning the share is meaningful data.
   */
  hasData: boolean;
}

/**
 * Compute a per-building employment share from commute-flow data.
 *
 * Returns a Map keyed by building id. Residential buildings show how many of
 * their workers are employed (matched origin workers / total workers).
 * Commercial/industrial buildings show fill rate (matched dest workers /
 * total capacity).
 *
 * Abandoned buildings and road-less buildings always get `{ share: 0,
 * hasData: false }`.
 *
 * Mirror iteration / abandon-skip from laborMarket.ts:103-123.
 */
export function buildingEmploymentShares(
  map: GameMap,
  buildings: BuildingMap,
  flows: ReadonlyArray<CommuteFlow>,
): Map<number, BuildingEmploymentEntry> {
  // Per-node totals: how many workers originate at each node,
  // and how much capacity each destination node provides.
  const totalWorkersByNode = new Map<number, number>();
  const totalCapByNode = new Map<number, number>();

  for (const b of buildings.iterBuildings()) {
    if (b.abandoned) continue;

    if (b.type === 'commercial' || b.type === 'industrial') {
      const cap = b.level * JOBS_PER_LEVEL;
      const node = accessNodeFor(map, b);
      if (node >= 0) totalCapByNode.set(node, (totalCapByNode.get(node) ?? 0) + cap);
      continue;
    }

    if (b.type === 'residential') {
      const workers = b.level * WORKERS_PER_LEVEL;
      const node = accessNodeFor(map, b);
      if (node >= 0) totalWorkersByNode.set(node, (totalWorkersByNode.get(node) ?? 0) + workers);
    }
  }

  // Sum matched workers per origin node and per dest node from flow data.
  const matchedOriginByNode = new Map<number, number>();
  const matchedDestByNode = new Map<number, number>();
  for (const flow of flows) {
    matchedOriginByNode.set(
      flow.originNode,
      (matchedOriginByNode.get(flow.originNode) ?? 0) + flow.count,
    );
    matchedDestByNode.set(
      flow.destNode,
      (matchedDestByNode.get(flow.destNode) ?? 0) + flow.count,
    );
  }

  // Build per-building result.
  const result = new Map<number, BuildingEmploymentEntry>();

  for (const b of buildings.iterBuildings()) {
    if (b.abandoned) {
      result.set(b.id, { share: 0, hasData: false });
      continue;
    }

    const node = accessNodeFor(map, b);

    if (b.type === 'residential') {
      const totalWorkers = (node >= 0 ? totalWorkersByNode.get(node) : undefined) ?? 0;
      const hasData = node >= 0 && totalWorkers > 0;
      if (!hasData) {
        result.set(b.id, { share: 0, hasData: false });
      } else {
        const matched = matchedOriginByNode.get(node) ?? 0;
        result.set(b.id, { share: matched / totalWorkers, hasData: true });
      }
      continue;
    }

    if (b.type === 'commercial' || b.type === 'industrial') {
      const totalCap = (node >= 0 ? totalCapByNode.get(node) : undefined) ?? 0;
      const hasData = node >= 0 && totalCap > 0;
      if (!hasData) {
        result.set(b.id, { share: 0, hasData: false });
      } else {
        const matched = matchedDestByNode.get(node) ?? 0;
        result.set(b.id, { share: matched / totalCap, hasData: true });
      }
    }
  }

  return result;
}
