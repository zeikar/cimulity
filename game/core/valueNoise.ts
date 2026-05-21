const OCTAVES = 4;
const PERSISTENCE = 0.5;
const LACUNARITY = 2;
// AMP_SUM precomputed from fixed octaves/persistence — see locked design
const AMP_SUM = 1.875;

export function fbm2d(width: number, height: number, rng: () => number): number[][] {
  const output: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0));

  let cell = Math.max(4, Math.floor(Math.max(width, height) / 4));
  let amp = 1;

  for (let oct = 0; oct < OCTAVES; oct++) {
    const lw = Math.ceil(width / cell) + 2;
    const lh = Math.ceil(height / cell) + 2;
    const lattice: number[][] = Array.from({ length: lh }, () =>
      Array.from({ length: lw }, () => rng())
    );

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = Math.floor(x / cell);
        const j = Math.floor(y / cell);
        const fx = x / cell - i;
        const fy = y / cell - j;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const v00 = lattice[j][i];
        const v10 = lattice[j][i + 1];
        const v01 = lattice[j + 1][i];
        const v11 = lattice[j + 1][i + 1];
        const sample = v00 + sx * (v10 - v00) + sy * (v01 - v00) + sx * sy * (v00 - v10 - v01 + v11);
        output[y][x] += amp * sample;
      }
    }

    amp *= PERSISTENCE;
    cell = Math.max(1, Math.floor(cell / LACUNARITY));
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      output[y][x] = output[y][x] / AMP_SUM;
    }
  }

  return output;
}
