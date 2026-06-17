import { describe, it, expect } from 'vitest';
import {
  RAMP_GREEN,
  RAMP_YELLOW,
  RAMP_RED,
  NO_DATA_COLOR,
  congestionColor,
  employmentColor,
  buildingEmploymentShares,
} from './dataViewColors';
import { GameMap } from '@/game/core/Map';
import { BuildingMap, type BuildingType } from '@/game/core/Building';
import { TileType, createTile } from '@/game/core/Tile';
import type { Frontage } from '@/game/core/buildingFootprint';
import type { CommuteFlow } from '@/game/core/laborMarket';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addBuilding(
  bm: BuildingMap,
  x: number,
  y: number,
  type: BuildingType,
  frontage: Frontage,
  opts: { level?: number; abandoned?: boolean } = {},
) {
  return bm.addBuilding({
    type,
    level: opts.level ?? 1,
    density: 0,
    age: 0,
    abandoned: opts.abandoned ?? false,
    frontage,
    footprint: [{ x, y }],
    anchor: { x, y },
    structureRect: { x, y, w: 1, h: 1 },
  });
}

const idxOf = (w: number, x: number, y: number) => y * w + x;

// ---------------------------------------------------------------------------
// Exported palette constants
// ---------------------------------------------------------------------------

describe('palette constants', () => {
  const red = (c: number) => (c >> 16) & 0xff;
  const green = (c: number) => (c >> 8) & 0xff;
  const blue = (c: number) => c & 0xff;

  // Assert the SEMANTIC properties the ramps rely on, not the literal hex —
  // a hue tweak should not break these unless it inverts the ramp meaning.
  it('RAMP_GREEN is green-dominant, RAMP_RED is red-dominant', () => {
    expect(green(RAMP_GREEN)).toBeGreaterThan(red(RAMP_GREEN));
    expect(red(RAMP_RED)).toBeGreaterThan(green(RAMP_RED));
  });

  it('RAMP_YELLOW has strong red AND green (the ramp midpoint)', () => {
    expect(red(RAMP_YELLOW)).toBeGreaterThan(0x80);
    expect(green(RAMP_YELLOW)).toBeGreaterThan(0x80);
  });

  it('NO_DATA_COLOR is a neutral grey (channels roughly equal)', () => {
    expect(Math.abs(red(NO_DATA_COLOR) - green(NO_DATA_COLOR))).toBeLessThanOrEqual(8);
    expect(Math.abs(green(NO_DATA_COLOR) - blue(NO_DATA_COLOR))).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// congestionColor
// ---------------------------------------------------------------------------

describe('congestionColor', () => {
  it('returns RAMP_GREEN at 0', () => {
    expect(congestionColor(0)).toBe(RAMP_GREEN);
  });

  it('returns RAMP_RED at 255', () => {
    expect(congestionColor(255)).toBe(RAMP_RED);
  });

  it('returns approximately RAMP_YELLOW at midpoint 127.5', () => {
    // At v=128, t≈0.502, just past the midpoint → interpolating YELLOW→RED
    // starting with t_inner ≈ 0.004; the result should be very close to yellow.
    const mid = congestionColor(128);
    // Extract channels of RAMP_YELLOW for comparison tolerance.
    const yR = (RAMP_YELLOW >> 16) & 0xff; // 0xff
    const yG = (RAMP_YELLOW >> 8) & 0xff;  // 0xdc
    const yB = RAMP_YELLOW & 0xff;          // 0x00
    const mR = (mid >> 16) & 0xff;
    const mG = (mid >> 8) & 0xff;
    const mB = mid & 0xff;
    // Allow ±6 per channel (the nudge is < 1% into the YELLOW→RED range).
    expect(Math.abs(mR - yR)).toBeLessThanOrEqual(6);
    expect(Math.abs(mG - yG)).toBeLessThanOrEqual(6);
    expect(Math.abs(mB - yB)).toBeLessThanOrEqual(6);
  });

  it('red channel increases monotonically from 0→255', () => {
    let prevR = -1;
    for (let v = 0; v <= 255; v += 5) {
      const r = (congestionColor(v) >> 16) & 0xff;
      expect(r).toBeGreaterThanOrEqual(prevR);
      prevR = r;
    }
  });

  it('clamps values below 0', () => {
    expect(congestionColor(-10)).toBe(congestionColor(0));
  });

  it('clamps values above 255', () => {
    expect(congestionColor(300)).toBe(congestionColor(255));
  });
});

// ---------------------------------------------------------------------------
// employmentColor
// ---------------------------------------------------------------------------

describe('employmentColor', () => {
  it('returns RAMP_RED at share 0 (bad: no employment)', () => {
    expect(employmentColor(0)).toBe(RAMP_RED);
  });

  it('returns RAMP_GREEN at share 1 (good: fully employed)', () => {
    expect(employmentColor(1)).toBe(RAMP_GREEN);
  });

  it('returns approximately RAMP_YELLOW at share 0.5', () => {
    expect(employmentColor(0.5)).toBe(RAMP_YELLOW);
  });

  it('clamps below 0', () => {
    expect(employmentColor(-0.5)).toBe(employmentColor(0));
  });

  it('clamps above 1', () => {
    expect(employmentColor(1.5)).toBe(employmentColor(1));
  });
});

// ---------------------------------------------------------------------------
// buildingEmploymentShares
// ---------------------------------------------------------------------------

describe('buildingEmploymentShares', () => {
  // Grid layout (width=10, height=5):
  //   row 0: R at (1,0) frontage S → access node (1,1)
  //          C at (5,0) frontage S → access node (5,1)
  //   row 1: ROAD cells at x=1..5
  //   row 2: abandoned R at (3,2) — no road on row 3
  //   row 3: (nothing)
  //   row 4: R at (7,4) — no road on row 5, which is out-of-bounds → node=-1

  const W = 10;

  function makeFixture() {
    const map = new GameMap(W, 6);
    // Road row 1: x=1..5
    for (let x = 1; x <= 5; x++) {
      map.setTile(x, 1, createTile(x, 1, TileType.ROAD));
    }
    const bm = new BuildingMap(W, 6);
    // Residential at (1,0) → access (1,1)
    const res = addBuilding(bm, 1, 0, 'residential', 'S', { level: 2 });
    // Commercial at (5,0) → access (5,1), level 2 → capacity 2
    const com = addBuilding(bm, 5, 0, 'commercial', 'S', { level: 2 });
    // Abandoned residential at (3,0) → access (3,1), but abandoned
    const aband = addBuilding(bm, 3, 0, 'residential', 'S', { abandoned: true });
    // Road-less residential: place at (8,0) frontage S → would need (8,1) road, not present
    const noRoad = addBuilding(bm, 8, 0, 'residential', 'S', { level: 1 });
    return { map, bm, res, com, aband, noRoad };
  }

  it('fully employed residential: share 1, hasData true', () => {
    const { map, bm, res } = makeFixture();
    // 2 workers from node (1,1), both matched.
    const flows: CommuteFlow[] = [
      { originNode: idxOf(W, 1, 1), destNode: idxOf(W, 5, 1), count: 2 },
    ];
    const result = buildingEmploymentShares(map, bm, flows);
    const entry = result.get(res!.id);
    expect(entry).toBeDefined();
    expect(entry!.hasData).toBe(true);
    expect(entry!.share).toBe(1);
  });

  it('half-filled C/I dest: share 0.5, hasData true', () => {
    const { map, bm, com } = makeFixture();
    // Commercial has capacity 2; only 1 worker matched.
    const flows: CommuteFlow[] = [
      { originNode: idxOf(W, 1, 1), destNode: idxOf(W, 5, 1), count: 1 },
    ];
    const result = buildingEmploymentShares(map, bm, flows);
    const entry = result.get(com!.id);
    expect(entry).toBeDefined();
    expect(entry!.hasData).toBe(true);
    expect(entry!.share).toBe(0.5);
  });

  it('abandoned building: share 0, hasData false', () => {
    const { map, bm, aband } = makeFixture();
    const flows: CommuteFlow[] = [];
    const result = buildingEmploymentShares(map, bm, flows);
    const entry = result.get(aband!.id);
    expect(entry).toBeDefined();
    expect(entry!.hasData).toBe(false);
    expect(entry!.share).toBe(0);
  });

  it('road-less building with workers: share 0, hasData true (fully unemployed, not "no data")', () => {
    const { map, bm, noRoad } = makeFixture();
    const flows: CommuteFlow[] = [];
    const result = buildingEmploymentShares(map, bm, flows);
    const entry = result.get(noRoad!.id);
    expect(entry).toBeDefined();
    // Road-less but has workers → real failure data (red), not grey "no data".
    expect(entry!.hasData).toBe(true);
    expect(entry!.share).toBe(0);
  });

  it('no flows: residential with road access gets share 0, hasData true (has workers)', () => {
    const { map, bm, res } = makeFixture();
    const flows: CommuteFlow[] = [];
    const result = buildingEmploymentShares(map, bm, flows);
    const entry = result.get(res!.id);
    expect(entry).toBeDefined();
    expect(entry!.hasData).toBe(true);
    expect(entry!.share).toBe(0);
  });

  it('no flows: C/I with road access gets share 0, hasData true (has capacity)', () => {
    const { map, bm, com } = makeFixture();
    const flows: CommuteFlow[] = [];
    const result = buildingEmploymentShares(map, bm, flows);
    const entry = result.get(com!.id);
    expect(entry).toBeDefined();
    expect(entry!.hasData).toBe(true);
    expect(entry!.share).toBe(0);
  });
});
