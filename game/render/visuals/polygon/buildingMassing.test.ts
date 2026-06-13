import { describe, it, expect } from 'vitest';
import {
  buildMassingPlan,
  massingSeed,
  seedUnit,
  GABLE_ROOF_COLORS,
  MASSING_VARIANTS,
  type MassingInput,
  type MassingPlan,
} from './buildingMassing';
import type { BuildingType } from '@/game/core/Building';

function planInput(overrides: Partial<MassingInput>): MassingInput {
  return {
    type: 'residential',
    level: 3,
    density: 1,
    w: 2,
    h: 2,
    bodyHeightPx: 40,
    seed: 7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

describe('massingSeed', () => {
  it('is deterministic and stays in [0, MASSING_VARIANTS)', () => {
    for (const id of [0, 1, 42, 999_999, -5]) {
      const s = massingSeed(id);
      expect(s).toBe(massingSeed(id));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(MASSING_VARIANTS);
    }
  });

  it('spreads sequential ids across many variants', () => {
    const seen = new Set<number>();
    for (let id = 1; id <= 200; id++) seen.add(massingSeed(id));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('seedUnit', () => {
  it('is deterministic and stays in [0, 1)', () => {
    for (let slot = 0; slot < 40; slot++) {
      const v = seedUnit(13, slot);
      expect(v).toBe(seedUnit(13, slot));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Type-specific shapes
// ---------------------------------------------------------------------------

describe('buildMassingPlan — residential', () => {
  it('low density is a single gable house with a palette roof colour', () => {
    for (let seed = 0; seed < 16; seed++) {
      const plan = buildMassingPlan(planInput({ density: 0, seed }));
      expect(plan.boxes).toHaveLength(1);
      const roof = plan.boxes[0].roof;
      expect(roof.kind).toBe('gable');
      if (roof.kind === 'gable') {
        expect(GABLE_ROOF_COLORS).toContain(roof.color);
        expect(roof.risePx).toBeGreaterThanOrEqual(3);
      }
      expect(plan.props).toHaveLength(0);
    }
  });

  it('gable ridge follows the longer footprint side', () => {
    const wide = buildMassingPlan(planInput({ density: 0, w: 2, h: 1 }));
    const deep = buildMassingPlan(planInput({ density: 0, w: 1, h: 2 }));
    expect(wide.boxes[0].roof).toMatchObject({ kind: 'gable', ridgeAxis: 'x' });
    expect(deep.boxes[0].roof).toMatchObject({ kind: 'gable', ridgeAxis: 'y' });
  });

  it('tall high-density slabs split into main + shorter wing and carry a water tank', () => {
    const plan = buildMassingPlan(
      planInput({ density: 2, level: 5, w: 3, h: 3, bodyHeightPx: 80 }),
    );
    expect(plan.boxes).toHaveLength(2);
    const [main, wing] = plan.boxes;
    expect(wing.wallHeightPx).toBeLessThan(main.wallHeightPx);
    expect(plan.props.some((p) => p.kind === 'tank')).toBe(true);
  });
});

describe('buildMassingPlan — commercial', () => {
  it('level >= 3 on a multi-tile lot stacks a tower on a podium', () => {
    for (let seed = 0; seed < 16; seed++) {
      const plan = buildMassingPlan(
        planInput({ type: 'commercial', level: 4, w: 2, h: 2, bodyHeightPx: 70, seed }),
      );
      expect(plan.boxes).toHaveLength(2);
      const [podium, tower] = plan.boxes;
      expect(podium.baseLiftPx).toBe(0);
      expect(tower.baseLiftPx).toBe(podium.wallHeightPx);
      // Tower stays within the podium footprint.
      expect(tower.rect.x0).toBeGreaterThanOrEqual(podium.rect.x0);
      expect(tower.rect.y0).toBeGreaterThanOrEqual(podium.rect.y0);
      expect(tower.rect.x1).toBeLessThanOrEqual(podium.rect.x1);
      expect(tower.rect.y1).toBeLessThanOrEqual(podium.rect.y1);
    }
  });

  it('level 5 grows an antenna for some seeds but not all', () => {
    let withAntenna = 0;
    for (let seed = 0; seed < MASSING_VARIANTS; seed++) {
      const plan = buildMassingPlan(
        planInput({ type: 'commercial', level: 5, w: 3, h: 3, bodyHeightPx: 100, seed }),
      );
      if (plan.props.some((p) => p.kind === 'antenna')) withAntenna++;
    }
    expect(withAntenna).toBeGreaterThan(0);
    expect(withAntenna).toBeLessThan(MASSING_VARIANTS);
  });

  it('low level or 1-wide lots stay a single flat box', () => {
    const low = buildMassingPlan(planInput({ type: 'commercial', level: 2 }));
    const narrow = buildMassingPlan(planInput({ type: 'commercial', level: 4, w: 1, h: 3 }));
    expect(low.boxes).toHaveLength(1);
    expect(narrow.boxes).toHaveLength(1);
    expect(low.boxes[0].roof.kind).toBe('flat');
  });
});

describe('buildMassingPlan — industrial', () => {
  it('multi-tile lots get a wing and at least one vent stack', () => {
    const plan = buildMassingPlan(
      planInput({ type: 'industrial', level: 3, w: 2, h: 2, bodyHeightPx: 24 }),
    );
    expect(plan.boxes).toHaveLength(2);
    expect(plan.props.some((p) => p.kind === 'vent')).toBe(true);
  });

  it('1x1 sheds keep a single box with a vent', () => {
    const plan = buildMassingPlan(
      planInput({ type: 'industrial', level: 1, w: 1, h: 1, bodyHeightPx: 8 }),
    );
    expect(plan.boxes).toHaveLength(1);
    expect(plan.props.some((p) => p.kind === 'vent')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Facade field
// ---------------------------------------------------------------------------

describe('buildMassingPlan — facade field', () => {
  it('commercial tower box is curtain, its podium is punched', () => {
    for (let seed = 0; seed < 16; seed++) {
      const plan = buildMassingPlan(
        planInput({ type: 'commercial', level: 4, w: 2, h: 2, bodyHeightPx: 70, seed }),
      );
      const [podium, tower] = plan.boxes;
      expect(podium.facade).toBe('punched');
      expect(tower.facade).toBe('curtain');
    }
  });

  it('residential gable house box is punched', () => {
    const plan = buildMassingPlan(planInput({ type: 'residential', density: 0, seed: 0 }));
    expect(plan.boxes[0].facade).toBe('punched');
  });

  it('residential flat box is punched', () => {
    // density 2 + large bodyH forces the flat-top path (not gable)
    const plan = buildMassingPlan(
      planInput({ type: 'residential', density: 2, level: 5, w: 1, h: 1, bodyHeightPx: 40, seed: 0 }),
    );
    expect(plan.boxes.every((b) => b.facade === 'punched')).toBe(true);
  });

  it('commercial low-level fallback box is punched', () => {
    const plan = buildMassingPlan(planInput({ type: 'commercial', level: 2, w: 2, h: 2 }));
    expect(plan.boxes).toHaveLength(1);
    expect(plan.boxes[0].facade).toBe('punched');
  });

  it('industrial boxes are punched', () => {
    const plan = buildMassingPlan(
      planInput({ type: 'industrial', level: 3, w: 2, h: 2, bodyHeightPx: 24 }),
    );
    expect(plan.boxes.every((b) => b.facade === 'punched')).toBe(true);
  });

  it('every box in every plan variant has a defined facade of a valid literal', () => {
    const types: BuildingType[] = ['residential', 'commercial', 'industrial'];
    const sizes: Array<[number, number]> = [[1, 1], [2, 1], [2, 2], [3, 2], [4, 4]];
    const valid = new Set(['punched', 'curtain']);
    for (const type of types) {
      for (const level of [1, 3, 5]) {
        for (const density of [0, 1, 2] as const) {
          for (const [w, h] of sizes) {
            for (let seed = 0; seed < 32; seed++) {
              const plan = buildMassingPlan(
                planInput({ type, level, density, w, h, seed, bodyHeightPx: 10 + 12 * level }),
              );
              for (const box of plan.boxes) {
                expect(valid).toContain(box.facade);
              }
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Degenerate inputs
// ---------------------------------------------------------------------------

describe('buildMassingPlan — degenerate inputs', () => {
  it('returns an empty plan for level 0 or a zero height budget', () => {
    const empty: MassingPlan = { boxes: [], props: [], totalHeightPx: 0 };
    expect(buildMassingPlan(planInput({ level: 0 }))).toEqual(empty);
    expect(buildMassingPlan(planInput({ bodyHeightPx: 0 }))).toEqual(empty);
    expect(buildMassingPlan(planInput({ w: 0 }))).toEqual(empty);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting invariants
// ---------------------------------------------------------------------------

describe('buildMassingPlan — invariants', () => {
  const types: BuildingType[] = ['residential', 'commercial', 'industrial'];
  const sizes: Array<[number, number]> = [[1, 1], [2, 1], [2, 2], [3, 2], [4, 4]];

  it('holds geometric and painter-order invariants across the variant space', () => {
    for (const type of types) {
      for (const level of [1, 3, 5]) {
        for (const density of [0, 1, 2] as const) {
          for (const [w, h] of sizes) {
            for (let seed = 0; seed < 32; seed++) {
              const input = planInput({ type, level, density, w, h, seed, bodyHeightPx: 10 + 12 * level });
              const plan = buildMassingPlan(input);

              // Determinism.
              expect(buildMassingPlan(input)).toEqual(plan);

              let maxTop = 0;
              for (const box of plan.boxes) {
                // Boxes stay inside the footprint with positive extents.
                expect(box.rect.x0).toBeGreaterThanOrEqual(0);
                expect(box.rect.y0).toBeGreaterThanOrEqual(0);
                expect(box.rect.x1).toBeLessThanOrEqual(w);
                expect(box.rect.y1).toBeLessThanOrEqual(h);
                expect(box.rect.x1).toBeGreaterThan(box.rect.x0);
                expect(box.rect.y1).toBeGreaterThan(box.rect.y0);
                expect(box.wallHeightPx).toBeGreaterThanOrEqual(1);
                const top =
                  box.baseLiftPx + box.wallHeightPx + (box.roof.kind === 'gable' ? box.roof.risePx : 0);
                maxTop = Math.max(maxTop, top);
              }

              // Painter order: a later box is above or in front of earlier ones.
              for (let i = 0; i < plan.boxes.length; i++) {
                for (let j = i + 1; j < plan.boxes.length; j++) {
                  const a = plan.boxes[i];
                  const b = plan.boxes[j];
                  const ok =
                    b.baseLiftPx > a.baseLiftPx ||
                    b.rect.x0 + b.rect.y0 >= a.rect.x0 + a.rect.y0;
                  expect(ok).toBe(true);
                }
              }

              // Props sit on a box roof, fully inside its rect.
              for (const prop of plan.props) {
                const host = plan.boxes.find(
                  (box) => box.baseLiftPx + box.wallHeightPx === prop.baseLiftPx,
                );
                expect(host).toBeDefined();
                if (!host) continue;
                if (prop.kind === 'antenna') {
                  expect(prop.tx).toBeGreaterThanOrEqual(host.rect.x0);
                  expect(prop.tx).toBeLessThanOrEqual(host.rect.x1);
                  expect(prop.ty).toBeGreaterThanOrEqual(host.rect.y0);
                  expect(prop.ty).toBeLessThanOrEqual(host.rect.y1);
                } else {
                  expect(prop.rect.x0).toBeGreaterThanOrEqual(host.rect.x0);
                  expect(prop.rect.y0).toBeGreaterThanOrEqual(host.rect.y0);
                  expect(prop.rect.x1).toBeLessThanOrEqual(host.rect.x1);
                  expect(prop.rect.y1).toBeLessThanOrEqual(host.rect.y1);
                }
                expect(prop.heightPx).toBeGreaterThanOrEqual(1);
                maxTop = Math.max(maxTop, prop.baseLiftPx + prop.heightPx);
              }

              expect(plan.totalHeightPx).toBe(maxTop);
            }
          }
        }
      }
    }
  });
});
