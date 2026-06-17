import { describe, it, expect } from 'vitest';
import { Demand, DENSITY_DEMAND_THRESHOLD } from './Demand';
import { BuildingMap } from './Building';
import type { Building } from './Building';

function makeBuildingMap(): BuildingMap {
  return new BuildingMap(20, 20);
}

function addBuilding(
  map: BuildingMap,
  id: number,
  x: number,
  y: number,
  type: Building['type'],
  level: number,
): void {
  map.addExistingBuilding({
    id,
    type,
    footprint: [{ x, y }],
    anchor: { x, y },
    level,
    density: 0,
    age: 0,
    abandoned: false,
    frontage: 'S',
    structureRect: { x, y, w: 1, h: 1 },
  });
}

function makePRNG(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

const ZERO_LABOR = { employed: 0, unemployed: 0, reachableUnfilledJobs: 0 };

describe('Demand', () => {
  it('DENSITY_DEMAND_THRESHOLD is exported', () => {
    expect(DENSITY_DEMAND_THRESHOLD).toBe(0.6);
  });

  it('empty BuildingMap returns baseline 0.25 for all three', () => {
    const demand = new Demand();
    demand.recompute(makeBuildingMap(), ZERO_LABOR);
    const v = demand.get();
    expect(v.residential).toBe(0.25);
    expect(v.commercial).toBe(0.25);
    expect(v.industrial).toBe(0.25);
  });

  it('get() before recompute returns baseline 0.25', () => {
    const demand = new Demand();
    const v = demand.get();
    expect(v.residential).toBe(0.25);
    expect(v.commercial).toBe(0.25);
    expect(v.industrial).toBe(0.25);
  });

  it('residential-only city: residential at baseline-or-below, industrial and commercial near max', () => {
    const map = makeBuildingMap();
    for (let i = 0; i < 5; i++) {
      addBuilding(map, i, i, 0, 'residential', 1);
    }
    const demand = new Demand();
    demand.recompute(map, ZERO_LABOR);
    const v = demand.get();
    // No jobs → residential demand should not exceed baseline
    expect(v.residential).toBeLessThanOrEqual(0.25);
    // Residents with no jobs → industrial demand high
    expect(v.industrial).toBeGreaterThan(0.5);
    // Residents with no commercial → commercial demand high
    expect(v.commercial).toBeGreaterThan(0.5);
  });

  it('industrial-only city: industrial at baseline-or-below, residential near max', () => {
    const map = makeBuildingMap();
    for (let i = 0; i < 5; i++) {
      addBuilding(map, i, i, 0, 'industrial', 1);
    }
    const demand = new Demand();
    demand.recompute(map, ZERO_LABOR);
    const v = demand.get();
    // No residents → industrial demand should be at or below baseline
    expect(v.industrial).toBeLessThanOrEqual(0.25);
    // Jobs exist with no homes → residential demand near max
    expect(v.residential).toBeGreaterThan(0.5);
  });

  it('balanced city (3R + 3I matched): R and I near baseline, C still pulls', () => {
    const map = makeBuildingMap();
    for (let i = 0; i < 3; i++) {
      addBuilding(map, i, i, 0, 'residential', 1);
    }
    for (let i = 3; i < 6; i++) {
      addBuilding(map, i, i, 0, 'industrial', 1);
    }
    const demand = new Demand();
    demand.recompute(map, ZERO_LABOR);
    const v = demand.get();
    expect(v.residential).toBeCloseTo(0.25, 1);
    expect(v.industrial).toBeCloseTo(0.25, 1);
    // No commercial buildings → commercial demand still pulls high
    expect(v.commercial).toBeGreaterThan(0.5);
  });

  it('all values stay in [0, 1] with extreme building counts', () => {
    const map = makeBuildingMap();
    // Fill with many residential buildings to push extremes
    for (let i = 0; i < 10; i++) {
      addBuilding(map, i, i % 20, Math.floor(i / 20), 'residential', 5);
    }
    const demand = new Demand();
    demand.recompute(map, ZERO_LABOR);
    const v = demand.get();
    expect(v.residential).toBeGreaterThanOrEqual(0);
    expect(v.residential).toBeLessThanOrEqual(1);
    expect(v.commercial).toBeGreaterThanOrEqual(0);
    expect(v.commercial).toBeLessThanOrEqual(1);
    expect(v.industrial).toBeGreaterThanOrEqual(0);
    expect(v.industrial).toBeLessThanOrEqual(1);
  });

  it('level-0 buildings contribute nothing: 100 level-0 R + 1 level-1 I → residential is high', () => {
    const map = new BuildingMap(200, 200);
    // Add 100 level-0 residential buildings
    for (let i = 0; i < 100; i++) {
      map.addExistingBuilding({
        id: i,
        type: 'residential',
        footprint: [{ x: i % 200, y: Math.floor(i / 200) }],
        anchor: { x: i % 200, y: Math.floor(i / 200) },
        level: 0,
        density: 0,
        age: 0,
        abandoned: false,
        frontage: 'S',
        structureRect: { x: i % 200, y: Math.floor(i / 200), w: 1, h: 1 },
      });
    }
    // Add 1 level-1 industrial building
    map.addExistingBuilding({
      id: 100,
      type: 'industrial',
      footprint: [{ x: 100, y: 0 }],
      anchor: { x: 100, y: 0 },
      level: 1,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect: { x: 100, y: 0, w: 1, h: 1 },
    });

    const demand = new Demand();
    demand.recompute(map, ZERO_LABOR);
    const v = demand.get();
    // level-0 R buildings contribute 0 → effectively industrial-only city → residential high
    expect(v.residential).toBeGreaterThan(0.5);
  });

  it('abandoned buildings do not contribute to per-type demand sums', () => {
    // Two industrial buildings; marking one abandoned should yield the same demand
    // as if that building were absent entirely.
    const withAbandoned = makeBuildingMap();
    addBuilding(withAbandoned, 0, 0, 0, 'industrial', 4);
    withAbandoned.addExistingBuilding({
      id: 1,
      type: 'industrial',
      footprint: [{ x: 1, y: 0 }],
      anchor: { x: 1, y: 0 },
      level: 4,
      density: 0,
      age: 0,
      abandoned: true,
      frontage: 'S',
      structureRect: { x: 1, y: 0, w: 1, h: 1 },
    });

    const withoutBuilding = makeBuildingMap();
    addBuilding(withoutBuilding, 0, 0, 0, 'industrial', 4);

    const d1 = new Demand();
    d1.recompute(withAbandoned, ZERO_LABOR);
    const d2 = new Demand();
    d2.recompute(withoutBuilding, ZERO_LABOR);

    expect(d1.get().residential).toBe(d2.get().residential);
    expect(d1.get().commercial).toBe(d2.get().commercial);
    expect(d1.get().industrial).toBe(d2.get().industrial);

    // Sanity: the active building DOES move demand off baseline (so the equality
    // above is not a trivial both-at-baseline coincidence).
    expect(d1.get().residential).toBeGreaterThan(0.25);
  });

  it('determinism: two recompute calls on identical input yield byte-identical output', () => {
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'residential', 2);
    addBuilding(map, 1, 1, 0, 'commercial', 1);
    addBuilding(map, 2, 2, 0, 'industrial', 3);

    const d1 = new Demand();
    d1.recompute(map, ZERO_LABOR);
    const r1 = d1.getRaw();

    const d2 = new Demand();
    d2.recompute(map, ZERO_LABOR);
    const r2 = d2.getRaw();

    expect(r1.residential).toBe(r2.residential);
    expect(r1.commercial).toBe(r2.commercial);
    expect(r1.industrial).toBe(r2.industrial);
  });

  it('immutability: mutating get() result throws in strict mode', () => {
    const demand = new Demand();
    demand.recompute(makeBuildingMap(), ZERO_LABOR);
    const v = demand.get();
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v as any).residential = 999;
    }).toThrow();
  });

  it('get() and getRaw() return the same reference', () => {
    const demand = new Demand();
    demand.recompute(makeBuildingMap(), ZERO_LABOR);
    expect(demand.get()).toBe(demand.getRaw());
  });

  // --- Labor-feedback blend tests (pure formula; bags need not be physically achievable) ---

  it('unemployment↑ → residential demand↓', () => {
    // 2R + 2C, level 1: structuralR = (2-2)/2 + 0.25 = 0.25
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'residential', 1);
    addBuilding(map, 1, 1, 0, 'residential', 1);
    addBuilding(map, 2, 2, 0, 'commercial', 1);
    addBuilding(map, 3, 3, 0, 'commercial', 1);

    const dZero = new Demand();
    dZero.recompute(map, ZERO_LABOR);
    const zeroResidential = dZero.get().residential; // 0.25 (signals=0)

    // unemploymentRate=1, reachableVacancyRate=0, residentialSignal=-1 → residential = clamp01(0.25 - 0.15) = 0.10
    const bag = { employed: 0, unemployed: 2, reachableUnfilledJobs: 0 };
    const d = new Demand();
    d.recompute(map, bag);
    const v = d.get();

    expect(v.residential).toBeCloseTo(0.10);
    expect(v.residential).toBeLessThan(zeroResidential);
  });

  it('reachable unfilled jobs↑ → residential demand↑', () => {
    // 2R + 2C, level 1: structuralR = 0.25
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'residential', 1);
    addBuilding(map, 1, 1, 0, 'residential', 1);
    addBuilding(map, 2, 2, 0, 'commercial', 1);
    addBuilding(map, 3, 3, 0, 'commercial', 1);

    const dZero = new Demand();
    dZero.recompute(map, ZERO_LABOR);
    const zeroResidential = dZero.get().residential; // 0.25

    // reachableSlots=3, reachableVacancyRate=1/3, unemploymentRate=0, residentialSignal=+1/3
    // residential = clamp01(0.25 + 0.15/3) = 0.30
    const bag = { employed: 2, unemployed: 0, reachableUnfilledJobs: 1 };
    const d = new Demand();
    d.recompute(map, bag);
    const v = d.get();

    expect(v.residential).toBeCloseTo(0.30);
    expect(v.residential).toBeGreaterThan(zeroResidential);
  });

  it('empty city identical with/without labor', () => {
    // structuralR = structuralC = structuralI = 0.25; ZERO_LABOR signals = 0
    const d = new Demand();
    d.recompute(makeBuildingMap(), ZERO_LABOR);
    const v = d.get();
    expect(v.residential).toBe(0.25);
    expect(v.commercial).toBe(0.25);
    expect(v.industrial).toBe(0.25);
  });

  it('residents-only city: C/I attractor preserved', () => {
    // Documents intended existing behavior, not a regression.
    // 1R: structuralR=-0.75→0, structuralC=structuralI=1.25→1
    // Bag: unemploymentRate=1, residentialSignal=-1, jobsSignal=+1
    // residential=clamp01(0-0.15)=0, commercial=industrial=clamp01(1+0.15)=1
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'residential', 1);

    const bag = { employed: 0, unemployed: 1, reachableUnfilledJobs: 0 };
    const d = new Demand();
    d.recompute(map, bag);
    const v = d.get();

    expect(v.residential).toBe(0);
    expect(v.commercial).toBe(1);
    expect(v.industrial).toBe(1);
  });

  it('C/I nudged up by idle labor', () => {
    // 2R + 1C + 1I, level 1: structuralC = structuralI = 0.25
    // Bag: unemploymentRate=1, jobsSignal=+1 → commercial = industrial = clamp01(0.25+0.15) = 0.40
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'residential', 1);
    addBuilding(map, 1, 1, 0, 'residential', 1);
    addBuilding(map, 2, 2, 0, 'commercial', 1);
    addBuilding(map, 3, 3, 0, 'industrial', 1);

    const dZero = new Demand();
    dZero.recompute(map, ZERO_LABOR);
    const zeroC = dZero.get().commercial; // 0.25
    const zeroI = dZero.get().industrial; // 0.25

    const bag = { employed: 0, unemployed: 2, reachableUnfilledJobs: 0 };
    const d = new Demand();
    d.recompute(map, bag);
    const v = d.get();

    expect(v.commercial).toBeCloseTo(0.40);
    expect(v.industrial).toBeCloseTo(0.40);
    expect(v.commercial).toBeGreaterThan(zeroC);
    expect(v.industrial).toBeGreaterThan(zeroI);
  });

  it('outputs stay in [0,1] with an extreme labor bag', () => {
    // 1R + 1C, employed=1, unemployed=2 — exercises negative structuralC clamping
    const map = makeBuildingMap();
    addBuilding(map, 0, 0, 0, 'residential', 1);
    addBuilding(map, 1, 1, 0, 'commercial', 1);

    const bag = { employed: 1, unemployed: 2, reachableUnfilledJobs: 0 };
    const d = new Demand();
    d.recompute(map, bag);
    const v = d.get();

    expect(v.residential).toBeGreaterThanOrEqual(0);
    expect(v.residential).toBeLessThanOrEqual(1);
    expect(v.commercial).toBeGreaterThanOrEqual(0);
    expect(v.commercial).toBeLessThanOrEqual(1);
    expect(v.industrial).toBeGreaterThanOrEqual(0);
    expect(v.industrial).toBeLessThanOrEqual(1);
  });

  it('determinism across shuffled building-add orderings', () => {
    const rng = makePRNG(0xc0ffee);

    type BuildingSpec = { id: number; x: number; y: number; type: Building['type']; level: number };
    const specs: BuildingSpec[] = [
      { id: 0, x: 0, y: 0, type: 'residential', level: 2 },
      { id: 1, x: 1, y: 0, type: 'residential', level: 1 },
      { id: 2, x: 2, y: 0, type: 'commercial', level: 1 },
      { id: 3, x: 3, y: 0, type: 'commercial', level: 2 },
      { id: 4, x: 4, y: 0, type: 'industrial', level: 3 },
      { id: 5, x: 5, y: 0, type: 'industrial', level: 1 },
    ];

    // Get reference values from one ordered run
    const refMap = makeBuildingMap();
    for (const s of specs) {
      addBuilding(refMap, s.id, s.x, s.y, s.type, s.level);
    }
    const ref = new Demand();
    ref.recompute(refMap, ZERO_LABOR);
    const refV = ref.getRaw();

    for (let run = 0; run < 50; run++) {
      const shuffled = shuffle(specs, rng);
      const map = makeBuildingMap();
      for (const s of shuffled) {
        addBuilding(map, s.id, s.x, s.y, s.type, s.level);
      }
      const demand = new Demand();
      demand.recompute(map, ZERO_LABOR);
      const v = demand.getRaw();
      expect(v.residential).toBe(refV.residential);
      expect(v.commercial).toBe(refV.commercial);
      expect(v.industrial).toBe(refV.industrial);
    }
  });
});
