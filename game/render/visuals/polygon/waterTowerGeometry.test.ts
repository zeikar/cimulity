import { describe, it, expect } from 'vitest';
import {
  BODY_HEIGHT_PX,
  TANK_HEIGHT_PX,
  waterTowerCubeSpecs,
  waterTowerCubeFaces,
} from './waterTowerGeometry';
import { tileToScreen, ISO_CONFIG } from '@/game/render/IsoTransform';
import { rectangularUnionTopPolygon } from './cubeGeometry';

// ─── height constants ──────────────────────────────────────────────────────

describe('height constants', () => {
  it('the tank rises taller than the body, giving the silhouette its water-tower profile', () => {
    expect(TANK_HEIGHT_PX).toBeGreaterThan(BODY_HEIGHT_PX);
  });
});

// ─── spec composition ─────────────────────────────────────────────────────

describe('waterTowerCubeSpecs', () => {
  const anchor = { x: 3, y: 5 };
  const specs = waterTowerCubeSpecs(anchor);

  it('returns exactly 2 specs (1 body + 1 tank)', () => {
    expect(specs.length).toBe(2);
  });

  it('has exactly one body spec', () => {
    const bodies = specs.filter((s) => s.role === 'body');
    expect(bodies.length).toBe(1);
  });

  it('has exactly one tank spec', () => {
    const tanks = specs.filter((s) => s.role === 'tank');
    expect(tanks.length).toBe(1);
  });

  it('body spec covers the single anchor cell (1×1)', () => {
    const body = specs.find((s) => s.role === 'body')!;
    expect(body.cells.length).toBe(1);
    expect(body.cells[0]).toEqual(anchor);
  });

  it('body spec anchor equals structureAnchor', () => {
    const body = specs.find((s) => s.role === 'body')!;
    expect(body.anchor).toEqual(anchor);
  });

  it('body spec uses BODY_HEIGHT_PX and baseHeightPx 0', () => {
    const body = specs.find((s) => s.role === 'body')!;
    expect(body.heightPx).toBe(BODY_HEIGHT_PX);
    expect(body.baseHeightPx).toBe(0);
  });

  it('tank spec has exactly one cell at the NW corner (structureAnchor)', () => {
    const tank = specs.find((s) => s.role === 'tank')!;
    expect(tank.cells.length).toBe(1);
    // Tank is anchored at NW corner = structureAnchor (concrete integer cell)
    expect(tank.cells[0]).toEqual(anchor);
    expect(tank.anchor).toEqual(anchor);
  });

  it('tank spec uses TANK_HEIGHT_PX and baseHeightPx BODY_HEIGHT_PX', () => {
    const tank = specs.find((s) => s.role === 'tank')!;
    expect(tank.heightPx).toBe(TANK_HEIGHT_PX);
    expect(tank.baseHeightPx).toBe(BODY_HEIGHT_PX);
  });

  // Translation invariance: different anchor shifts all cells by the same delta.
  it('cells shift correctly when anchor changes', () => {
    const anchor2 = { x: anchor.x + 10, y: anchor.y + 7 };
    const specs2 = waterTowerCubeSpecs(anchor2);

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

// ─── face geometry ────────────────────────────────────────────────────────

describe('waterTowerCubeFaces', () => {
  const anchor = { x: 2, y: 4 };
  const specs = waterTowerCubeSpecs(anchor);
  const bodySpec = specs.find((s) => s.role === 'body')!;
  const tankSpec = specs.find((s) => s.role === 'tank')!;

  it('body spec returns top[4], left[4], right[4]', () => {
    const faces = waterTowerCubeFaces(bodySpec, anchor);
    expect(faces.top.length).toBe(4);
    expect(faces.left.length).toBe(4);
    expect(faces.right.length).toBe(4);
  });

  it('tank spec returns top[4], left[4], right[4]', () => {
    const faces = waterTowerCubeFaces(tankSpec, anchor);
    expect(faces.top.length).toBe(4);
    expect(faces.left.length).toBe(4);
    expect(faces.right.length).toBe(4);
  });

  it('body N vertex at origin anchor is (0, -BODY_HEIGHT_PX)', () => {
    // With structureAnchor = (0,0), body anchor = (0,0) too, so dx=dy=0.
    // rectangularUnionTopPolygon returns N={x:0,y:0} for the 2×2 rect.
    // After lift: N = {x:0, y: -BODY_HEIGHT_PX}.
    const originAnchor = { x: 0, y: 0 };
    const originSpecs = waterTowerCubeSpecs(originAnchor);
    const originBody = originSpecs.find((s) => s.role === 'body')!;
    const faces = waterTowerCubeFaces(originBody, originAnchor);
    expect(faces.top[0]).toEqual({ x: 0, y: -BODY_HEIGHT_PX });
  });

  it('body top face is lifted above unlifted union', () => {
    const faces = waterTowerCubeFaces(bodySpec, anchor);
    const rawUnion = rectangularUnionTopPolygon(bodySpec.cells, bodySpec.anchor)!;
    const unlifted = [rawUnion.N, rawUnion.E, rawUnion.S, rawUnion.W];
    const minUnliftedY = Math.min(...unlifted.map((p) => p.y));
    const minTopY = Math.min(...faces.top.map((p) => p.y));
    expect(minTopY).toBeLessThan(minUnliftedY);
  });

  it('body left face bottom vertices descend by BODY_HEIGHT_PX', () => {
    const faces = waterTowerCubeFaces(bodySpec, anchor);
    expect(faces.left[2].y).toBeCloseTo(faces.left[1].y + BODY_HEIGHT_PX);
    expect(faces.left[3].y).toBeCloseTo(faces.left[0].y + BODY_HEIGHT_PX);
  });

  it('body right face bottom vertices descend by BODY_HEIGHT_PX', () => {
    const faces = waterTowerCubeFaces(bodySpec, anchor);
    expect(faces.right[2].y).toBeCloseTo(faces.right[1].y + BODY_HEIGHT_PX);
    expect(faces.right[3].y).toBeCloseTo(faces.right[0].y + BODY_HEIGHT_PX);
  });

  it('tank is lifted above the body (totalLift = BODY_HEIGHT_PX + TANK_HEIGHT_PX)', () => {
    const originAnchor = { x: 0, y: 0 };
    const originSpecs = waterTowerCubeSpecs(originAnchor);
    const originTank = originSpecs.find((s) => s.role === 'tank')!;
    const faces = waterTowerCubeFaces(originTank, originAnchor);
    // Tank top N vertex (index 0) for a single-cell diamond at (0,0) is (0,0) unlifted.
    // After total lift = BODY_HEIGHT_PX + TANK_HEIGHT_PX, N.y = -(BODY_HEIGHT_PX + TANK_HEIGHT_PX).
    expect(faces.top[0].y).toBeCloseTo(-(BODY_HEIGHT_PX + TANK_HEIGHT_PX));
  });

  it('tank side walls descend by TANK_HEIGHT_PX only, not total lift', () => {
    // Guards against the bug where side faces close back to ground instead of body roof.
    const originAnchor = { x: 0, y: 0 };
    const originSpecs = waterTowerCubeSpecs(originAnchor);
    const originTank = originSpecs.find((s) => s.role === 'tank')!;
    const faces = waterTowerCubeFaces(originTank, originAnchor);
    expect(faces.left[2].y).toBeCloseTo(faces.left[1].y + TANK_HEIGHT_PX);
    expect(faces.left[3].y).toBeCloseTo(faces.left[0].y + TANK_HEIGHT_PX);
  });

  it('tank bottom (left side lower edge) sits at body roof, not tile plane', () => {
    const originAnchor = { x: 0, y: 0 };
    const originSpecs = waterTowerCubeSpecs(originAnchor);
    const originBody = originSpecs.find((s) => s.role === 'body')!;
    const originTank = originSpecs.find((s) => s.role === 'tank')!;

    const tankFaces = waterTowerCubeFaces(originTank, originAnchor);

    // Tank totalLift > body totalLift confirms the tank top is above the body roof.
    const tankTotalLift = originTank.baseHeightPx + originTank.heightPx;
    const bodyTotalLift = originBody.baseHeightPx + originBody.heightPx;
    expect(tankTotalLift).toBeGreaterThan(bodyTotalLift);

    // For origin anchor (0,0), the 1×1 tank cell W vertex (unlifted) is at
    // (-hw, hh) = (-32, 16). After total lift = BODY_HEIGHT_PX + TANK_HEIGHT_PX,
    // left[1] (W top) y = 16 - (BODY_HEIGHT_PX + TANK_HEIGHT_PX).
    // left[2] (W bottom) = left[1].y + TANK_HEIGHT_PX = 16 - BODY_HEIGHT_PX.
    // This equals the unlifted W.y minus BODY_HEIGHT_PX, which is the body roof height
    // at that tile-plane point — confirming the tank bottom lands on the body roof.
    const hh = ISO_CONFIG.TILE_HEIGHT / 2;
    const expectedTankBottomWy = hh - BODY_HEIGHT_PX;
    expect(tankFaces.left[2].y).toBeCloseTo(expectedTankBottomWy);
  });

  // Screen-offset test: tank at NW corner (same as structureAnchor) has dx=dy=0.
  it('tank at NW corner has zero screen offset from structureAnchor', () => {
    const structScreen = tileToScreen(anchor);
    const tankScreen = tileToScreen(tankSpec.anchor);
    // Tank anchor equals structureAnchor for this water tower.
    expect(tankScreen.x - structScreen.x).toBe(0);
    expect(tankScreen.y - structScreen.y).toBe(0);
  });

  it('body iso geometry: N vertex x is 0 for origin anchor (no horizontal shift from lift)', () => {
    const originAnchor = { x: 0, y: 0 };
    const originSpecs = waterTowerCubeSpecs(originAnchor);
    const originBody = originSpecs.find((s) => s.role === 'body')!;
    const faces = waterTowerCubeFaces(originBody, originAnchor);
    expect(faces.top[0].x).toBeCloseTo(0);
  });
});
