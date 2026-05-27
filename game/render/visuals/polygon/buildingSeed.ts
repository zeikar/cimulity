/** Knuth multiplicative hash — same pattern as `stagger` in game/core/World.ts. */
export function seedFor(id: number): number {
  return ((id ^ (id >>> 16)) * 2654435761) >>> 0;
}

// Mirrored from game/core/prng.ts `createRng` — kept local to avoid render→core import.
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickIndex(rng: () => number, weights: ReadonlyArray<number>): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
