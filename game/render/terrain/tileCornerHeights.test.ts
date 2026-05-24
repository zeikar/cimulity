import { describe, it, expect } from "vitest";
import { Terrain } from "@/game/core/Terrain";
import { tileCornerHeights } from "./tileCornerHeights";

describe("tileCornerHeights — vertex-smooth direct reads", () => {
  it("maps tile corners directly to shared vertices", () => {
    const terrain = new Terrain(4, 4);
    terrain.unsafeSetVertexHeight(2, 3, 2);
    terrain.unsafeSetVertexHeight(3, 3, 4);
    terrain.unsafeSetVertexHeight(3, 4, 5);
    terrain.unsafeSetVertexHeight(2, 4, 1);

    expect(tileCornerHeights(terrain, 2, 3)).toEqual({
      topH: 2,
      rightH: 4,
      bottomH: 5,
      leftH: 1,
    });
  });

  it("adjacent tiles share identical corner values by reading the same vertices", () => {
    const terrain = new Terrain(4, 4);
    terrain.unsafeSetVertexHeight(2, 1, 6);
    terrain.unsafeSetVertexHeight(2, 2, 3);

    const west = tileCornerHeights(terrain, 1, 1);
    const east = tileCornerHeights(terrain, 2, 1);

    expect(west.rightH).toBe(east.topH);
    expect(west.bottomH).toBe(east.leftH);
  });

  it("raising a single tile's four vertices is visible on that tile", () => {
    const terrain = new Terrain(4, 4);
    for (const [vx, vy] of [[1, 1], [2, 1], [2, 2], [1, 2]] as const) {
      terrain.unsafeSetVertexHeight(vx, vy, 2);
    }

    expect(tileCornerHeights(terrain, 1, 1)).toEqual({
      topH: 2,
      rightH: 2,
      bottomH: 2,
      leftH: 2,
    });
    expect(tileCornerHeights(terrain, 0, 1).rightH).toBe(2);
  });
});
