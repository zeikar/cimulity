import { describe, it, expect } from "vitest";
import { seedFor, mulberry32, pickIndex } from "./buildingSeed";

function stubbedRng(v: number): () => number {
  return () => v;
}

describe("seedFor", () => {
  it("is pure: same id yields same result across multiple calls", () => {
    expect(seedFor(42)).toBe(seedFor(42));
    expect(seedFor(42)).toBe(seedFor(42));
  });

  it("produces distinct values for 0, 1, and 1_000_000", () => {
    const a = seedFor(0);
    const b = seedFor(1);
    const c = seedFor(1_000_000);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("always returns a valid u32 (>= 0 and <= 0xFFFFFFFF)", () => {
    for (const id of [0, 1, 255, 1_000_000, 0xffffffff]) {
      const seed = seedFor(id);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("mulberry32", () => {
  it("is pure: two PRNGs with the same seed yield the same first 16 outputs", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    for (let i = 0; i < 16; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("outputs are all in [0, 1) over 1000 draws", () => {
    const rng = mulberry32(99999);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("two PRNGs with different seeds diverge by the 3rd draw", () => {
    const rngA = mulberry32(1);
    const rngB = mulberry32(2);
    const drawsA = [rngA(), rngA(), rngA()];
    const drawsB = [rngB(), rngB(), rngB()];
    const anyDiffers = drawsA.some((v, i) => v !== drawsB[i]);
    expect(anyDiffers).toBe(true);
  });
});

describe("pickIndex", () => {
  it("always returns 1 for weights [0, 1]", () => {
    expect(pickIndex(mulberry32(1), [0, 1])).toBe(1);
    expect(pickIndex(mulberry32(2), [0, 1])).toBe(1);
  });

  it("always returns 0 for weights [1, 0, 0]", () => {
    expect(pickIndex(mulberry32(1), [1, 0, 0])).toBe(0);
    expect(pickIndex(mulberry32(2), [1, 0, 0])).toBe(0);
  });

  it("stubbedRng(0.3) with [0.4, 0.6] returns 0", () => {
    expect(pickIndex(stubbedRng(0.3), [0.4, 0.6])).toBe(0);
  });

  it("stubbedRng(0.5) with [0.4, 0.6] returns 1", () => {
    expect(pickIndex(stubbedRng(0.5), [0.4, 0.6])).toBe(1);
  });

  it("stubbedRng(0.0) with [0.25, 0.25, 0.25, 0.25] returns 0", () => {
    expect(pickIndex(stubbedRng(0.0), [0.25, 0.25, 0.25, 0.25])).toBe(0);
  });

  it("stubbedRng(0.99) with [0.25, 0.25, 0.25, 0.25] returns 3", () => {
    expect(pickIndex(stubbedRng(0.99), [0.25, 0.25, 0.25, 0.25])).toBe(3);
  });

  it("stubbedRng(0.5) with [0.25, 0.25, 0.25, 0.25] returns 2", () => {
    expect(pickIndex(stubbedRng(0.5), [0.25, 0.25, 0.25, 0.25])).toBe(2);
  });
});
