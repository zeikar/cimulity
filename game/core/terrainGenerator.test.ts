import { describe, it, expect } from 'vitest';
import { generateTerrain, DEFAULT_NEWCITY_SEED } from './terrainGenerator';
import { Terrain, MAX_ELEVATION } from './Terrain';

describe('generateTerrain', () => {
  it('(a) determinism — same seed produces identical output', () => {
    const r1 = generateTerrain(16, 16, 7);
    const r2 = generateTerrain(16, 16, 7);
    expect(r1).toEqual(r2);
  });

  it('(b) Terrain.fromData compatibility — elevations are valid integers in [0, MAX_ELEVATION]', () => {
    const { elevations, waterMask } = generateTerrain(8, 8, 1);
    for (const row of elevations) {
      for (const v of row) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(MAX_ELEVATION);
      }
    }
    void waterMask;
    const baseTiles = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => 'grass' as const),
    );
    expect(() =>
      Terrain.fromData({
        width: 8,
        height: 8,
        mode: 'tile-step',
        tileElevations: elevations,
        baseTiles,
      }),
    ).not.toThrow();
  });

  it('(c) shape parity — waterMask and elevations dimensions match W and H', () => {
    const W = 10;
    const H = 7;
    const { elevations, waterMask } = generateTerrain(W, H, 42);
    expect(elevations.length).toBe(H);
    expect(waterMask.length).toBe(H);
    for (let y = 0; y < H; y++) {
      expect(elevations[y].length).toBe(W);
      expect(waterMask[y].length).toBe(W);
    }
  });

  it('(d) pinned regression — generateTerrain(4, 4, 1) exact snapshot', () => {
    const { elevations, waterMask } = generateTerrain(4, 4, 1);
    expect(elevations).toEqual([
      [3, 2, 1, 1],
      [3, 2, 1, 1],
      [3, 3, 2, 1],
      [3, 3, 2, 1],
    ]);
    expect(waterMask).toEqual([
      [false, false, true, false],
      [false, false, false, false],
      [false, false, false, false],
      [false, false, false, false],
    ]);
  });

  it('(e) statistical sanity at 64×64 default seed', () => {
    const { elevations, waterMask } = generateTerrain(64, 64, DEFAULT_NEWCITY_SEED);
    const flat = elevations.flat();
    const le2Count = flat.filter((v) => v <= 2).length;
    expect(le2Count / flat.length).toBeGreaterThanOrEqual(0.60);

    const waterCount = waterMask.flat().filter(Boolean).length;
    expect(waterCount).toBe(Math.floor(64 * 64 * 0.12));
  });

  it('(f) input validation — throws RangeError for invalid dimensions', () => {
    expect(() => generateTerrain(0, 8, 0)).toThrow(RangeError);
    expect(() => generateTerrain(8, 0, 0)).toThrow(RangeError);
    expect(() => generateTerrain(1.5, 8, 0)).toThrow(RangeError);
  });
});

describe('generateTerrain buildability acceptance (64×64 default seed)', () => {
  const W = 64;
  const H = 64;
  const { elevations, waterMask } = generateTerrain(W, H, DEFAULT_NEWCITY_SEED);
  const baseTiles = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => 'grass' as const),
  );
  const terrain = Terrain.fromData({
    width: W,
    height: H,
    mode: 'tile-step',
    tileElevations: elevations,
    baseTiles,
  });
  const isWater = (x: number, y: number) => waterMask[y][x];

  it('(g) buildable-1×1 count >= 40% of tiles', () => {
    let count = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (terrain.canBuildAt(x, y, 1, 1, isWater)) count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(Math.floor(0.40 * W * H));
  });

  it('(h) buildable-2×2 count >= 10% of tiles', () => {
    let count = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (terrain.canBuildAt(x, y, 2, 2, isWater)) count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(Math.floor(0.10 * W * H));
  });

  it('(i) connectivity — largest buildable-flat-non-water region >= 100 tiles', () => {
    const isMember = (x: number, y: number) => terrain.canBuildAt(x, y, 1, 1, isWater);
    const visited = new Set<number>();
    let maxRegion = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!isMember(x, y)) continue;
        const key = y * W + x;
        if (visited.has(key)) continue;
        // BFS inline to track visited across regions
        const localVisited = new Set<number>();
        const q: [number, number][] = [[x, y]];
        localVisited.add(key);
        let sz = 0;
        while (q.length) {
          const [cx, cy] = q.shift()!;
          sz++;
          for (const [dx, dy] of [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ] as const) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const k2 = ny * W + nx;
            if (localVisited.has(k2)) continue;
            if (!isMember(nx, ny)) continue;
            localVisited.add(k2);
            q.push([nx, ny]);
          }
        }
        localVisited.forEach((k) => visited.add(k));
        if (sz > maxRegion) maxRegion = sz;
      }
    }

    expect(maxRegion).toBeGreaterThanOrEqual(100);
  });
});
