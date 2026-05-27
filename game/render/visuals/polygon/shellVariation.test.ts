import { describe, it, expect } from 'vitest';
import {
  shellVariationFor,
  shellVariationToken,
  volumeSplitGeometry,
  type RoofType,
  type VolumeSplitKind,
  type ShellVariation,
} from './shellVariation';

describe('shellVariationFor', () => {
  it('determinism: calling 5 times returns deep-equal objects', () => {
    const building = { id: 42, level: 5 };
    const footprint = { w: 2, h: 2 };
    const first = shellVariationFor(building, footprint);
    for (let i = 0; i < 4; i++) {
      expect(shellVariationFor(building, footprint)).toEqual(first);
    }
  });

  describe('level gating — roof', () => {
    for (const id of [1, 7, 99]) {
      for (const level of [1, 2]) {
        it(`id=${id} level=${level} → roof=flat`, () => {
          const v = shellVariationFor({ id, level }, { w: 2, h: 2 });
          expect(v.roof).toBe('flat');
        });
      }
    }
  });

  describe('level gating — split', () => {
    it('level <= 2 always yields splitKind=none (10 ids)', () => {
      for (let id = 0; id < 10; id++) {
        for (const level of [1, 2]) {
          const v = shellVariationFor({ id, level }, { w: 4, h: 4 });
          expect(v.splitKind).toBe('none');
        }
      }
    });
  });

  describe('area gating — split', () => {
    const smallFootprints = [
      { w: 1, h: 1 },
      { w: 2, h: 1 },
      { w: 3, h: 1 },
      { w: 1, h: 3 },
    ];
    for (const fp of smallFootprints) {
      it(`footprint ${fp.w}x${fp.h} (area<4) → splitKind=none for 10 ids at level=5`, () => {
        for (let id = 0; id < 10; id++) {
          const v = shellVariationFor({ id, level: 5 }, fp);
          expect(v.splitKind).toBe('none');
        }
      });
    }
  });

  describe('split axis shape rule', () => {
    it('every non-none split matches axis rule across 4x4 shape grid × 20 ids at level=5', () => {
      for (let w = 1; w <= 4; w++) {
        for (let h = 1; h <= 4; h++) {
          if (w * h < 4) continue;
          const expectedAxis: VolumeSplitKind = w >= h && w >= 2 ? 'x' : 'y';
          for (let i = 0; i < 20; i++) {
            const id = w * 100 + h * 10 + i;
            const v = shellVariationFor({ id, level: 5 }, { w, h });
            if (v.splitKind !== 'none') {
              expect(v.splitKind).toBe(expectedAxis);
            }
          }
        }
      }
    });
  });

  describe('setback gating', () => {
    const id = 1;
    it('level 1 → setbackSteps=0', () => {
      expect(shellVariationFor({ id, level: 1 }, { w: 2, h: 2 }).setbackSteps).toBe(0);
    });
    it('level 2 → setbackSteps=0', () => {
      expect(shellVariationFor({ id, level: 2 }, { w: 2, h: 2 }).setbackSteps).toBe(0);
    });
    it('level 3 → setbackSteps=0', () => {
      expect(shellVariationFor({ id, level: 3 }, { w: 2, h: 2 }).setbackSteps).toBe(0);
    });
    it('level 4 → setbackSteps=1', () => {
      expect(shellVariationFor({ id, level: 4 }, { w: 2, h: 2 }).setbackSteps).toBe(1);
    });
    it('level 5 → setbackSteps=2', () => {
      expect(shellVariationFor({ id, level: 5 }, { w: 2, h: 2 }).setbackSteps).toBe(2);
    });
  });

  describe('lift-jitter quantization', () => {
    it('liftJitterPct is always one of {-4, 0, 4} for 30 sampled ids at level=5', () => {
      const allowed = new Set([-4, 0, 4]);
      for (let id = 0; id < 30; id++) {
        const v = shellVariationFor({ id, level: 5 }, { w: 2, h: 2 });
        expect(allowed.has(v.liftJitterPct)).toBe(true);
      }
    });
  });
});

describe('shellVariationToken', () => {
  it('flat / none / 0 / 0', () => {
    expect(
      shellVariationToken({ roof: 'flat', splitKind: 'none', setbackSteps: 0, liftJitterPct: 0 }),
    ).toBe('roof:flat|vsplit:none|setback:0|liftJ:0');
  });

  it('gabled / x / 1 / -4', () => {
    expect(
      shellVariationToken({ roof: 'gabled', splitKind: 'x', setbackSteps: 1, liftJitterPct: -4 }),
    ).toBe('roof:gab|vsplit:x|setback:1|liftJ:-4');
  });

  it('stepped / y / 2 / 4', () => {
    expect(
      shellVariationToken({ roof: 'stepped', splitKind: 'y', setbackSteps: 2, liftJitterPct: 4 }),
    ).toBe('roof:step|vsplit:y|setback:2|liftJ:4');
  });

  describe('token uniqueness fuzz', () => {
    it('all 81 Cartesian-product combos produce distinct tokens', () => {
      const roofs: RoofType[] = ['flat', 'gabled', 'stepped'];
      const splitKinds: VolumeSplitKind[] = ['none', 'x', 'y'];
      const setbacks = [0, 1, 2] as const;
      const lifts = [-4, 0, 4] as const;

      const tokens = new Set<string>();
      for (const roof of roofs) {
        for (const splitKind of splitKinds) {
          for (const setbackSteps of setbacks) {
            for (const liftJitterPct of lifts) {
              const v: ShellVariation = { roof, splitKind, setbackSteps, liftJitterPct };
              tokens.add(shellVariationToken(v));
            }
          }
        }
      }
      expect(tokens.size).toBe(81);
    });
  });
});

describe('volumeSplitGeometry', () => {
  it("'none' returns null", () => {
    expect(volumeSplitGeometry('none', { w: 4, h: 2 })).toBeNull();
  });

  it("'x' on 4x2 → { offset: 2, tallSide: 'lo' }", () => {
    expect(volumeSplitGeometry('x', { w: 4, h: 2 })).toEqual({ offset: 2, tallSide: 'lo' });
  });

  it("'x' on 3x1 → { offset: 1, tallSide: 'lo' }", () => {
    expect(volumeSplitGeometry('x', { w: 3, h: 1 })).toEqual({ offset: 1, tallSide: 'lo' });
  });

  it("'y' on 2x4 → { offset: 2, tallSide: 'lo' }", () => {
    expect(volumeSplitGeometry('y', { w: 2, h: 4 })).toEqual({ offset: 2, tallSide: 'lo' });
  });
});
