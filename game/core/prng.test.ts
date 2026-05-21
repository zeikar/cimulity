import { describe, it, expect } from 'vitest';
import { createRng } from './prng';

describe('createRng', () => {
  it('(a) known-vector — first 4 values of createRng(1) are pinned', () => {
    const rng = createRng(1);
    expect(rng()).toBe(0.6270739405881613);
    expect(rng()).toBe(0.002735721180215478);
    expect(rng()).toBe(0.5274470399599522);
    expect(rng()).toBe(0.9810509674716741);
  });

  it('(b) determinism — two createRng(42) instances produce identical first-100-call sequences', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('(c) divergence — createRng(1) and createRng(2) differ on first call', () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });

  it('(d) range — first 1000 calls of createRng(0) all in [0, 1)', () => {
    const rng = createRng(0);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('(e) coercion — non-finite seeds produce deterministic streams; createRng(NaN) === createRng(0) stream', () => {
    const rngNaN = createRng(NaN);
    const rng0 = createRng(0);
    for (let i = 0; i < 10; i++) {
      const vNaN = rngNaN();
      const v0 = rng0();
      expect(isNaN(vNaN)).toBe(false);
      expect(vNaN).toBe(v0);
    }

    const rngNeg = createRng(-1);
    for (let i = 0; i < 10; i++) {
      const v = rngNeg();
      expect(isNaN(v)).toBe(false);
    }

    const rngFloat = createRng(1.5);
    for (let i = 0; i < 10; i++) {
      const v = rngFloat();
      expect(isNaN(v)).toBe(false);
    }
  });
});
