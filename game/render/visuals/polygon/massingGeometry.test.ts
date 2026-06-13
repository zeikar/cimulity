import { describe, it, expect } from 'vitest';
import { fracToLocal, massingBoxFaces, massingGableFaces } from './massingGeometry';
import { ISO_CONFIG } from '@/game/render/IsoTransform';

const HW = ISO_CONFIG.TILE_WIDTH / 2; // 32
const HH = ISO_CONFIG.TILE_HEIGHT / 2; // 16

// ---------------------------------------------------------------------------
// fracToLocal
// ---------------------------------------------------------------------------

describe('fracToLocal', () => {
  it('projects tile-unit steps onto the iso axes', () => {
    expect(fracToLocal(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(fracToLocal(1, 0, 0)).toEqual({ x: HW, y: HH });
    expect(fracToLocal(0, 1, 0)).toEqual({ x: -HW, y: HH });
    expect(fracToLocal(1, 1, 0)).toEqual({ x: 0, y: 2 * HH });
  });

  it('handles fractional coordinates linearly', () => {
    expect(fracToLocal(0.5, 0.5, 0)).toEqual({ x: 0, y: HH });
    expect(fracToLocal(1.5, 0.5, 0)).toEqual({ x: HW, y: 2 * HH });
  });

  it('subtracts lift from screen y only', () => {
    expect(fracToLocal(1, 0, 10)).toEqual({ x: HW, y: HH - 10 });
  });
});

// ---------------------------------------------------------------------------
// massingBoxFaces
// ---------------------------------------------------------------------------

describe('massingBoxFaces', () => {
  const unit = { x0: 0, y0: 0, x1: 1, y1: 1 };

  it('builds the unit-tile box with cubeGeometry vertex conventions', () => {
    const f = massingBoxFaces(unit, 0, 10);
    // top = [N, E, S, W] lifted by height.
    expect(f.top).toEqual([
      { x: 0, y: -10 },
      { x: HW, y: HH - 10 },
      { x: 0, y: 2 * HH - 10 },
      { x: -HW, y: HH - 10 },
    ]);
    // left = [S, W, W+h, S+h]; right = [E, S, S+h, E+h].
    expect(f.left).toEqual([
      f.top[2],
      f.top[3],
      { x: f.top[3].x, y: f.top[3].y + 10 },
      { x: f.top[2].x, y: f.top[2].y + 10 },
    ]);
    expect(f.right).toEqual([
      f.top[1],
      f.top[2],
      { x: f.top[2].x, y: f.top[2].y + 10 },
      { x: f.top[1].x, y: f.top[1].y + 10 },
    ]);
  });

  it('raises the whole box by baseLift while wall bottoms stay baseLift above ground', () => {
    const grounded = massingBoxFaces(unit, 0, 10);
    const lifted = massingBoxFaces(unit, 5, 10);
    for (let i = 0; i < 4; i++) {
      expect(lifted.top[i].x).toBe(grounded.top[i].x);
      expect(lifted.top[i].y).toBe(grounded.top[i].y - 5);
    }
    // Wall bottom = top + height, so bottoms sit baseLift above the plane.
    expect(lifted.left[2].y).toBe(grounded.left[2].y - 5);
  });

  it('supports fractional sub-rects', () => {
    const f = massingBoxFaces({ x0: 0.5, y0: 0.5, x1: 1.5, y1: 1 }, 0, 8);
    expect(f.top[0]).toEqual({ x: 0, y: HH - 8 }); // N at (0.5, 0.5)
    expect(f.top[1]).toEqual({ x: HW, y: 2 * HH - 8 }); // E at (1.5, 0.5)
  });
});

// ---------------------------------------------------------------------------
// massingGableFaces
// ---------------------------------------------------------------------------

describe('massingGableFaces', () => {
  const rect = { x0: 0, y0: 0, x1: 2, y1: 1 };

  it('ridge x: apex tops the SE wall and slopes meet walls at the eaves', () => {
    const g = massingGableFaces(rect, 0, 10, 8, 'x');
    const apex = fracToLocal(2, 0.5, 18);
    expect(g.gable.side).toBe('SE');
    expect(g.gable.points[1]).toEqual(apex);
    // Gable triangle base = SE wall top edge.
    expect(g.gable.points[0]).toEqual(g.wallSE[0]);
    expect(g.gable.points[2]).toEqual(g.wallSE[1]);
    // Front slope eave = SW wall top edge (shared, no seam).
    expect(g.slopeFront[2]).toEqual(g.wallSW[0]);
    expect(g.slopeFront[3]).toEqual(g.wallSW[1]);
    // Walls drop by wallHeight.
    expect(g.wallSW[2].y - g.wallSW[1].y).toBe(10);
    expect(g.wallSE[3].y - g.wallSE[0].y).toBe(10);
  });

  it('ridge y: apex tops the SW wall', () => {
    const g = massingGableFaces({ x0: 0, y0: 0, x1: 1, y1: 2 }, 0, 10, 8, 'y');
    expect(g.gable.side).toBe('SW');
    expect(g.gable.points[1]).toEqual(fracToLocal(0.5, 2, 18));
    expect(g.gable.points[0]).toEqual(g.wallSW[0]);
    expect(g.gable.points[2]).toEqual(g.wallSW[1]);
  });

  it('hides the back slope once the rise makes it back-facing', () => {
    // Threshold: rise < (yc - y0) * TILE_HEIGHT = 0.5 * 32 = 16.
    expect(massingGableFaces(rect, 0, 10, 15, 'x').slopeBack).not.toBeNull();
    expect(massingGableFaces(rect, 0, 10, 16, 'x').slopeBack).toBeNull();
    // Same threshold along the other axis: (xc - x0) * 32 = 16.
    const tall = { x0: 0, y0: 0, x1: 1, y1: 2 };
    expect(massingGableFaces(tall, 0, 10, 7, 'y').slopeBack).not.toBeNull();
    expect(massingGableFaces(tall, 0, 10, 16, 'y').slopeBack).toBeNull();
  });

  it('orders slope quads with the top edge parallel to the ridge (texture fill convention)', () => {
    const gx = massingGableFaces(rect, 0, 10, 8, 'x');
    expect(gx.slopeFront[0]).toEqual(fracToLocal(0, 0.5, 18));
    expect(gx.slopeFront[1]).toEqual(fracToLocal(2, 0.5, 18));
    const gy = massingGableFaces({ x0: 0, y0: 0, x1: 1, y1: 2 }, 0, 10, 8, 'y');
    expect(gy.slopeFront[0]).toEqual(fracToLocal(0.5, 0, 18));
    expect(gy.slopeFront[1]).toEqual(fracToLocal(0.5, 2, 18));
  });

  it('applies baseLift to every face', () => {
    const grounded = massingGableFaces(rect, 0, 10, 8, 'x');
    const lifted = massingGableFaces(rect, 6, 10, 8, 'x');
    expect(lifted.gable.points[1].y).toBe(grounded.gable.points[1].y - 6);
    expect(lifted.slopeFront[0].y).toBe(grounded.slopeFront[0].y - 6);
    expect(lifted.wallSW[0].y).toBe(grounded.wallSW[0].y - 6);
  });
});
