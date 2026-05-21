export function buildWaterMask(
  noiseGrid: number[][],
  opts?: { waterFraction?: number; edgeBandWidth?: number; edgeBiasWeight?: number }
): boolean[][] {
  const H = noiseGrid.length;
  const W = H > 0 ? noiseGrid[0].length : 0;

  const waterFraction = opts?.waterFraction ?? 0.12;
  const edgeBandWidth = opts?.edgeBandWidth ?? Math.max(4, Math.floor(Math.min(W, H) / 8));
  const edgeBiasWeight = opts?.edgeBiasWeight ?? 0.15;

  const waterCount = Math.max(0, Math.min(W * H - 1, Math.floor(W * H * waterFraction)));

  const entries: { score: number; idx: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const distToEdge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const edgeBias = Math.max(0, 1 - distToEdge / edgeBandWidth);
      const score = noiseGrid[y][x] - edgeBiasWeight * edgeBias;
      entries.push({ score, idx: y * W + x });
    }
  }

  entries.sort((a, b) => a.score - b.score || a.idx - b.idx);

  const mask: boolean[][] = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));
  for (let i = 0; i < waterCount; i++) {
    const { idx } = entries[i];
    mask[Math.floor(idx / W)][idx % W] = true;
  }

  return mask;
}
