import { describe, it, expect } from "vitest";
import {
  LOWER_N,
  LOWER_E,
  LOWER_S,
  LOWER_W,
  slopeMaskFor,
  terrainShapeFor,
} from "./terrainSlope";

describe("terrainShapeFor — all 16 mask values", () => {
  it("mask 0 → flat", () => expect(terrainShapeFor(0)).toBe("flat"));
  it("mask 1 → slope_n", () => expect(terrainShapeFor(1)).toBe("slope_n"));
  it("mask 2 → slope_e", () => expect(terrainShapeFor(2)).toBe("slope_e"));
  it("mask 3 → slope_ne", () => expect(terrainShapeFor(3)).toBe("slope_ne"));
  it("mask 4 → slope_s", () => expect(terrainShapeFor(4)).toBe("slope_s"));
  it("mask 5 → rough", () => expect(terrainShapeFor(5)).toBe("rough"));
  it("mask 6 → slope_se", () => expect(terrainShapeFor(6)).toBe("slope_se"));
  it("mask 7 → rough", () => expect(terrainShapeFor(7)).toBe("rough"));
  it("mask 8 → slope_w", () => expect(terrainShapeFor(8)).toBe("slope_w"));
  it("mask 9 → slope_nw", () => expect(terrainShapeFor(9)).toBe("slope_nw"));
  it("mask 10 → rough", () => expect(terrainShapeFor(10)).toBe("rough"));
  it("mask 11 → rough", () => expect(terrainShapeFor(11)).toBe("rough"));
  it("mask 12 → slope_sw", () => expect(terrainShapeFor(12)).toBe("slope_sw"));
  it("mask 13 → rough", () => expect(terrainShapeFor(13)).toBe("rough"));
  it("mask 14 → rough", () => expect(terrainShapeFor(14)).toBe("rough"));
  it("mask 15 → rough", () => expect(terrainShapeFor(15)).toBe("rough"));
});

describe("slopeMaskFor", () => {
  it("all equal → 0", () => {
    expect(slopeMaskFor(2, 2, 2, 2, 2)).toBe(0);
  });

  it("only N lower → LOWER_N (1)", () => {
    expect(slopeMaskFor(1, 0, 1, 1, 1)).toBe(LOWER_N);
  });

  it("only E lower → LOWER_E (2)", () => {
    expect(slopeMaskFor(1, 1, 0, 1, 1)).toBe(LOWER_E);
  });

  it("only S lower → LOWER_S (4)", () => {
    expect(slopeMaskFor(1, 1, 1, 0, 1)).toBe(LOWER_S);
  });

  it("only W lower → LOWER_W (8)", () => {
    expect(slopeMaskFor(1, 1, 1, 1, 0)).toBe(LOWER_W);
  });

  it("N and E lower → LOWER_N | LOWER_E (3)", () => {
    expect(slopeMaskFor(1, 0, 0, 1, 1)).toBe(LOWER_N | LOWER_E);
  });

  it("higher neighbor → bit unset", () => {
    // E neighbor is 3, center is 2 — E is HIGHER, bit must NOT be set
    expect(slopeMaskFor(2, 2, 3, 2, 2)).toBe(0);
  });

  it("cliff case: diff=3 still sets LOWER_N", () => {
    // center=3, N=0 → diff is 3, but bit must still be set
    expect(slopeMaskFor(3, 0, 3, 3, 3)).toBe(LOWER_N);
  });
});
