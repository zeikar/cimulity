import { describe, it, expect } from "vitest";
import { Terrain } from "@/game/core/Terrain";
import { tileCornerHeights } from "./tileCornerHeights";

// Helper: build a 7x7 terrain and set elevations around the center cell (3,3).
// `neighbors` keys: n, e, s, w, ne, se, sw, nw — values default to `fill` if omitted.
function makeGrid(
  centerH: number,
  fill: number,
  neighbors: Partial<Record<"n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw", number>> = {}
): { terrain: Terrain; cx: number; cy: number } {
  const terrain = new Terrain(7, 7);
  const cx = 3;
  const cy = 3;

  // Flood fill everything
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      terrain.unsafeSetElevation(x, y, fill);
    }
  }

  terrain.unsafeSetElevation(cx, cy, centerH);
  terrain.unsafeSetElevation(cx,     cy - 1, neighbors.n  ?? fill);
  terrain.unsafeSetElevation(cx + 1, cy,     neighbors.e  ?? fill);
  terrain.unsafeSetElevation(cx,     cy + 1, neighbors.s  ?? fill);
  terrain.unsafeSetElevation(cx - 1, cy,     neighbors.w  ?? fill);
  terrain.unsafeSetElevation(cx + 1, cy - 1, neighbors.ne ?? fill);
  terrain.unsafeSetElevation(cx + 1, cy + 1, neighbors.se ?? fill);
  terrain.unsafeSetElevation(cx - 1, cy + 1, neighbors.sw ?? fill);
  terrain.unsafeSetElevation(cx - 1, cy - 1, neighbors.nw ?? fill);

  return { terrain, cx, cy };
}

describe("tileCornerHeights — flat cases", () => {
  it("flat plateau (H=3, all neighbors=3) → all corners = 3", () => {
    const { terrain, cx, cy } = makeGrid(3, 3);
    const corners = tileCornerHeights(terrain, cx, cy);
    expect(corners).toEqual({ topH: 3, rightH: 3, bottomH: 3, leftH: 3 });
  });
});

describe("tileCornerHeights — cardinal drops", () => {
  it("S-lower (H=3, s=2, others=3) → bottomH=2, leftH=2, topH=3, rightH=3", () => {
    const { terrain, cx, cy } = makeGrid(3, 3, { s: 2 });
    const corners = tileCornerHeights(terrain, cx, cy);
    expect(corners.topH).toBe(3);
    expect(corners.rightH).toBe(3);
    expect(corners.bottomH).toBe(2); // min(H=3, e=3, s=2, se=3) = 2
    expect(corners.leftH).toBe(2);   // min(H=3, s=2, w=3, sw=3) = 2
  });

  it("N-lower (H=3, n=2, others=3) → topH=2, rightH=2, bottomH=3, leftH=3", () => {
    const { terrain, cx, cy } = makeGrid(3, 3, { n: 2 });
    const corners = tileCornerHeights(terrain, cx, cy);
    expect(corners.topH).toBe(2);    // min(H=3, n=2, w=3, nw=3) = 2
    expect(corners.rightH).toBe(2);  // min(H=3, n=2, e=3, ne=3) = 2
    expect(corners.bottomH).toBe(3);
    expect(corners.leftH).toBe(3);
  });

  it("E-lower (H=3, e=2, others=3) → rightH=2, bottomH=2, topH=3, leftH=3", () => {
    const { terrain, cx, cy } = makeGrid(3, 3, { e: 2 });
    const corners = tileCornerHeights(terrain, cx, cy);
    expect(corners.topH).toBe(3);
    expect(corners.rightH).toBe(2);  // min(H=3, n=3, e=2, ne=3) = 2
    expect(corners.bottomH).toBe(2); // min(H=3, e=2, s=3, se=3) = 2
    expect(corners.leftH).toBe(3);
  });

  it("W-lower (H=3, w=2, others=3) → topH=2, leftH=2, rightH=3, bottomH=3", () => {
    const { terrain, cx, cy } = makeGrid(3, 3, { w: 2 });
    const corners = tileCornerHeights(terrain, cx, cy);
    expect(corners.topH).toBe(2);    // min(H=3, n=3, w=2, nw=3) = 2
    expect(corners.rightH).toBe(3);
    expect(corners.bottomH).toBe(3);
    expect(corners.leftH).toBe(2);   // min(H=3, s=3, w=2, sw=3) = 2
  });
});

describe("tileCornerHeights — diagonal drops", () => {
  it("NE diagonal lower only (H=2, ne=1, others=2) → only rightH=1", () => {
    const { terrain, cx, cy } = makeGrid(2, 2, { ne: 1 });
    const corners = tileCornerHeights(terrain, cx, cy);
    expect(corners.topH).toBe(2);
    expect(corners.rightH).toBe(1);  // min(H=2, n=2, e=2, ne=1) = 1
    expect(corners.bottomH).toBe(2);
    expect(corners.leftH).toBe(2);
  });
});

describe("tileCornerHeights — 2-step cliff", () => {
  it("H=3; n=ne=e=nw=w=3, s=sw=se=1 → topH=3, rightH=3, bottomH=1, leftH=1", () => {
    const { terrain, cx, cy } = makeGrid(3, 3, { s: 1, sw: 1, se: 1 });
    const corners = tileCornerHeights(terrain, cx, cy);
    expect(corners.topH).toBe(3);
    expect(corners.rightH).toBe(3);
    expect(corners.bottomH).toBe(1); // min(H=3, e=3, s=1, se=1) = 1
    expect(corners.leftH).toBe(1);   // min(H=3, s=1, w=3, sw=1) = 1
  });
});

describe("tileCornerHeights — OOB substitution", () => {
  it("corner tile (0,0) with H=3, e=2, s=2, se=2; OOB neighbors → H=3", () => {
    // On a 5x5 map, (0,0) has OOB: N (0,-1), W (-1,0), NW (-1,-1), NE (1,-1), SW (-1,1)
    // All OOB → substitute H=3.
    const terrain = new Terrain(5, 5);
    terrain.unsafeSetElevation(0, 0, 3); // H
    terrain.unsafeSetElevation(1, 0, 2); // e
    terrain.unsafeSetElevation(0, 1, 2); // s
    terrain.unsafeSetElevation(1, 1, 2); // se
    // n, w, nw, ne, sw are all OOB → substitute H=3

    const corners = tileCornerHeights(terrain, 0, 0);
    // topH    = min(H=3, n=3(OOB), w=3(OOB), nw=3(OOB)) = 3
    // rightH  = min(H=3, n=3(OOB), e=2, ne=3(OOB)) = 2
    // bottomH = min(H=3, e=2, s=2, se=2) = 2
    // leftH   = min(H=3, s=2, w=3(OOB), sw=3(OOB)) = 2
    expect(corners.topH).toBe(3);
    expect(corners.rightH).toBe(2);
    expect(corners.bottomH).toBe(2);
    expect(corners.leftH).toBe(2);
  });
});

describe("tileCornerHeights — continuity", () => {
  // For tiles A=(x,y), B=(x+1,y), C=(x,y+1):
  //   A.rightH === B.topH   (shared NE/NW corner of adjacent tiles)
  //   A.bottomH === B.leftH (shared SE/SW corner)
  //   A.bottomH === C.rightH (shared SE/NE corner)
  //   A.leftH === C.topH    (shared SW/NW corner)

  function checkContinuity(terrain: Terrain, label: string): void {
    const w = terrain.getWidth();
    const h = terrain.getHeight();
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const A = tileCornerHeights(terrain, x, y);
        const B = tileCornerHeights(terrain, x + 1, y);
        const C = tileCornerHeights(terrain, x, y + 1);

        expect(A.rightH, `${label}: A(${x},${y}).rightH === B(${x+1},${y}).topH`).toBe(B.topH);
        expect(A.bottomH, `${label}: A(${x},${y}).bottomH === B(${x+1},${y}).leftH`).toBe(B.leftH);
        expect(A.bottomH, `${label}: A(${x},${y}).bottomH === C(${x},${y+1}).rightH`).toBe(C.rightH);
        expect(A.leftH, `${label}: A(${x},${y}).leftH === C(${x},${y+1}).topH`).toBe(C.topH);
      }
    }
  }

  it("flat terrain — all zeros", () => {
    const terrain = new Terrain(5, 5);
    checkContinuity(terrain, "flat");
  });

  it("cardinal-drop — single column elevated", () => {
    const terrain = new Terrain(5, 5);
    for (let y = 0; y < 5; y++) {
      terrain.unsafeSetElevation(2, y, 2);
    }
    checkContinuity(terrain, "cardinal-drop");
  });

  it("diagonal-drop — single cell elevated", () => {
    const terrain = new Terrain(5, 5);
    terrain.unsafeSetElevation(2, 2, 3);
    checkContinuity(terrain, "diagonal-drop");
  });

  it("mixed — checkerboard of elevations 0 and 2", () => {
    const terrain = new Terrain(5, 5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        if ((x + y) % 2 === 0) {
          terrain.unsafeSetElevation(x, y, 2);
        }
      }
    }
    checkContinuity(terrain, "mixed");
  });
});
