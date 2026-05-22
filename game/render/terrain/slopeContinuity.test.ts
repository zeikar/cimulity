import { describe, it, expect } from 'vitest';
import { Terrain } from '@/game/core';
import { projectTileCornerScreen } from '../IsoTransform';
import { tileCornerHeights } from './tileCornerHeights';

function projectAll(terrain: Terrain, x: number, y: number) {
  const c = tileCornerHeights(terrain, x, y);
  return {
    top:    projectTileCornerScreen({ x, y }, 'top',    c.topH),
    right:  projectTileCornerScreen({ x, y }, 'right',  c.rightH),
    bottom: projectTileCornerScreen({ x, y }, 'bottom', c.bottomH),
    left:   projectTileCornerScreen({ x, y }, 'left',   c.leftH),
  };
}

function assertShared(terrain: Terrain, x: number, y: number): void {
  const a     = projectAll(terrain, x,     y);
  const east  = projectAll(terrain, x + 1, y);
  const south = projectAll(terrain, x,     y + 1);

  // East neighbor B=(x+1,y): A.right === B.top, A.bottom === B.left
  expect(a.right).toEqual(east.top);
  expect(a.bottom).toEqual(east.left);

  // South neighbor C=(x,y+1): A.bottom === C.right, A.left === C.top
  expect(a.bottom).toEqual(south.right);
  expect(a.left).toEqual(south.top);
}

function flat(size: number, h: number): Terrain {
  const t = new Terrain(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      t.unsafeSetElevation(x, y, h);
    }
  }
  return t;
}

describe('slope continuity — shared corners project to identical screen points', () => {
  it('all-flat plateau at H=2', () => {
    const t = flat(5, 2);
    assertShared(t, 2, 2);
  });

  it('cardinal-S lower: south neighbor of center at H=1, rest at H=2', () => {
    const t = flat(5, 2);
    // Drop only (2,3) — the s neighbor of center (2,2).
    t.unsafeSetElevation(2, 3, 1);
    assertShared(t, 2, 2);
  });

  it('2-step cliff: center at H=3, se/s/sw/e corners forced down to H=1', () => {
    const t = flat(5, 3);
    // Lower a cluster so tileCornerHeights produces varied corner values.
    t.unsafeSetElevation(3, 3, 1); // se of (2,2)
    t.unsafeSetElevation(2, 3, 1); // s  of (2,2)
    t.unsafeSetElevation(1, 3, 1); // sw of (2,2)
    assertShared(t, 2, 2);
  });

  it('diagonal drop: ne neighbor of center lowered to H=1', () => {
    const t = flat(5, 2);
    t.unsafeSetElevation(3, 1, 1); // ne of (2,2)
    assertShared(t, 2, 2);
  });
});
