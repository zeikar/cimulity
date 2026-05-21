export function shapeHeightmap(
  noiseGrid: number[][],
  maxElevation: number,
  opts?: { gamma?: number }
): number[][] {
  const gamma = opts?.gamma ?? 2.2;
  const H = noiseGrid.length;
  const W = H > 0 ? noiseGrid[0].length : 0;

  const shaped: number[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (__, x) => Math.pow(noiseGrid[y][x], gamma))
  );

  const filtered: number[][] = Array.from({ length: H }, () => new Array<number>(W).fill(0));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const neighbors: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W) {
            neighbors.push(shaped[ny][nx]);
          }
        }
      }
      neighbors.sort((a, b) => a - b);
      filtered[y][x] = neighbors[Math.floor((neighbors.length - 1) / 2)];
    }
  }

  return Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (__, x) =>
      Math.max(0, Math.min(maxElevation, Math.round(filtered[y][x] * maxElevation)))
    )
  );
}
