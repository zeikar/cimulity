import { describe, it, expect, vi } from "vitest";
import { Terrain, MAX_ELEVATION } from "./Terrain";

describe("Terrain construction defaults", () => {
  it("has correct width/height/mode", () => {
    const t = new Terrain(4, 3);
    expect(t.getWidth()).toBe(4);
    expect(t.getHeight()).toBe(3);
    expect(t.getMode()).toBe("tile-step");
  });

  it("all tile elevations start at 0", () => {
    const t = new Terrain(4, 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        expect(t.getTileElevation(x, y)).toBe(0);
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

describe("OOB getters return safe defaults", () => {
  const t = new Terrain(5, 5);

  it("getTileElevation OOB returns 0", () => {
    expect(t.getTileElevation(-1, 0)).toBe(0);
    expect(t.getTileElevation(10, 10)).toBe(0);
  });

  it("getBaseTerrain OOB returns grass", () => {
    expect(t.getBaseTerrain(-1, 0)).toBe("grass");
  });

  it("isBelowWaterLevel OOB returns false", () => {
    expect(t.isBelowWaterLevel(-1, 0)).toBe(false);
  });
});

describe("canSetElevation", () => {
  it("accepts diff=1 from all-zero neighbors at center", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(2, 2, 1)).toBe(true);
  });

  it("rejects diff > 1 (all neighbors at 0, request 2)", () => {
    const t = new Terrain(5, 5);
    expect(t.canSetElevation(2, 2, 2)).toBe(false);
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
    // All in-bounds neighbors of (0,0) are (1,0), (0,1), (1,1) — all at 0.
    // diff of 1 from 0 is fine.
    expect(t.canSetElevation(0, 0, 1)).toBe(true);
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
    t.setElevation(2, 2, 1);
    // diff of 5 from neighbors at 0 (aside from center already at 1) — try large value
    expect(t.setElevation(2, 2, 5)).toBe(false);
    expect(t.getTileElevation(2, 2)).toBe(1);
  });
});

describe("unsafeSetElevation", () => {
  it("accepts a cliff (diff > 1 from all-zero neighbors)", () => {
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

describe("isBelowWaterLevel", () => {
  it("always returns false in v1", () => {
    const t = new Terrain(5, 5);
    t.unsafeSetElevation(2, 2, 0);
    expect(t.isBelowWaterLevel(2, 2)).toBe(false);
    expect(t.isBelowWaterLevel(0, 0)).toBe(false);
    // OOB also false
    expect(t.isBelowWaterLevel(-1, 0)).toBe(false);
  });
});

describe("getRenderHeight", () => {
  it("equals getTileElevation in tile-step mode", () => {
    const t = new Terrain(5, 5);
    t.unsafeSetElevation(2, 2, 4);
    expect(t.getRenderHeight(2, 2)).toBe(t.getTileElevation(2, 2));
  });
});
