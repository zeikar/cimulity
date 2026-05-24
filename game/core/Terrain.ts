import { slopeMaskFor, terrainShapeFor, TerrainShape } from "./terrainSlope";

export type HeightMode = "vertex-smooth";

export type BaseTerrain = "grass" | "water" | "sand" | "rock";

export interface TerrainData {
  width: number;
  height: number;
  mode: HeightMode;
  vertexHeights: number[][];
  baseTiles: BaseTerrain[][];
}

export type VertexWrite = {
  readonly vx: number;
  readonly vy: number;
  readonly height: number;
};

/** Vertical pixel lift per elevation unit in isometric projection. */
export const ELEVATION_HEIGHT = 12 as const;

/**
 * Maximum allowed terrain height level (inclusive).
 *
 * Change-impact surfaces:
 * - `MAX_TERRAIN_LIFT_PX` derivation: `MAX_ELEVATION * ELEVATION_HEIGHT` sets the
 *   worst-case vertical screen offset used for culling margin calculations.
 * - Picking candidate-scan loop range in `IsoTransform`: the loop must cover at
 *   most `MAX_ELEVATION` extra tile rows to account for elevated tiles occluding
 *   lower ones at the same screen position.
 * - `Terrain.fromData` range validation: incoming data must reject vertex heights
 *   outside `[0, MAX_ELEVATION]`.
 * - Any visual baseline screenshots that capture terrain height limits.
 */
export const MAX_ELEVATION = 8 as const;

/** Heights <= SEA_LEVEL are water. */
export const SEA_LEVEL = 0 as const;

/**
 * Lowest legal land height. Equals SEA_LEVEL + 1; declared as a literal (not a
 * computed expression) so the const-assertion preserves the literal type. The runtime
 * test in Terrain.test.ts asserts the relation.
 */
export const MIN_LAND_ELEVATION = 1 as const;

/**
 * Player-facing vertex slope cap. Player-driven terrain edits
 * (TERRAIN_UP / TERRAIN_DOWN) accept adjacent vertex deltas up to
 * MAX_PLAYER_SLOPE_DELTA (inclusive).
 */
export const MAX_PLAYER_SLOPE_DELTA = 3 as const;

/**
 * The 4 corner vertices of a tile (x, y) in canonical [top, right, bottom, left]
 * order. Pure; no bounds check.
 */
export function tileVertices(x: number, y: number): ReadonlyArray<readonly [number, number]> {
  return [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
}

/** The up to 4 in-bounds tiles touching vertex (vx, vy). */
export function tilesTouchingVertex(
  vx: number,
  vy: number,
  width: number,
  height: number
): ReadonlyArray<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  const candidates = [
    [vx - 1, vy - 1],
    [vx, vy - 1],
    [vx - 1, vy],
    [vx, vy],
  ] as const;
  for (const [tx, ty] of candidates) {
    if (tx >= 0 && ty >= 0 && tx < width && ty < height) out.push([tx, ty]);
  }
  return out;
}

export function projectTileHeightsToVertexHeights(tileHeights: number[][]): number[][] {
  const height = tileHeights.length;
  const width = tileHeights[0]?.length ?? 0;
  return Array.from({ length: height + 1 }, (_, vy) =>
    Array.from({ length: width + 1 }, (_, vx) => {
      let min: number = MAX_ELEVATION;
      let sawTile = false;
      for (const [tx, ty] of tilesTouchingVertex(vx, vy, width, height)) {
        const h = tileHeights[ty][tx];
        if (h < min) min = h;
        sawTile = true;
      }
      return sawTile ? min : MIN_LAND_ELEVATION;
    })
  );
}

export class Terrain {
  private readonly data: TerrainData;
  private onMutate: (() => void) | null = null;

  constructor(width: number, height: number) {
    const vertexHeights: number[][] = Array.from({ length: height + 1 }, () =>
      new Array<number>(width + 1).fill(MIN_LAND_ELEVATION)
    );
    const baseTiles: BaseTerrain[][] = Array.from({ length: height }, () =>
      new Array<BaseTerrain>(width).fill("grass")
    );

    this.data = {
      width,
      height,
      mode: "vertex-smooth",
      vertexHeights,
      baseTiles,
    };
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.data.width && y >= 0 && y < this.data.height;
  }

  private inVertexBounds(vx: number, vy: number): boolean {
    return vx >= 0 && vx <= this.data.width && vy >= 0 && vy <= this.data.height;
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

  getVertexHeight(vx: number, vy: number): number {
    if (!this.inVertexBounds(vx, vy)) return 0;
    return this.data.vertexHeights[vy][vx];
  }

  getTileCornerHeights(x: number, y: number): {
    topH: number;
    rightH: number;
    bottomH: number;
    leftH: number;
  } {
    if (!this.inBounds(x, y)) {
      return { topH: 0, rightH: 0, bottomH: 0, leftH: 0 };
    }
    return {
      topH: this.getVertexHeight(x, y),
      rightH: this.getVertexHeight(x + 1, y),
      bottomH: this.getVertexHeight(x + 1, y + 1),
      leftH: this.getVertexHeight(x, y + 1),
    };
  }

  /** Derived tile ceiling: max of the 4 corner vertices. OOB returns 0. */
  getTileElevation(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    const c = this.getTileCornerHeights(x, y);
    return Math.max(c.topH, c.rightH, c.bottomH, c.leftH);
  }

  /** Derived tile floor: min of the 4 corner vertices. OOB returns 0. */
  getTileMinCornerHeight(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    const c = this.getTileCornerHeights(x, y);
    return Math.min(c.topH, c.rightH, c.bottomH, c.leftH);
  }

  /** Render-height projection seam. Vertex-smooth mode uses the tile ceiling. */
  getRenderHeight(x: number, y: number): number {
    return this.getTileElevation(x, y);
  }

  canPlayerSetVertexHeight(vx: number, vy: number, newHeight: number): boolean {
    if (!this.inVertexBounds(vx, vy)) return false;
    if (!Number.isInteger(newHeight)) return false;
    if (newHeight < 0) return false;
    if (newHeight > MAX_ELEVATION) return false;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nvx = vx + dx;
        const nvy = vy + dy;
        if (!this.inVertexBounds(nvx, nvy)) continue;
        const neighborHeight = this.data.vertexHeights[nvy][nvx];
        if (Math.abs(neighborHeight - newHeight) > MAX_PLAYER_SLOPE_DELTA) return false;
      }
    }

    return true;
  }

  setPlayerVertexHeight(vx: number, vy: number, newHeight: number): boolean {
    if (!this.canPlayerSetVertexHeight(vx, vy, newHeight)) return false;
    this.data.vertexHeights[vy][vx] = newHeight;
    this.onMutate?.();
    return true;
  }

  /**
   * Dev / save-load / procedural-install only. Bypasses the 8-vertex-neighbor
   * cap; still enforces in-bounds, integer, and [0, MAX_ELEVATION].
   */
  unsafeSetVertexHeight(vx: number, vy: number, newHeight: number): boolean {
    if (!this.inVertexBounds(vx, vy)) return false;
    if (!Number.isInteger(newHeight)) return false;
    if (newHeight < 0) return false;
    if (newHeight > MAX_ELEVATION) return false;
    this.data.vertexHeights[vy][vx] = newHeight;
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
   * v1 RESERVED SLOT: vertex-smooth mode only accepts "grass" — non-grass values
   * are rejected with a dev console.warn.
   */
  setBaseTerrain(x: number, y: number, base: BaseTerrain): boolean {
    if (!this.inBounds(x, y)) return false;
    if (base !== "grass") {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `Terrain.setBaseTerrain: v1 reserved slot — only "grass" accepted in vertex-smooth mode, got "${base}" at (${x},${y})`
        );
      }
      return false;
    }
    this.data.baseTiles[y][x] = base;
    this.onMutate?.();
    return true;
  }

  /**
   * Visual slope label. Uses derived tile ceilings and remains a render cue only;
   * player placement buildability is checked by the coplanar predicate; this mask is render-only.
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

  /** Returns "flat" for OOB; otherwise maps the visual slope mask to a named shape. */
  getTerrainShape(x: number, y: number): TerrainShape {
    if (!this.inBounds(x, y)) return "flat";
    return terrainShapeFor(this.getSlopeMask(x, y));
  }

  /**
   * Strict-flat predicate (internal): true iff all 4 corners are exactly equal, above sea
   * level, and the water predicate rejects nothing. Player buildability uses isCoplanarTile;
   * isFlatTile is retained for World.tick spawn and mapSerialization footprint validation.
   */
  isFlatTile(
    x: number,
    y: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    if (!this.inBounds(x, y)) return false;
    const c = this.getTileCornerHeights(x, y);
    const flat = c.topH === c.rightH && c.rightH === c.bottomH && c.bottomH === c.leftH;
    return flat && c.topH > SEA_LEVEL && !isWater(x, y);
  }

  /**
   * True iff the tile's four corners are coplanar (single plane), all above sea
   * level, and not water. A plane is defined by 3 points; the 4th is coplanar
   * iff topH + bottomH === leftH + rightH (opposite-corner sums match).
   */
  isCoplanarTile(
    x: number,
    y: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    if (!this.inBounds(x, y)) return false;
    const c = this.getTileCornerHeights(x, y);
    return c.topH + c.bottomH === c.leftH + c.rightH && Math.min(c.topH, c.rightH, c.bottomH, c.leftH) > SEA_LEVEL && !isWater(x, y);
  }

  /**
   * True iff every tile in the w×h footprint is coplanar (single plane), all
   * corners above sea level, and the water predicate rejects no cell.
   */
  isCoplanarArea(
    x: number,
    y: number,
    w: number,
    h: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    if (
      !this.inBounds(x, y) ||
      !this.inBounds(x + w - 1, y + h - 1)
    ) return false;
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        if (!this.isCoplanarTile(cx, cy, isWater)) return false;
      }
    }
    return true;
  }

  /**
   * True iff the rect is in-bounds, every vertex spanning the rect shares one
   * height above sea level, and the water predicate rejects no cell.
   */
  isFlatArea(
    x: number,
    y: number,
    w: number,
    h: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    if (
      !this.inBounds(x, y) ||
      !this.inBounds(x + w - 1, y + h - 1)
    ) return false;

    const h0 = this.getVertexHeight(x, y);
    if (h0 <= SEA_LEVEL) return false;
    for (let vy = y; vy <= y + h; vy++) {
      for (let vx = x; vx <= x + w; vx++) {
        if (this.getVertexHeight(vx, vy) !== h0) return false;
      }
    }
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        if (isWater(cx, cy)) return false;
      }
    }
    return true;
  }

  /** True iff every tile in the w×h footprint is coplanar (single plane), all corners above sea level, and the water predicate rejects no cell. */
  canBuildAt(
    x: number,
    y: number,
    w: number,
    h: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    return this.isCoplanarArea(x, y, w, h, isWater);
  }

  /** True iff the tile is coplanar (single plane), all corners above sea level, and not water. */
  canBuildRoadAt(
    x: number,
    y: number,
    isWater: (x: number, y: number) => boolean
  ): boolean {
    return this.isCoplanarTile(x, y, isWater);
  }

  /** Emit a v8 serializable DTO. */
  toJSON(): TerrainData {
    return {
      width: this.data.width,
      height: this.data.height,
      mode: "vertex-smooth",
      vertexHeights: this.data.vertexHeights.map((row) => [...row]),
      baseTiles: this.data.baseTiles.map((row) => [...row]),
    };
  }

  static fromData(dto: unknown): Terrain {
    if (dto === null || typeof dto !== "object" || Array.isArray(dto)) {
      throw new Error("Terrain.fromData: dto must be a non-null object");
    }

    const d = dto as Record<string, unknown>;
    if (!Number.isInteger(d["width"]) || (d["width"] as number) <= 0) {
      throw new Error("Terrain.fromData: width must be a positive integer");
    }
    const width = d["width"] as number;

    if (!Number.isInteger(d["height"]) || (d["height"] as number) <= 0) {
      throw new Error("Terrain.fromData: height must be a positive integer");
    }
    const height = d["height"] as number;

    if (d["mode"] !== "vertex-smooth") {
      throw new Error("Terrain.fromData: only mode 'vertex-smooth' is supported in v8");
    }
    if ("tileElevations" in d) {
      throw new Error("Terrain.fromData: tileElevations is not valid in vertex-smooth mode");
    }
    if ("waterLevel" in d) {
      throw new Error("Terrain.fromData: waterLevel is reserved; must be absent");
    }

    if (!Array.isArray(d["vertexHeights"])) {
      throw new Error("Terrain.fromData: vertexHeights must be an array");
    }
    const rawVertices = d["vertexHeights"] as unknown[];
    if (rawVertices.length !== height + 1) {
      throw new Error(
        `Terrain.fromData: vertexHeights.length (${rawVertices.length}) !== height + 1 (${height + 1})`
      );
    }
    const clonedVertices: number[][] = [];
    for (let vy = 0; vy <= height; vy++) {
      const row = rawVertices[vy];
      if (!Array.isArray(row) || (row as unknown[]).length !== width + 1) {
        throw new Error(
          `Terrain.fromData: vertexHeights[${vy}] must be an array of length ${width + 1}`
        );
      }
      const clonedRow: number[] = [];
      for (let vx = 0; vx <= width; vx++) {
        const v = (row as unknown[])[vx];
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_ELEVATION) {
          throw new Error(
            `Terrain.fromData: invalid vertex height at (${vx},${vy}): ${String(v)}`
          );
        }
        clonedRow.push(v as number);
      }
      clonedVertices.push(clonedRow);
    }

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
            `Terrain.fromData: v8 vertex-smooth requires all baseTiles to be 'grass' — got ${String(v)} at (${x},${y})`
          );
        }
        clonedRow.push("grass");
      }
      clonedBase.push(clonedRow);
    }

    const t = new Terrain(width, height);
    (t as unknown as { data: TerrainData }).data.vertexHeights = clonedVertices;
    (t as unknown as { data: TerrainData }).data.baseTiles = clonedBase;
    return t;
  }
}
