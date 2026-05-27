import { describe, it, expect } from 'vitest';
import {
  composeFacade,
  facadeTintFor,
  FACADE_TINT_PALETTES,
  type FacadeComposerInput,
} from './facadeComposer';

type BuildingType = 'residential' | 'commercial' | 'industrial';
type Frontage = 'N' | 'S' | 'E' | 'W';

function rectFootprint(
  w: number,
  h: number,
): ReadonlyArray<{ x: number; y: number }> {
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells.push({ x, y });
    }
  }
  return cells;
}

function makeInput(overrides: Partial<FacadeComposerInput> = {}): FacadeComposerInput {
  return {
    buildingId: 1,
    type: 'residential',
    level: 2,
    density: 1,
    footprint: rectFootprint(2, 2),
    anchor: { x: 0, y: 0 },
    frontage: 'S',
    ...overrides,
  };
}

describe('composeFacade — determinism', () => {
  it('returns identical output for same input across 100 trials', () => {
    const input = makeInput({
      buildingId: 12345,
      level: 3,
      footprint: rectFootprint(3, 4),
      frontage: 'E',
    });
    const baseline = JSON.stringify(composeFacade(input));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(composeFacade(input))).toBe(baseline);
    }
  });

  it('different buildingIds yield distinct placements (>=25/50 distinct, 4x4 level=3 frontage=N)', () => {
    const signatures = new Set<string>();
    for (let id = 1; id <= 50; id++) {
      const out = composeFacade(
        makeInput({
          buildingId: id,
          level: 3,
          footprint: rectFootprint(4, 4),
          frontage: 'N',
        }),
      );
      signatures.add(JSON.stringify(out.placements));
    }
    expect(signatures.size).toBeGreaterThanOrEqual(25);
  });
});

describe('composeFacade — face sizes', () => {
  it('left/right/top sizes match rectilinear formula', () => {
    const out = composeFacade(
      makeInput({
        level: 5,
        footprint: rectFootprint(3, 4),
      }),
    );
    expect(out.faceSizes.left).toEqual({ w: 3 * 64, h: 5 * 24 });
    expect(out.faceSizes.right).toEqual({ w: 4 * 64, h: 5 * 24 });
    expect(out.faceSizes.top).toEqual({ w: 3 * 64, h: 4 * 16 });
  });
});

describe('composeFacade — frontage / door plumbing', () => {
  const shapes: Array<{ w: number; h: number }> = [
    { w: 1, h: 1 },
    { w: 2, h: 3 },
    { w: 4, h: 4 },
  ];
  const frontages: Frontage[] = ['N', 'S', 'E', 'W'];
  const levels = [1, 2, 3];

  for (const shape of shapes) {
    for (const frontage of frontages) {
      for (const level of levels) {
        it(`shape=${shape.w}x${shape.h} frontage=${frontage} level=${level}: door rule honored`, () => {
          const out = composeFacade(
            makeInput({
              buildingId: 42,
              level,
              footprint: rectFootprint(shape.w, shape.h),
              frontage,
            }),
          );
          const doors = out.placements.filter((p) =>
            p.moduleId.startsWith('door.'),
          );
          if (frontage === 'S') {
            expect(doors.length).toBe(1);
            expect(doors[0].face).toBe('left');
            expect(doors[0].y).toBe(0);
            const widthCells = shape.w;
            expect(doors[0].x).toBe(Math.floor((widthCells - 1) / 2) * 64);
          } else if (frontage === 'E') {
            expect(doors.length).toBe(1);
            expect(doors[0].face).toBe('right');
            expect(doors[0].y).toBe(0);
            const widthCells = shape.h;
            expect(doors[0].x).toBe(Math.floor((widthCells - 1) / 2) * 64);
          } else {
            expect(doors.length).toBe(0);
          }
        });
      }
    }
  }
});

describe('composeFacade — side placements', () => {
  it('every (cellIndex, floorIndex) slot is filled exactly once per side', () => {
    const w_cells = 3;
    const h_cells = 2;
    const level = 4;
    const out = composeFacade(
      makeInput({
        level,
        footprint: rectFootprint(w_cells, h_cells),
        frontage: 'N', // no door — keep all slots stochastic
      }),
    );

    const leftSlots = new Set<string>();
    const rightSlots = new Set<string>();
    let leftCount = 0;
    let rightCount = 0;

    for (const p of out.placements) {
      if (p.face === 'left') {
        leftCount++;
        leftSlots.add(`${p.x},${p.y}`);
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
      } else if (p.face === 'right') {
        rightCount++;
        rightSlots.add(`${p.x},${p.y}`);
      }
    }

    expect(leftCount).toBe(w_cells * level);
    expect(leftSlots.size).toBe(w_cells * level);
    expect(rightCount).toBe(h_cells * level);
    expect(rightSlots.size).toBe(h_cells * level);

    // Every left slot is wall or window (no door, frontage=N)
    for (const p of out.placements) {
      if (p.face === 'left' || p.face === 'right') {
        const ok =
          p.moduleId.startsWith('wall.') || p.moduleId.startsWith('window.');
        expect(ok).toBe(true);
      }
    }
  });

  it('door REPLACES wall/window at the chosen slot (S frontage, left face, ground centre)', () => {
    const w_cells = 4;
    const h_cells = 2;
    const level = 2;
    const out = composeFacade(
      makeInput({
        buildingId: 7,
        level,
        footprint: rectFootprint(w_cells, h_cells),
        frontage: 'S',
      }),
    );
    const centerCell = Math.floor((w_cells - 1) / 2);
    const targetX = centerCell * 64;
    const leftSlots = out.placements.filter(
      (p) => p.face === 'left' && p.x === targetX && p.y === 0,
    );
    expect(leftSlots.length).toBe(1);
    expect(leftSlots[0].moduleId).toBe('door.residential');

    // Side total still equals widthCells * level (no extra slot).
    const leftCount = out.placements.filter((p) => p.face === 'left').length;
    expect(leftCount).toBe(w_cells * level);
  });
});

describe('composeFacade — roof placements', () => {
  it('count equals w_cells * h_cells, all face=top, integer coords, no duplicates', () => {
    const w_cells = 5;
    const h_cells = 3;
    const out = composeFacade(
      makeInput({
        level: 2,
        footprint: rectFootprint(w_cells, h_cells),
      }),
    );
    const roofs = out.placements.filter((p) => p.face === 'top');
    expect(roofs.length).toBe(w_cells * h_cells);

    const coords = new Set<string>();
    for (const p of roofs) {
      expect(p.face).toBe('top');
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
      expect(p.moduleId).toBe('roof.flat.residential');
      const key = `${p.x},${p.y}`;
      expect(coords.has(key)).toBe(false);
      coords.add(key);
    }
    expect(coords.size).toBe(w_cells * h_cells);
  });
});

describe('composeFacade — module id formatting', () => {
  it('uses exact wall/window/door/roof id patterns per type & density', () => {
    const types: BuildingType[] = ['residential', 'commercial', 'industrial'];
    const densities: Array<0 | 1 | 2> = [0, 1, 2];
    for (const type of types) {
      for (const density of densities) {
        const out = composeFacade(
          makeInput({
            type,
            density,
            level: 2,
            footprint: rectFootprint(2, 2),
            frontage: 'S',
          }),
        );
        for (const p of out.placements) {
          if (p.face === 'top') {
            expect(p.moduleId).toBe(`roof.flat.${type}`);
          } else if (p.moduleId.startsWith('door.')) {
            expect(p.moduleId).toBe(`door.${type}`);
          } else if (p.moduleId.startsWith('window.')) {
            expect(p.moduleId).toBe(`window.${type}.${density}`);
          } else if (p.moduleId.startsWith('wall.')) {
            expect(p.moduleId).toBe(`wall.${type}.${density}`);
          } else {
            throw new Error(`unexpected moduleId: ${p.moduleId}`);
          }
        }
      }
    }
  });
});

describe('facadeTintFor', () => {
  it('returns the same tint for the same id (deterministic)', () => {
    for (let id = 1; id <= 20; id++) {
      const a = facadeTintFor({ id, type: 'residential' });
      const b = facadeTintFor({ id, type: 'residential' });
      expect(a).toBe(b);
    }
  });

  it('over 1000 ids covers >= 3/4 palette entries for each type', () => {
    const types: BuildingType[] = ['residential', 'commercial', 'industrial'];
    for (const type of types) {
      const palette = FACADE_TINT_PALETTES[type];
      const seen = new Set<number>();
      for (let id = 1; id <= 1000; id++) {
        seen.add(facadeTintFor({ id, type }));
      }
      // Every returned tint must come from the palette.
      for (const v of seen) {
        expect(palette).toContain(v);
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('never returns a value outside [0, 0xffffff]', () => {
    const types: BuildingType[] = ['residential', 'commercial', 'industrial'];
    for (const type of types) {
      for (let id = 1; id <= 1000; id++) {
        const v = facadeTintFor({ id, type });
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});

describe('FACADE_TINT_PALETTES', () => {
  it('matches the documented per-type palette', () => {
    expect(FACADE_TINT_PALETTES.residential).toEqual([
      0xffffff,
      0xfff4e8,
      0xf0fff0,
      0xfff0f8,
    ]);
    expect(FACADE_TINT_PALETTES.commercial).toEqual([
      0xffffff,
      0xf0f8ff,
      0xfff8f0,
      0xf0fffa,
    ]);
    expect(FACADE_TINT_PALETTES.industrial).toEqual([
      0xffffff,
      0xfff0e0,
      0xf0e8d8,
      0xe8e8f0,
    ]);
  });
});
