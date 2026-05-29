import { describe, it, expect } from 'vitest';
import {
  BODY_HEIGHT_PX,
  CHIMNEY_HEIGHT_PX,
  powerPlantCubeSpecs,
  powerPlantCubeFaces,
} from './powerPlantGeometry';
import { tileToScreen, ISO_CONFIG } from '@/game/render/IsoTransform';
import { rectangularUnionTopPolygon } from './cubeGeometry';

// ─── (d) constant invariant ────────────────────────────────────────────────

describe('height constants', () => {
  it('CHIMNEY_HEIGHT_PX > BODY_HEIGHT_PX', () => {
    expect(CHIMNEY_HEIGHT_PX).toBeGreaterThan(BODY_HEIGHT_PX);
  });
});

// ─── spec composition ─────────────────────────────────────────────────────

describe('powerPlantCubeSpecs', () => {
  const anchor = { x: 3, y: 5 };
  const specs = powerPlantCubeSpecs(anchor);

  // (a) fixed composition: exactly 1 body + 2 chimneys
  it('returns exactly 3 specs', () => {
    expect(specs.length).toBe(3);
  });

  // (b) exactly one body spec whose cells are the full 2×2 rect
  it('has exactly one body spec with full 2×2 cells', () => {
    const bodies = specs.filter((s) => s.role === 'body');
    expect(bodies.length).toBe(1);
    const body = bodies[0];
    expect(body.cells.length).toBe(4);

    const expected = new Set([
      `${anchor.x},${anchor.y}`,
      `${anchor.x + 1},${anchor.y}`,
      `${anchor.x},${anchor.y + 1}`,
      `${anchor.x + 1},${anchor.y + 1}`,
    ]);
    for (const c of body.cells) {
      expect(expected.has(`${c.x},${c.y}`)).toBe(true);
    }
  });

  it('body spec anchor equals structureAnchor', () => {
    const body = specs.find((s) => s.role === 'body')!;
    expect(body.anchor).toEqual(anchor);
  });

  it('body spec uses BODY_HEIGHT_PX', () => {
    const body = specs.find((s) => s.role === 'body')!;
    expect(body.heightPx).toBe(BODY_HEIGHT_PX);
  });

  // (c) every chimney spec's cells ⊆ the 2×2 footprint
  it('chimney cells are all within the 2×2 footprint', () => {
    const footprintSet = new Set([
      `${anchor.x},${anchor.y}`,
      `${anchor.x + 1},${anchor.y}`,
      `${anchor.x},${anchor.y + 1}`,
      `${anchor.x + 1},${anchor.y + 1}`,
    ]);
    const chimneys = specs.filter((s) => s.role === 'chimney');
    expect(chimneys.length).toBeGreaterThanOrEqual(1);
    for (const chimney of chimneys) {
      for (const c of chimney.cells) {
        expect(footprintSet.has(`${c.x},${c.y}`)).toBe(true);
      }
    }
  });

  it('chimney specs use CHIMNEY_HEIGHT_PX', () => {
    const chimneys = specs.filter((s) => s.role === 'chimney');
    for (const c of chimneys) {
      expect(c.heightPx).toBe(CHIMNEY_HEIGHT_PX);
    }
  });

  // (e) translation invariance: different anchor shifts cells by the same delta
  it('cells shift correctly when anchor changes', () => {
    const anchor2 = { x: anchor.x + 10, y: anchor.y + 7 };
    const specs2 = powerPlantCubeSpecs(anchor2);

    expect(specs2.length).toBe(specs.length);

    for (let i = 0; i < specs.length; i++) {
      const s1 = specs[i];
      const s2 = specs2[i];
      expect(s2.cells.length).toBe(s1.cells.length);
      for (let j = 0; j < s1.cells.length; j++) {
        expect(s2.cells[j].x - s1.cells[j].x).toBe(10);
        expect(s2.cells[j].y - s1.cells[j].y).toBe(7);
      }
    }
  });
});

// ─── face geometry ─────────────────────────────────────────────────────────

describe('powerPlantCubeFaces', () => {
  const anchor = { x: 2, y: 4 };
  const specs = powerPlantCubeSpecs(anchor);
  const bodySpec = specs.find((s) => s.role === 'body')!;
  const chimneySpecs = specs.filter((s) => s.role === 'chimney');

  // (f) + (g): body spec — vertex counts, top is lifted
  it('body spec returns top[4], left[4], right[4]', () => {
    const faces = powerPlantCubeFaces(bodySpec, anchor);
    expect(faces.top.length).toBe(4);
    expect(faces.left.length).toBe(4);
    expect(faces.right.length).toBe(4);
  });

  it('body N vertex at origin anchor is (0, -BODY_HEIGHT_PX)', () => {
    // With structureAnchor = anchor, body anchor = anchor too, so dx=dy=0.
    // rectangularUnionTopPolygon returns N={x:0,y:0} for the 2×2 rect.
    // After lift: N = {x:0, y:0 - BODY_HEIGHT_PX}.
    const originAnchor = { x: 0, y: 0 };
    const originSpecs = powerPlantCubeSpecs(originAnchor);
    const originBody = originSpecs.find((s) => s.role === 'body')!;
    const faces = powerPlantCubeFaces(originBody, originAnchor);
    expect(faces.top[0]).toEqual({ x: 0, y: -BODY_HEIGHT_PX });
  });

  it('body top face is lifted above unlifted union', () => {
    const faces = powerPlantCubeFaces(bodySpec, anchor);
    // Get the unlifted union polygon — it is returned in spec-anchor-local coords.
    const rawUnion = rectangularUnionTopPolygon(bodySpec.cells, bodySpec.anchor)!;
    const unlifted = [rawUnion.N, rawUnion.E, rawUnion.S, rawUnion.W];
    const minUnliftedY = Math.min(...unlifted.map((p) => p.y));
    const minTopY = Math.min(...faces.top.map((p) => p.y));
    expect(minTopY).toBeLessThan(minUnliftedY);
  });

  // (f): chimney on a non-NW corner is offset away from origin by expected tileToScreen delta
  it('chimney spec on NE corner is offset by tileToScreen(chimneyAnchor) - tileToScreen(structureAnchor)', () => {
    // The NE chimney is at (anchor.x+1, anchor.y)
    const neChimney = chimneySpecs.find(
      (s) => s.anchor.x === anchor.x + 1 && s.anchor.y === anchor.y,
    );
    expect(neChimney).toBeDefined();

    const faces = powerPlantCubeFaces(neChimney!, anchor);
    expect(faces.top.length).toBe(4);
    expect(faces.left.length).toBe(4);
    expect(faces.right.length).toBe(4);

    // The expected offset from structure anchor to this chimney's screen position.
    const structScreen = tileToScreen(anchor);
    const chimneyScreen = tileToScreen(neChimney!.anchor);
    const expectedDx = chimneyScreen.x - structScreen.x;
    const expectedDy = chimneyScreen.y - structScreen.y;

    // NE chimney anchor = (anchor.x+1, anchor.y) → screen delta should be non-zero.
    // tileToScreen({x+1, y}) = ((x+1-y)*hw, (x+1+y)*hh) vs ((x-y)*hw, (x+y)*hh)
    // delta = (hw, hh) = (32, 16)
    expect(expectedDx).toBe(ISO_CONFIG.TILE_WIDTH / 2);
    expect(expectedDy).toBe(ISO_CONFIG.TILE_HEIGHT / 2);

    // The unlifted S point of a single cell diamond (the bottom vertex) is at
    // (0, TILE_HEIGHT) in spec-anchor-local, so in structure-local it is at
    // (expectedDx + 0, expectedDy + TILE_HEIGHT) = (expectedDx, expectedDy + TILE_HEIGHT).
    // After lifting, top face S (index 2) should be at y = expectedDy + TILE_HEIGHT - lift.
    const liftedSy = expectedDy + ISO_CONFIG.TILE_HEIGHT - CHIMNEY_HEIGHT_PX;
    // top[2] = S vertex in our convention
    expect(faces.top[2].y).toBeCloseTo(liftedSy);
    // And the x offset of the top N vertex should equal expectedDx (no horizontal shift from lift)
    expect(faces.top[0].x).toBeCloseTo(expectedDx);
  });

  it('chimney spec on SW corner is offset by expected tileToScreen delta', () => {
    const swChimney = chimneySpecs.find(
      (s) => s.anchor.x === anchor.x && s.anchor.y === anchor.y + 1,
    );
    expect(swChimney).toBeDefined();

    const faces = powerPlantCubeFaces(swChimney!, anchor);
    expect(faces.top.length).toBe(4);

    // tileToScreen({x, y+1}) vs tileToScreen({x, y}): delta = (-hw, hh)
    const structScreen = tileToScreen(anchor);
    const chimneyScreen = tileToScreen(swChimney!.anchor);
    const expectedDx = chimneyScreen.x - structScreen.x;
    const expectedDy = chimneyScreen.y - structScreen.y;

    expect(expectedDx).toBe(-(ISO_CONFIG.TILE_WIDTH / 2));
    expect(expectedDy).toBe(ISO_CONFIG.TILE_HEIGHT / 2);

    // N vertex of this chimney's top face should be at (expectedDx, expectedDy - lift)
    expect(faces.top[0].x).toBeCloseTo(expectedDx);
    expect(faces.top[0].y).toBeCloseTo(expectedDy - CHIMNEY_HEIGHT_PX);
  });

  // (g) left/right side quads correctly connect top face bottom vertices to ground
  it('left face bottom vertices close back to unlifted level', () => {
    const faces = powerPlantCubeFaces(bodySpec, anchor);
    const lift = BODY_HEIGHT_PX;
    // left[2] and left[3] should be lift lower than left[1] and left[0]
    expect(faces.left[2].y).toBeCloseTo(faces.left[1].y + lift);
    expect(faces.left[3].y).toBeCloseTo(faces.left[0].y + lift);
  });

  it('right face bottom vertices close back to unlifted level', () => {
    const faces = powerPlantCubeFaces(bodySpec, anchor);
    const lift = BODY_HEIGHT_PX;
    expect(faces.right[2].y).toBeCloseTo(faces.right[1].y + lift);
    expect(faces.right[3].y).toBeCloseTo(faces.right[0].y + lift);
  });
});
