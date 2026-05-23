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

/** Elevations <= SEA_LEVEL are water. */
export const SEA_LEVEL = 0 as const;

/**
 * Lowest legal land elevation. Equals SEA_LEVEL + 1; declared as a literal (not a
 * computed expression) so the const-assertion preserves the literal type. The runtime
 * test in Terrain.test.ts asserts the relation.
 */
export const MIN_LAND_ELEVATION = 1 as const;

/**
 * Player-facing slope cap. Player-driven terrain edits (TERRAIN_UP / TERRAIN_DOWN)
 * accept adjacent-neighbor deltas up to MAX_PLAYER_SLOPE_DELTA (inclusive). The
 * stricter delta-1 rule in `canSetElevation` still applies to direct
 * `Terrain.setElevation` callers (currently none in production — dispatcher
 * routes through `setPlayerElevation` after Task 2).
 */
export const MAX_PLAYER_SLOPE_DELTA = 3 as const;

export class Terrain {
  private readonly data: TerrainData;
  private onMutate: (() => void) | null = null;

  constructor(width: number, height: number) {
    const tileElevations: number[][] = Array.from({ length: height }, () =>
      new Array<number>(width).fill(MIN_LAND_ELEVATION)
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

  /**
   * Like canSetElevation but uses MAX_PLAYER_SLOPE_DELTA for the 8-neighbor
   * delta cap. Called by player-facing tools (TERRAIN_UP / TERRAIN_DOWN); the
   * data-layer canSetElevation remains delta-1.
   */
  canPlayerSetElevation(x: number, y: number, newElevation: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (!Number.isInteger(newElevation)) return false;
    if (newElevation < 0) return false;
    if (newElevation > MAX_ELEVATION) return false;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const neighborElevation = this.data.tileElevations[ny][nx];
        if (Math.abs(neighborElevation - newElevation) > MAX_PLAYER_SLOPE_DELTA) return false;
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
   * Player-facing elevation write. Mirrors setElevation but uses
   * canPlayerSetElevation (delta-3 cap). Fires onMutate on accept; returns
   * false (no-op) on reject. Called from CommandDispatcher.applyCommands for
   * elevation commands emitted by TERRAIN_UP / TERRAIN_DOWN.
   */
  setPlayerElevation(x: number, y: number, newElevation: number): boolean {
    if (!this.canPlayerSetElevation(x, y, newElevation)) return false;
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

  /** Emit a serializable DTO. In tile-step mode strictly omits vertexHeights and waterLevel (reserved fields). */
  toJSON(): TerrainData {
    return {
      width: this.data.width,
      height: this.data.height,
      mode: this.data.mode,
      tileElevations: this.data.tileElevations.map((row) => [...row]),
      baseTiles: this.data.baseTiles.map((row) => [...row]),
    };
  }

  /**
   * Validate a raw DTO and construct a Terrain instance.
   * Throws descriptively on any invalid field.
   * The returned instance has NO onMutate wired — the caller (installTerrain) wires it.
   *
   * After validation, arrays are cloned and assigned directly into the new instance's
   * private data to avoid the per-cell cost of unsafeSetElevation.
   */
  static fromData(dto: unknown): Terrain {
    if (dto === null || typeof dto !== "object" || Array.isArray(dto)) {
      throw new Error("Terrain.fromData: dto must be a non-null object");
    }

    const d = dto as Record<string, unknown>;

    // width
    if (!Number.isInteger(d["width"]) || (d["width"] as number) <= 0) {
      throw new Error("Terrain.fromData: width must be a positive integer");
    }
    const width = d["width"] as number;

    // height
    if (!Number.isInteger(d["height"]) || (d["height"] as number) <= 0) {
      throw new Error("Terrain.fromData: height must be a positive integer");
    }
    const height = d["height"] as number;

    // mode
    if (d["mode"] !== "tile-step") {
      throw new Error("Terrain.fromData: only mode 'tile-step' is supported in v1");
    }

    // reserved fields must be absent
    if ("vertexHeights" in d) {
      throw new Error(
        "Terrain.fromData: vertexHeights is reserved for vertex-smooth mode; must be absent in tile-step"
      );
    }
    if ("waterLevel" in d) {
      throw new Error(
        "Terrain.fromData: waterLevel is reserved for future modes; must be absent in tile-step"
      );
    }

    // tileElevations
    if (!Array.isArray(d["tileElevations"])) {
      throw new Error("Terrain.fromData: tileElevations must be an array");
    }
    const rawElev = d["tileElevations"] as unknown[];
    if (rawElev.length !== height) {
      throw new Error(
        `Terrain.fromData: tileElevations.length (${rawElev.length}) !== height (${height})`
      );
    }
    const clonedElevations: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row = rawElev[y];
      if (!Array.isArray(row) || (row as unknown[]).length !== width) {
        throw new Error(
          `Terrain.fromData: tileElevations[${y}] must be an array of length ${width}`
        );
      }
      const clonedRow: number[] = [];
      for (let x = 0; x < width; x++) {
        const v = (row as unknown[])[x];
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_ELEVATION) {
          throw new Error(
            `Terrain.fromData: invalid elevation at (${x},${y}): ${String(v)}`
          );
        }
        clonedRow.push(v as number);
      }
      clonedElevations.push(clonedRow);
    }

    // baseTiles
    if (!Array.isArray(d["baseTiles"])) {
      throw new Error("Terrain.fromData: baseTiles must be an array");
    }
    const rawBase = d["baseTiles"] as unknown[];
    if (rawBase.length !== height) {
      throw new Error(
        `Terrain.fromData: baseTiles.length (${rawBase.length}) !== height (${height})`
      );
    }
    const clonedBase: BaseTerrain[][] = [];
    for (let y = 0; y < height; y++) {
      const row = rawBase[y];
      if (!Array.isArray(row) || (row as unknown[]).length !== width) {
        throw new Error(
          `Terrain.fromData: baseTiles[${y}] must be an array of length ${width}`
        );
      }
      const clonedRow: BaseTerrain[] = [];
      for (let x = 0; x < width; x++) {
        const v = (row as unknown[])[x];
        if (v !== "grass") {
          throw new Error(
            `Terrain.fromData: v1 tile-step requires all baseTiles to be 'grass' — got ${String(v)} at (${x},${y})`
          );
        }
        clonedRow.push("grass");
      }
      clonedBase.push(clonedRow);
    }

    // Construct + direct-assign (bypass per-cell unsafeSetElevation cost).
    // `t.data` is private readonly, but readonly only prevents field reassignment —
    // mutating properties of data is fine via a cast.
    const t = new Terrain(width, height);
    (t as unknown as { data: TerrainData }).data.tileElevations = clonedElevations;
    (t as unknown as { data: TerrainData }).data.baseTiles = clonedBase;
    return t;
  }
}
