import { slopeMaskFor, terrainShapeFor, TerrainShape } from "./terrainSlope";

export type HeightMode = "tile-step" | "vertex-smooth";

export type BaseTerrain = "grass" | "water" | "sand" | "rock";

export interface TerrainData {
  width: number;
  height: number;
  mode: HeightMode;
  tileElevations: number[][];
  baseTiles: BaseTerrain[][];
  vertexHeights?: number[][];
  waterLevel?: number;
}

/** Vertical pixel lift per elevation unit in isometric projection. */
export const ELEVATION_HEIGHT = 12 as const;

/**
 * Maximum allowed tile elevation level (inclusive).
 *
 * Change-impact surfaces:
 * - `MAX_TERRAIN_LIFT_PX` derivation: `MAX_ELEVATION * ELEVATION_HEIGHT` sets the
 *   worst-case vertical screen offset used for culling margin calculations.
 * - Picking candidate-scan loop range in `IsoTransform`: the loop must cover at
 *   most `MAX_ELEVATION` extra tile rows to account for elevated tiles occluding
 *   lower ones at the same screen position.
 * - `Terrain.fromData` range validation: incoming data must reject elevations
 *   outside `[0, MAX_ELEVATION]`.
 * - Picking tests: test fixtures that probe boundary elevations must stay within
 *   this limit.
 * - Any visual baseline screenshots that capture terrain height limits.
 */
export const MAX_ELEVATION = 8 as const;

export class Terrain {
  private readonly data: TerrainData;
  private onMutate: (() => void) | null = null;

  constructor(width: number, height: number) {
    const tileElevations: number[][] = Array.from({ length: height }, () =>
      new Array<number>(width).fill(0)
    );
    const baseTiles: BaseTerrain[][] = Array.from({ length: height }, () =>
      new Array<BaseTerrain>(width).fill("grass")
    );

    this.data = {
      width,
      height,
      mode: "tile-step",
      tileElevations,
      baseTiles,
    };
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.data.width && y >= 0 && y < this.data.height;
  }

  getWidth(): number {
    return this.data.width;
  }

  getHeight(): number {
    return this.data.height;
  }

  getMode(): HeightMode {
    return this.data.mode;
  }

  getTileElevation(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.data.tileElevations[y][x];
  }

  /**
   * Render-height projection seam. In tile-step mode this equals getTileElevation;
   * vertex-smooth mode will average corner heights.
   */
  getRenderHeight(x: number, y: number): number {
    return this.getTileElevation(x, y);
  }

  canSetElevation(x: number, y: number, newElevation: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (!Number.isInteger(newElevation)) return false;
    if (newElevation < 0) return false;
    if (newElevation > MAX_ELEVATION) return false;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        // OOB neighbors are skipped — not treated as 0
        if (!this.inBounds(nx, ny)) continue;
        const neighborElevation = this.data.tileElevations[ny][nx];
        if (Math.abs(neighborElevation - newElevation) > 1) return false;
      }
    }

    return true;
  }

  setElevation(x: number, y: number, newElevation: number): boolean {
    if (!this.canSetElevation(x, y, newElevation)) return false;
    this.data.tileElevations[y][x] = newElevation;
    this.onMutate?.();
    return true;
  }

  /**
   * Dev-only / save-load only. Cliffs are legal data; the editor cannot reach
   * them via setElevation. Used by devApi.seedScene and Terrain.fromData internals.
   */
  unsafeSetElevation(x: number, y: number, newElevation: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (!Number.isInteger(newElevation)) return false;
    if (newElevation < 0) return false;
    if (newElevation > MAX_ELEVATION) return false;
    this.data.tileElevations[y][x] = newElevation;
    this.onMutate?.();
    return true;
  }

  setOnMutate(cb: (() => void) | null): void {
    this.onMutate = cb;
  }

  getBaseTerrain(x: number, y: number): BaseTerrain {
    if (!this.inBounds(x, y)) return "grass";
    return this.data.baseTiles[y][x];
  }

  /**
   * v1 RESERVED SLOT: tile-step mode only accepts "grass" — non-grass values are
   * rejected with a dev console.warn. baseTiles becomes authoritative in a future
   * round (v7 save migration).
   */
  setBaseTerrain(x: number, y: number, base: BaseTerrain): boolean {
    if (!this.inBounds(x, y)) return false;
    if (base !== "grass") {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `Terrain.setBaseTerrain: v1 reserved slot — only "grass" accepted in tile-step mode, got "${base}" at (${x},${y})`
        );
      }
      return false;
    }
    this.data.baseTiles[y][x] = base;
    this.onMutate?.();
    return true;
  }

  /** v1 placeholder. Real implementation lands when sea-level / flooding simulation arrives. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isBelowWaterLevel(x: number, y: number): boolean {
    return false;
  }

  /**
   * Returns a bitmask of which orthogonal neighbors are lower than this tile.
   * OOB center returns 0. OOB neighbors are treated as equal to center (bit unset).
   */
  getSlopeMask(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    const center = this.getTileElevation(x, y);
    const n = this.inBounds(x, y - 1) ? this.getTileElevation(x, y - 1) : center;
    const e = this.inBounds(x + 1, y) ? this.getTileElevation(x + 1, y) : center;
    const s = this.inBounds(x, y + 1) ? this.getTileElevation(x, y + 1) : center;
    const w = this.inBounds(x - 1, y) ? this.getTileElevation(x - 1, y) : center;
    return slopeMaskFor(center, n, e, s, w);
  }

  /** Returns "flat" for OOB; otherwise maps the slope mask to a named shape. */
  getTerrainShape(x: number, y: number): TerrainShape {
    if (!this.inBounds(x, y)) return "flat";
    return terrainShapeFor(this.getSlopeMask(x, y));
  }

  /**
   * A tile is flat/buildable iff it is in-bounds, has slope mask 0,
   * and the injected water predicate returns false.
   */
  isFlatTile(
    x: number,
    y: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    return this.inBounds(x, y) && this.getSlopeMask(x, y) === 0 && !isWater(x, y);
  }

  /**
   * True iff the entire w×h rect is in-bounds, all cells share the same elevation,
   * and every cell passes isFlatTile (catches edge cells whose lower neighbor sits
   * outside the rect).
   */
  isFlatArea(
    x: number,
    y: number,
    w: number,
    h: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    // Rect must be fully in-bounds
    if (
      !this.inBounds(x, y) ||
      !this.inBounds(x + w - 1, y + h - 1)
    ) return false;

    const e0 = this.getTileElevation(x, y);
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        if (this.getTileElevation(cx, cy) !== e0) return false;
        if (!this.isFlatTile(cx, cy, isWater)) return false;
      }
    }
    return true;
  }

  /**
   * V1: a w×h footprint is buildable iff the area is uniformly flat.
   * Exists so future slope-build rules can be added without breaking callers.
   */
  canBuildAt(
    x: number,
    y: number,
    w: number,
    h: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    return this.isFlatArea(x, y, w, h, isWater);
  }

  /** V1: a road tile is buildable iff the single tile is flat. */
  canBuildRoadAt(
    x: number,
    y: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    return this.isFlatTile(x, y, isWater);
  }
}
