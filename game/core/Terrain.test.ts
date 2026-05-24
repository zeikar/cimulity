import { describe, it, expect, vi } from "vitest";
import {
  Terrain,
  MAX_ELEVATION,
  MAX_PLAYER_SLOPE_DELTA,
  MIN_LAND_ELEVATION,
  SEA_LEVEL,
  projectTileHeightsToVertexHeights,
  tileVertices,
  tilesTouchingVertex,
} from "./Terrain";

const noWater = () => false;

describe("Terrain vertex-smooth basics", () => {
  it("constructs a vertex-smooth terrain with an initialized (h+1)x(w+1) vertex grid", () => {
    const t = new Terrain(4, 3);
    expect(t.getWidth()).toBe(4);
    expect(t.getHeight()).toBe(3);
    expect(t.getMode()).toBe("vertex-smooth");
    for (let vy = 0; vy <= 3; vy++) {
      for (let vx = 0; vx <= 4; vx++) {
        expect(t.getVertexHeight(vx, vy)).toBe(MIN_LAND_ELEVATION);
      }
    }
  });

  it("safe OOB getters return defaults", () => {
    const t = new Terrain(2, 2);
    expect(t.getVertexHeight(-1, 0)).toBe(0);
    expect(t.getTileElevation(-1, 0)).toBe(0);
    expect(t.getTileMinCornerHeight(3, 0)).toBe(0);
    expect(t.getBaseTerrain(-1, 0)).toBe("grass");
  });
});

describe("coordinate helpers", () => {
  it("tileVertices returns [top, right, bottom, left]", () => {
    expect(tileVertices(2, 3)).toEqual([[2, 3], [3, 3], [3, 4], [2, 4]]);
  });

  it("tilesTouchingVertex handles interior, edge, and corner vertices", () => {
    expect(new Set(tilesTouchingVertex(2, 2, 5, 5).map(([x, y]) => `${x},${y}`))).toEqual(
      new Set(["1,1", "2,1", "1,2", "2,2"])
    );
    expect(tilesTouchingVertex(0, 0, 5, 5)).toEqual([[0, 0]]);
    expect(new Set(tilesTouchingVertex(0, 2, 5, 5).map(([x, y]) => `${x},${y}`))).toEqual(
      new Set(["0,1", "0,2"])
    );
    expect(tilesTouchingVertex(5, 5, 5, 5)).toEqual([[4, 4]]);
  });
});

describe("vertex reads and writes", () => {
  it("unsafeSetVertexHeight writes valid vertices and rejects invalid values", () => {
    const t = new Terrain(3, 3);
    expect(t.unsafeSetVertexHeight(1, 2, 5)).toBe(true);
    expect(t.getVertexHeight(1, 2)).toBe(5);
    expect(t.unsafeSetVertexHeight(-1, 0, 1)).toBe(false);
    expect(t.unsafeSetVertexHeight(1, 1, 1.5)).toBe(false);
    expect(t.unsafeSetVertexHeight(1, 1, -1)).toBe(false);
    expect(t.unsafeSetVertexHeight(1, 1, MAX_ELEVATION + 1)).toBe(false);
  });

  it("player vertex cap accepts delta 3 and rejects delta 4", () => {
    const t = new Terrain(3, 3);
    expect(t.canPlayerSetVertexHeight(1, 1, MIN_LAND_ELEVATION + 3)).toBe(true);
    expect(t.canPlayerSetVertexHeight(1, 1, MIN_LAND_ELEVATION + 4)).toBe(false);
    expect(MAX_PLAYER_SLOPE_DELTA).toBe(3);
  });

  it("setPlayerVertexHeight mutates and fires onMutate once on accept only", () => {
    const t = new Terrain(3, 3);
    const spy = vi.fn();
    t.setOnMutate(spy);
    expect(t.setPlayerVertexHeight(1, 1, 4)).toBe(true);
    expect(t.getVertexHeight(1, 1)).toBe(4);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(t.setPlayerVertexHeight(1, 1, MAX_ELEVATION + 1)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("derived tile height and buildability", () => {
  it("getTileElevation is max corner and getTileMinCornerHeight is min corner", () => {
    const t = new Terrain(2, 2);
    t.unsafeSetVertexHeight(0, 0, 2);
    t.unsafeSetVertexHeight(1, 0, 4);
    t.unsafeSetVertexHeight(1, 1, 3);
    t.unsafeSetVertexHeight(0, 1, 1);
    expect(t.getTileElevation(0, 0)).toBe(4);
    expect(t.getTileMinCornerHeight(0, 0)).toBe(1);
  });

  it("flat/buildable requires exact corner equality above sea level", () => {
    const t = new Terrain(2, 2);
    expect(t.isFlatTile(0, 0, noWater)).toBe(true);
    t.unsafeSetVertexHeight(1, 0, 2);
    expect(t.isFlatTile(0, 0, noWater)).toBe(false);
    expect(t.canBuildAt(0, 0, 1, 1, noWater)).toBe(false);
    t.unsafeSetVertexHeight(0, 0, 2);
    t.unsafeSetVertexHeight(1, 1, 2);
    t.unsafeSetVertexHeight(0, 1, 2);
    expect(t.isFlatTile(0, 0, noWater)).toBe(true);
  });

  it("flat area requires the full spanning vertex grid to share one height", () => {
    const t = new Terrain(3, 3);
    for (let vy = 0; vy <= 2; vy++) {
      for (let vx = 0; vx <= 2; vx++) t.unsafeSetVertexHeight(vx, vy, 2);
    }
    expect(t.isFlatArea(0, 0, 2, 2, noWater)).toBe(true);
    t.unsafeSetVertexHeight(2, 2, 3);
    expect(t.isFlatArea(0, 0, 2, 2, noWater)).toBe(false);
  });
});

describe("coplanar tile predicate", () => {
  it("flat tile (all corners at MIN_LAND_ELEVATION) is coplanar", () => {
    const t = new Terrain(2, 2);
    expect(t.isCoplanarTile(0, 0, noWater)).toBe(true);
  });

  it("uniform N-S ramp is coplanar (top+bottom = left+right)", () => {
    const t = new Terrain(2, 2);
    t.unsafeSetVertexHeight(0, 0, 1);
    t.unsafeSetVertexHeight(1, 0, 1);
    t.unsafeSetVertexHeight(0, 1, 2);
    t.unsafeSetVertexHeight(1, 1, 2);
    expect(t.isCoplanarTile(0, 0, noWater)).toBe(true);
  });

  it("uniform E-W ramp is coplanar (top+bottom = left+right)", () => {
    const t = new Terrain(2, 2);
    t.unsafeSetVertexHeight(0, 0, 1);
    t.unsafeSetVertexHeight(1, 0, 2);
    t.unsafeSetVertexHeight(0, 1, 1);
    t.unsafeSetVertexHeight(1, 1, 2);
    expect(t.isCoplanarTile(0, 0, noWater)).toBe(true);
  });

  it("triangle wedge is NOT coplanar (top+bottom != left+right)", () => {
    const t = new Terrain(2, 2);
    t.unsafeSetVertexHeight(0, 0, 1);
    t.unsafeSetVertexHeight(1, 0, 1);
    t.unsafeSetVertexHeight(0, 1, 1);
    t.unsafeSetVertexHeight(1, 1, 2);
    expect(t.isCoplanarTile(0, 0, noWater)).toBe(false);
  });

  it("saddle is NOT coplanar (top+bottom != left+right)", () => {
    const t = new Terrain(2, 2);
    t.unsafeSetVertexHeight(0, 0, 2);
    t.unsafeSetVertexHeight(1, 0, 1);
    t.unsafeSetVertexHeight(0, 1, 1);
    t.unsafeSetVertexHeight(1, 1, 2);
    expect(t.isCoplanarTile(0, 0, noWater)).toBe(false);
  });

  it("water corner (min <= SEA_LEVEL) is NOT coplanar despite formula balance", () => {
    const t = new Terrain(2, 2);
    t.unsafeSetVertexHeight(0, 0, 0);
    t.unsafeSetVertexHeight(1, 0, 0);
    t.unsafeSetVertexHeight(0, 1, 1);
    t.unsafeSetVertexHeight(1, 1, 1);
    expect(t.isCoplanarTile(0, 0, noWater)).toBe(false);
  });

  it("OOB tile returns false", () => {
    const t = new Terrain(2, 2);
    expect(t.isCoplanarTile(-1, 0, noWater)).toBe(false);
    expect(t.isCoplanarTile(2, 0, noWater)).toBe(false);
    expect(t.isCoplanarTile(0, -1, noWater)).toBe(false);
    expect(t.isCoplanarTile(0, 2, noWater)).toBe(false);
  });
});

describe("coplanar vs strict-flat asymmetry (regression guard)", () => {
  it("N-S ramp: isFlatTile false, isCoplanarTile/canBuildRoadAt/canBuildAt true", () => {
    const t = new Terrain(2, 2);
    // tile (0,0): corners top=(0,0)=1, right=(1,0)=1, bottom=(1,1)=2, left=(0,1)=2
    t.unsafeSetVertexHeight(0, 0, 1);
    t.unsafeSetVertexHeight(1, 0, 1);
    t.unsafeSetVertexHeight(0, 1, 2);
    t.unsafeSetVertexHeight(1, 1, 2);
    expect(t.isFlatTile(0, 0, noWater)).toBe(false);
    expect(t.isCoplanarTile(0, 0, noWater)).toBe(true);
    expect(t.canBuildRoadAt(0, 0, noWater)).toBe(true);
    expect(t.canBuildAt(0, 0, 1, 1, noWater)).toBe(true);
  });
});

describe("serialization data", () => {
  it("toJSON emits vertex-smooth v8 terrain data", () => {
    const t = new Terrain(2, 2);
    const data = t.toJSON();
    expect(data.mode).toBe("vertex-smooth");
    expect(data.vertexHeights).toHaveLength(3);
    expect(data.vertexHeights[0]).toHaveLength(3);
    expect("tileElevations" in data).toBe(false);
  });

  it("fromData accepts vertex-smooth and rejects tile-step input", () => {
    const t = Terrain.fromData(new Terrain(2, 2).toJSON());
    expect(t.getMode()).toBe("vertex-smooth");
    expect(() => Terrain.fromData({
      width: 2,
      height: 2,
      mode: "tile-step",
      tileElevations: [[1, 1], [1, 1]],
      baseTiles: [["grass", "grass"], ["grass", "grass"]],
    })).toThrow("only mode 'vertex-smooth'");
  });
});

describe("tile-height projection helper", () => {
  it("projects per-tile heights to vertex heights using min touching tile height", () => {
    expect(projectTileHeightsToVertexHeights([
      [2, 3],
      [4, 1],
    ])).toEqual([
      [2, 2, 3],
      [2, 1, 1],
      [4, 1, 1],
    ]);
  });

  it("constants retain water/land relation", () => {
    expect(SEA_LEVEL).toBe(0);
    expect(MIN_LAND_ELEVATION).toBe(SEA_LEVEL + 1);
  });
});
