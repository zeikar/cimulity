import { describe, it, expect, vi } from "vitest";
import { Terrain, MAX_ELEVATION, SEA_LEVEL, MIN_LAND_ELEVATION } from "./Terrain";

describe("Terrain construction defaults", () => {
  it("has correct width/height/mode", () => {
    const t = new Terrain(4, 3);
    expect(t.getWidth()).toBe(4);
    expect(t.getHeight()).toBe(3);
    expect(t.getMode()).toBe("tile-step");
  });

  it("all tile elevations start at MIN_LAND_ELEVATION", () => {
    const t = new Terrain(4, 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        expect(t.getTileElevation(x, y)).toBe(MIN_LAND_ELEVATION);
      }
    }
  });

  it("all base terrain starts as grass", () => {
    const t = new Terrain(4, 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        expect(t.getBaseTerrain(x, y)).toBe("grass");
      }
    }
  });
});

describe("flat baseline", () => {
  it("every cell of a fresh 4×4 Terrain returns MIN_LAND_ELEVATION", () => {
    const t = new Terrain(4, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(t.getTileElevation(x, y)).toBe(MIN_LAND_ELEVATION);
      }
    }
  });

  it("SEA_LEVEL === 0", () => {
    expect(SEA_LEVEL).toBe(0);
  });

  it("MIN_LAND_ELEVATION === 1", () => {
    expect(MIN_LAND_ELEVATION).toBe(1);
  });

  it("MIN_LAND_ELEVATION === SEA_LEVEL + 1", () => {
    expect(MIN_LAND_ELEVATION).toBe(SEA_LEVEL + 1);
  });
});

describe("OOB getters return safe defaults", () => {
  const t = new Terrain(5, 5);

  it("getTileElevation OOB returns 0", () => {
    expect(t.getTileElevation(-1, 0)).toBe(0);
    expect(t.getTileElevation(10, 10)).toBe(0);
  });

  it("getBaseTerrain OOB returns grass", () => {
    expect(t.getBaseTerrain(-1, 0)).toBe("grass");
  });

});

describe("canSetElevation", () => {
  it("accepts diff=1 from all-MIN_LAND_ELEVATION neighbors at center", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(2, 2, MIN_LAND_ELEVATION + 1)).toBe(true);
  });

  it("rejects diff > 1 (all neighbors at MIN_LAND_ELEVATION, request MIN_LAND_ELEVATION + 2)", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(2, 2, MIN_LAND_ELEVATION + 2)).toBe(false);
  });

  it("rejects non-integer", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(2, 2, 1.5)).toBe(false);
  });

  it("rejects negative", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(2, 2, -1)).toBe(false);
  });

  it("rejects over MAX_ELEVATION", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(2, 2, MAX_ELEVATION + 1)).toBe(false);
  });

  it("rejects OOB tile (-1, 0)", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(-1, 0, 0)).toBe(false);
  });

  it("rejects OOB tile (5, 0) on a 5x5 map", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(5, 0, 0)).toBe(false);
  });

  it("diff=1 check across all 8 neighbors (mixed elevations)", () => {
    // Build a 5x5 terrain with neighbors at: 0,1,0,1,1,0,1,0 around center (2,2).
    // Center at 1 is valid (max diff = 1). Center at 2 is invalid (some neighbor at 0 → diff=2).
    const t = new Terrain(5, 5);
    // Set the 8 neighbors of (2,2): (1,1),(2,1),(3,1),(1,2),(3,2),(1,3),(2,3),(3,3)
    t.unsafeSetElevation(1, 1, 0);
    t.unsafeSetElevation(2, 1, 1);
    t.unsafeSetElevation(3, 1, 0);
    t.unsafeSetElevation(1, 2, 1);
    t.unsafeSetElevation(3, 2, 1);
    t.unsafeSetElevation(1, 3, 0);
    t.unsafeSetElevation(2, 3, 1);
    t.unsafeSetElevation(3, 3, 0);
    // center at 1: max diff with any neighbor is 1 → valid
    expect(t.canSetElevation(2, 2, 1)).toBe(true);
    // center at 2: neighbors at 0 have diff=2 → invalid
    expect(t.canSetElevation(2, 2, 2)).toBe(false);
  });

  it("OOB neighbors are skipped — corner (0,0) only has 3 in-bounds neighbors", () => {
    const t = new Terrain(5, 5);
    // All in-bounds neighbors of (0,0) are (1,0), (0,1), (1,1) — all at MIN_LAND_ELEVATION.
    // diff of 1 from MIN_LAND_ELEVATION is fine (requesting MIN_LAND_ELEVATION + 1).
    expect(t.canSetElevation(0, 0, MIN_LAND_ELEVATION + 1)).toBe(true);
  });
});

describe("setElevation", () => {
  it("returns true and writes on accept", () => {
    const t = new Terrain(5, 5);
    expect(t.setElevation(2, 2, 1)).toBe(true);
    expect(t.getTileElevation(2, 2)).toBe(1);
  });

  it("returns false and leaves value unchanged on reject", () => {
    const t = new Terrain(5, 5);
    t.setElevation(2, 2, MIN_LAND_ELEVATION + 1);
    // diff of 4 from neighbors at MIN_LAND_ELEVATION — try large value
    expect(t.setElevation(2, 2, 5)).toBe(false);
    expect(t.getTileElevation(2, 2)).toBe(MIN_LAND_ELEVATION + 1);
  });
});

describe("unsafeSetElevation", () => {
  it("accepts a cliff (diff > 1 from all-MIN_LAND_ELEVATION neighbors)", () => {
    const t = new Terrain(5, 5);
    expect(t.unsafeSetElevation(2, 2, 3)).toBe(true);
    expect(t.getTileElevation(2, 2)).toBe(3);
  });

  it("rejects OOB", () => {
    const t = new Terrain(5, 5);
    expect(t.unsafeSetElevation(-1, 0, 1)).toBe(false);
    expect(t.unsafeSetElevation(5, 0, 1)).toBe(false);
  });

  it("rejects non-integer", () => {
    const t = new Terrain(5, 5);
    expect(t.unsafeSetElevation(2, 2, 1.5)).toBe(false);
  });

  it("rejects negative", () => {
    const t = new Terrain(5, 5);
    expect(t.unsafeSetElevation(2, 2, -1)).toBe(false);
  });

  it("rejects over MAX_ELEVATION", () => {
    const t = new Terrain(5, 5);
    expect(t.unsafeSetElevation(2, 2, MAX_ELEVATION + 1)).toBe(false);
  });
});

describe("onMutate callback", () => {
  it("fires on every accept (setElevation, unsafeSetElevation, setBaseTerrain grass)", () => {
    const t = new Terrain(5, 5);
    const spy = vi.fn();
    t.setOnMutate(spy);

    t.setElevation(2, 2, 1);          // accept
    t.unsafeSetElevation(0, 0, 3);    // accept (cliff ok via unsafe)
    t.setBaseTerrain(1, 1, "grass");  // accept

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("does NOT fire on reject", () => {
    const t = new Terrain(5, 5);
    const spy = vi.fn();
    t.setOnMutate(spy);

    t.setElevation(2, 2, 5);          // reject (diff > 1 from neighbors at 0)
    t.unsafeSetElevation(-1, 0, 1);   // reject (OOB)
    t.setBaseTerrain(0, 0, "water");  // reject (non-grass)

    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("setOnMutate(null) clears the callback — subsequent accepts do not call prior spy", () => {
    const t = new Terrain(5, 5);
    const spy = vi.fn();
    t.setOnMutate(spy);
    t.setOnMutate(null);

    t.setElevation(2, 2, 1);
    t.unsafeSetElevation(0, 0, 3);
    t.setBaseTerrain(1, 1, "grass");

    expect(spy).toHaveBeenCalledTimes(0);
  });
});

describe("setBaseTerrain", () => {
  it('rejects "water", "sand", "rock" — returns false, value stays grass', () => {
    const t = new Terrain(5, 5);
    for (const val of ["water", "sand", "rock"] as const) {
      expect(t.setBaseTerrain(2, 2, val)).toBe(false);
      expect(t.getBaseTerrain(2, 2)).toBe("grass");
    }
  });

  it('calls console.warn with coords for each rejected value in dev mode', () => {
    vi.stubEnv("NODE_ENV", "development");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const t = new Terrain(5, 5);
    for (const val of ["water", "sand", "rock"] as const) {
      t.setBaseTerrain(3, 4, val);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("(3,4)")
      );
    }

    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('accepts "grass" on already-grass tile — returns true and fires onMutate', () => {
    const t = new Terrain(5, 5);
    const spy = vi.fn();
    t.setOnMutate(spy);
    expect(t.setBaseTerrain(2, 2, "grass")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("getRenderHeight", () => {
  it("equals getTileElevation in tile-step mode", () => {
    const t = new Terrain(5, 5);
    t.unsafeSetElevation(2, 2, 4);
    expect(t.getRenderHeight(2, 2)).toBe(t.getTileElevation(2, 2));
  });
});

describe("getSlopeMask", () => {
  const noWater = () => false;

  it("OOB center returns 0", () => {
    const t = new Terrain(5, 5);
    expect(t.getSlopeMask(-1, 0)).toBe(0);
    expect(t.getSlopeMask(10, 10)).toBe(0);
  });

  it("flat map — all-MIN_LAND_ELEVATION elevations — every tile has mask 0", () => {
    const t = new Terrain(5, 5);
    expect(t.getSlopeMask(2, 2)).toBe(0);
    expect(t.getSlopeMask(0, 0)).toBe(0);
  });

  it("1×1 raised tile has non-zero mask", () => {
    const t = new Terrain(5, 5);
    // Center raised above MIN_LAND_ELEVATION baseline — neighbors stay at baseline.
    t.unsafeSetElevation(1, 1, MIN_LAND_ELEVATION + 1);
    expect(t.getSlopeMask(1, 1)).not.toBe(0);
  });

  it("OOB neighbors treated as equal — map-edge tile on flat map has mask 0", () => {
    const t = new Terrain(5, 5);
    // (0,0) has OOB N and W neighbors; they are treated as equal, so mask stays 0
    expect(t.getSlopeMask(0, 0)).toBe(0);
  });

  it("cliff case: diff=2 from baseline still sets LOWER_* bits", () => {
    const t = new Terrain(5, 5);
    t.unsafeSetElevation(2, 2, 3);
    // Neighbors at MIN_LAND_ELEVATION=1, diff=2 — bits must still be set
    expect(t.getSlopeMask(2, 2)).not.toBe(0);
    expect(t.isFlatTile(2, 2, noWater)).toBe(false);
  });
});

describe("getTerrainShape", () => {
  it("OOB returns flat", () => {
    const t = new Terrain(5, 5);
    expect(t.getTerrainShape(-1, 0)).toBe("flat");
  });

  it("flat map — center returns flat", () => {
    const t = new Terrain(5, 5);
    expect(t.getTerrainShape(2, 2)).toBe("flat");
  });
});

describe("isFlatTile", () => {
  const noWater = () => false;

  it("1×1 raised tile above surrounding baseline is NOT flat", () => {
    const t = new Terrain(5, 5);
    // Raise center above the MIN_LAND_ELEVATION baseline so neighbors are lower.
    t.unsafeSetElevation(1, 1, MIN_LAND_ELEVATION + 1);
    expect(t.isFlatTile(1, 1, noWater)).toBe(false);
  });

  it("flat ground tile is flat when water predicate returns false", () => {
    const t = new Terrain(5, 5);
    expect(t.isFlatTile(2, 2, noWater)).toBe(true);
  });

  it("water predicate rejects an otherwise-flat tile", () => {
    const t = new Terrain(5, 5);
    expect(t.isFlatTile(2, 2, (x, y) => x === 2 && y === 2)).toBe(false);
  });

  it("OOB tile is not flat", () => {
    const t = new Terrain(5, 5);
    expect(t.isFlatTile(-1, 0, noWater)).toBe(false);
  });

  it("interior of 3×3 plateau is flat", () => {
    // 5×5 map, 3×3 plateau at (0..2)×(0..2) all at elevation 2; surrounding at baseline (1).
    const t = new Terrain(5, 5);
    for (let py = 0; py < 3; py++) {
      for (let px = 0; px < 3; px++) {
        t.unsafeSetElevation(px, py, 2);
      }
    }
    // Interior tile (1,1): all 4 orthogonal neighbors are also elevation 2 → mask 0
    expect(t.getSlopeMask(1, 1)).toBe(0);
    expect(t.isFlatTile(1, 1, noWater)).toBe(true);
  });

  it("edge tile of 3×3 plateau is NOT flat (sees lower neighbor outside)", () => {
    // 5×5 map, 3×3 plateau at (0..2)×(0..2) all at elevation 2; surrounding at baseline (1).
    // Pick (2,1): in-bounds on all sides, E neighbor (3,1) = baseline=1 < 2 → mask non-zero.
    const t = new Terrain(5, 5);
    for (let py = 0; py < 3; py++) {
      for (let px = 0; px < 3; px++) {
        t.unsafeSetElevation(px, py, 2);
      }
    }
    expect(t.getSlopeMask(2, 1)).not.toBe(0);
    expect(t.isFlatTile(2, 1, noWater)).toBe(false);
  });
});

describe("isFlatArea", () => {
  const noWater = () => false;

  it("2×2 with one corner raised returns false", () => {
    const t = new Terrain(5, 5);
    // Raise one corner above the MIN_LAND_ELEVATION baseline so the rect is non-uniform.
    t.unsafeSetElevation(1, 1, MIN_LAND_ELEVATION + 1);
    expect(t.isFlatArea(0, 0, 2, 2, noWater)).toBe(false);
  });

  it("interior 3×3 of a 5×5 plateau at elevation 2 returns true", () => {
    // 5×5 map with full 5×5 plateau at elevation 2; all cells uniform → mask 0 everywhere.
    const t = new Terrain(5, 5);
    for (let py = 0; py < 5; py++) {
      for (let px = 0; px < 5; px++) {
        t.unsafeSetElevation(px, py, 2);
      }
    }
    expect(t.isFlatArea(1, 1, 3, 3, noWater)).toBe(true);
  });

  it("OOB rect returns false", () => {
    const t = new Terrain(5, 5);
    expect(t.isFlatArea(4, 4, 2, 2, noWater)).toBe(false);
  });

  it("water inside the rect causes false", () => {
    const t = new Terrain(5, 5);
    // (1,1) is flat (at MIN_LAND_ELEVATION baseline) but water predicate marks it as water
    expect(t.isFlatArea(0, 0, 3, 3, (x, y) => x === 1 && y === 1)).toBe(false);
  });
});

describe("canBuildAt", () => {
  const noWater = () => false;

  it("1×1 raised tile rejects", () => {
    const t = new Terrain(5, 5);
    // Raise above baseline so the tile is not flat relative to its neighbors.
    t.unsafeSetElevation(1, 1, MIN_LAND_ELEVATION + 1);
    expect(t.canBuildAt(1, 1, 1, 1, noWater)).toBe(false);
  });

  it("flat 1×1 tile accepts", () => {
    const t = new Terrain(5, 5);
    expect(t.canBuildAt(0, 0, 1, 1, noWater)).toBe(true);
  });

  it("water predicate injection: canBuildAt rejects water tile", () => {
    const t = new Terrain(10, 10);
    expect(t.canBuildAt(5, 5, 1, 1, (x, y) => x === 5 && y === 5)).toBe(false);
  });

  it("water predicate injection: canBuildAt accepts non-water flat tile", () => {
    const t = new Terrain(10, 10);
    expect(t.canBuildAt(0, 0, 1, 1, (x, y) => x === 5 && y === 5)).toBe(true);
  });
});

describe("canBuildRoadAt", () => {
  const noWater = () => false;

  it("1×1 raised tile rejects", () => {
    const t = new Terrain(5, 5);
    // Raise above baseline so the tile is not flat relative to its neighbors.
    t.unsafeSetElevation(1, 1, MIN_LAND_ELEVATION + 1);
    expect(t.canBuildRoadAt(1, 1, noWater)).toBe(false);
  });

  it("flat tile accepts", () => {
    const t = new Terrain(5, 5);
    expect(t.canBuildRoadAt(0, 0, noWater)).toBe(true);
  });

  it("water predicate: water tile (3,3) rejects", () => {
    const t = new Terrain(5, 5);
    const water33 = (x: number, y: number) => x === 3 && y === 3;
    expect(t.canBuildRoadAt(3, 3, water33)).toBe(false);
  });

  it("water predicate: non-water flat tile accepts", () => {
    const t = new Terrain(5, 5);
    const water33 = (x: number, y: number) => x === 3 && y === 3;
    expect(t.canBuildRoadAt(0, 0, water33)).toBe(true);
  });
});

describe("canBuildAt — diagonal-only deformation is buildable (v1 policy)", () => {
  it("NE diagonal lower (slopeMask=0, but corner drop) → tile is buildable", () => {
    const terrain = new Terrain(5, 5);
    // Explicit per-cell elevation so default state can't drift the test.
    // Set (2,2)=2, (3,1)=1 (NE diagonal lower), all other 7 neighbors of (2,2) at 2.
    terrain.unsafeSetElevation(2, 2, 2);
    terrain.unsafeSetElevation(3, 1, 1); // ne neighbor lower
    terrain.unsafeSetElevation(1, 1, 2); // nw
    terrain.unsafeSetElevation(2, 1, 2); // n
    terrain.unsafeSetElevation(1, 2, 2); // w
    terrain.unsafeSetElevation(3, 2, 2); // e
    terrain.unsafeSetElevation(1, 3, 2); // sw
    terrain.unsafeSetElevation(2, 3, 2); // s
    terrain.unsafeSetElevation(3, 3, 2); // se

    expect(terrain.getSlopeMask(2, 2)).toBe(0);
    expect(terrain.canBuildAt(2, 2, 1, 1, () => false)).toBe(true);
    expect(terrain.canBuildRoadAt(2, 2, () => false)).toBe(true);
    // v1 policy: diagonal-only deformations remain buildable. Buildings show a
    // cosmetic seam; see docs/architecture.md slope section.
  });
});
