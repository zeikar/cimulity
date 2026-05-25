export type Frontage = 'N' | 'S' | 'E' | 'W';

export function isFrontage(v: unknown): v is Frontage {
  return v === 'N' || v === 'S' || v === 'E' || v === 'W';
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Full WxH rect, anchor at NW corner, W,H ∈ {1..4}, no holes/dupes/extras. */
export function isCanonicalFootprintRect(
  footprint: ReadonlyArray<{ x: number; y: number }>,
  anchor: { x: number; y: number },
): boolean {
  if (footprint.length === 0) return false;

  let minX = footprint[0].x;
  let maxX = footprint[0].x;
  let minY = footprint[0].y;
  let maxY = footprint[0].y;

  for (const c of footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  const W = maxX - minX + 1;
  const H = maxY - minY + 1;

  if (W < 1 || W > 4 || H < 1 || H > 4) return false;
  if (anchor.x !== minX || anchor.y !== minY) return false;
  if (footprint.length !== W * H) return false;

  const seen = new Set<string>();
  for (const c of footprint) {
    seen.add(`${c.x},${c.y}`);
  }
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!seen.has(`${x},${y}`)) return false;
    }
  }

  return true;
}
