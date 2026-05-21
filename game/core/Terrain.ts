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
}
